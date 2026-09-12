import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createGraphicsClient, graphicsJobRequestSchema, registerGraphicsRoutes } from './graphics-service.js';
import { MAX_GLB_BYTES, validateGraphicsGlb } from './graphics-assets.js';
import { loadConfig } from '../config.js';
import { createHttpApp } from './create-http-app.js';

function glb(extra: object = {}) {
  let json = JSON.stringify({asset:{version:'2.0'}, ...extra});
  json = json.padEnd(Math.ceil(Buffer.byteLength(json) / 4) * 4, ' ');
  const chunk = Buffer.from(json);
  const bytes = Buffer.alloc(20 + chunk.length);
  bytes.writeUInt32LE(0x46546c67,0); bytes.writeUInt32LE(2,4); bytes.writeUInt32LE(bytes.length,8);
  bytes.writeUInt32LE(chunk.length,12); bytes.writeUInt32LE(0x4e4f534a,16); chunk.copy(bytes,20);
  return bytes;
}
const config = loadConfig({CARINA_RTX_SERVICE_URL:'http://localhost:18793',CARINA_RTX_SERVICE_KEY_FILE:'/private/key'});
const bytes = glb();
const hash = validateGraphicsGlb(bytes);
const metadata = {assetId:hash.slice(0,16),contentHash:hash,byteLength:bytes.length,deduped:false};

test('self-contained GLB validation rejects malformed containers and remote resources', () => {
  assert.match(hash,/^[a-f0-9]{64}$/);
  for (const uri of ['../key','file:///key','C:/secret','https://host/texture.png','texture.png']) {
    assert.throws(()=>validateGraphicsGlb(glb({images:[{uri}]})));
  }
  assert.doesNotThrow(()=>validateGraphicsGlb(glb({images:[{uri:'data:image/png;base64,AAAA'}]})));
  for (const offset of [0,4,8,12,16]) {
    const bad = Buffer.from(bytes); bad.writeUInt32LE(7,offset);
    assert.throws(()=>validateGraphicsGlb(bad));
  }
});

test('asset upload forwards multipart with server credential and checks exact content identity', async () => {
  const client = createGraphicsClient(config,{readKey:async()=> 'secret',fetch:async(url,init)=>{
    assert.equal(String(url),'http://localhost:18793/assets/glb');
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer secret');
    assert.equal(new Headers(init?.headers).get('content-type'),null);
    assert.ok(init?.body instanceof FormData);
    const file = init.body.get('file') as File;
    assert.deepEqual(Buffer.from(await file.arrayBuffer()),bytes);
    assert.equal(init.body.get('source_label'),'P0');
    return Response.json({...metadata,api_key:'private',relativePath:'private-path'});
  }});
  const result = await client.uploadAsset(bytes,'P0');
  assert.deepEqual(result,{state:'connected',asset:metadata});
  for (const wrong of [{...metadata,byteLength:bytes.length+4},{...metadata,contentHash:'f'.repeat(64),assetId:'f'.repeat(16)}]) {
    const bad = createGraphicsClient(config,{readKey:async()=> 'secret',fetch:async()=>Response.json(wrong)});
    assert.equal((await bad.uploadAsset(bytes)).state,'unavailable');
  }
});

test('invalid uploads never reach upstream; busy uploads are never retried', async () => {
  let calls=0;
  const client=createGraphicsClient(config,{readKey:async()=> 'secret',fetch:async()=>{calls++;return new Response(null,{status:429});}});
  assert.equal((await client.uploadAsset(new Uint8Array(4))).state,'invalid_request');
  assert.equal((await client.uploadAsset(bytes,'x'.repeat(201))).state,'invalid_request');
  assert.equal((await client.asset('../private')).state,'invalid_request');
  assert.equal(calls,0);
  assert.equal((await client.uploadAsset(bytes)).state,'busy');
  assert.equal(calls,1);
});

test('PBR accepts one assetId or legacy relative path, never ambiguous references', () => {
  const job={mode:'hq_pbr',resolution:[1280,720],frames:1,assetId:metadata.assetId};
  assert.ok(graphicsJobRequestSchema.safeParse(job).success);
  for(const change of [{scene_glb:'assets/scene.glb'},{assetId:'../bad'},{mode:'baseline'}]) {
    assert.equal(graphicsJobRequestSchema.safeParse({...job,...change}).success,false);
  }
});

test('HTTP upload route parses multipart, bounds body and strips remote metadata',async()=>{
  let calls=0;
  const app=new Hono();
  registerGraphicsRoutes(app,config,{readKey:async()=> 'secret',fetch:async()=>{calls++;return Response.json({...metadata,windowsPath:'private'});}});
  const form=new FormData(); form.set('file',new Blob([bytes]),'test.glb');
  const response=await app.request('/v1/graphics/assets/glb',{method:'POST',body:form});
  assert.equal(response.status,201); assert.deepEqual(await response.json(),{state:'connected',asset:metadata});
  const get=await app.request(`/v1/graphics/assets/${metadata.assetId}`);
  assert.equal(get.status,200);
  assert.equal((await app.request('/v1/graphics/assets/bad')).status,400);
  const before=calls;
  assert.equal((await app.request('/v1/graphics/assets/glb',{method:'POST',body:'not multipart'})).status,400);
  assert.equal((await app.request('/v1/graphics/assets/glb',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=a','content-length':String(MAX_GLB_BYTES+1024*1024+1)},body:'a'})).status,413);
  assert.equal(calls,before);
});

test('HTTP upload admits only one concurrent request and releases its slot',async()=>{
  let release!:()=>void;
  let entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const waiting=new Promise<void>(resolve=>{release=resolve;});
  const app=new Hono();
  registerGraphicsRoutes(app,config,{readKey:async()=> 'secret',fetch:async()=>{entered();await waiting;return Response.json(metadata);}});
  const form=new FormData();form.set('file',new Blob([bytes]),'test.glb');
  const first=app.request('/v1/graphics/assets/glb',{method:'POST',body:form});
  await started;
  assert.equal((await app.request('/v1/graphics/assets/glb',{method:'POST',body:form})).status,429);
  release(); assert.equal((await first).status,201);
  assert.equal((await app.request('/v1/graphics/assets/glb',{method:'POST',body:form})).status,201);
});

test('asset routes remain behind the real application authentication boundary', async () => {
  const app=createHttpApp({...config,token:'test-token'},{runTurn:async function*(){yield '';}});
  assert.equal((await app.request('/v1/graphics/assets/glb',{method:'POST',body:'invalid'})).status,401);
  assert.equal((await app.request(`/v1/graphics/assets/${metadata.assetId}`)).status,401);
  assert.equal((await app.request('/v1/graphics/assets/glb',{method:'POST',headers:{authorization:'Bearer test-token'},body:'invalid'})).status,400);
});

test('sidecar 201 asset identity is content-addressed and never labeled world-model', async () => {
  const client = createGraphicsClient(config,{readKey:async()=> 'secret',fetch:async()=>Response.json({
    ...metadata,
    source:'world-model',
    windowsPath:'C:\\secret',
  })});
  const result = await client.uploadAsset(bytes,'P0-sample');
  assert.equal(result.state,'connected');
  assert.ok(result.asset);
  assert.equal(result.asset.assetId, metadata.assetId);
  assert.equal(result.asset.contentHash, metadata.contentHash);
  assert.equal(JSON.stringify(result).includes('world-model'), false);
  assert.equal(JSON.stringify(result).includes('windowsPath'), false);
});

