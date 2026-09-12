import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraphicsClient, graphicsJobRequestSchema } from './graphics-service.js';
import { loadConfig } from '../config.js';
const health={service:'CARINA-RTX-20260910',gpu_name:'RTX 5070 Ti',vram_mib:16303,driver:'616.56',backend:'test',ready:true,capabilities:{meshRender:true,lumenSW:false,lumenHW:false,dlssSuperResolution:false,dlssNeuralRendering:false}};
const config=loadConfig({CARINA_RTX_SERVICE_URL:'http://127.0.0.1:18793',CARINA_RTX_SERVICE_KEY_FILE:'/private/key'});
test('graphics credentials stay server-side and missing neural capability remains false',async()=>{
  const client=createGraphicsClient(config,{readKey:async()=> 'secret\n',fetch:async(url,init)=>{
    assert.equal(String(url),'http://127.0.0.1:18793/health');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer secret');assert.equal(init?.redirect,'error');
    return Response.json({...health,api_key:'must-not-leak',bind:'private-address'});
  }});
  const status=await client.health();assert.equal(status.state,'connected');
  if(status.state==='connected')assert.equal(status.health.capabilities.dlssNeuralRendering,false);
  assert.ok(!JSON.stringify(status).includes('must-not-leak'));
});
test('graphics integration distinguishes unconfigured, unauthorized and invalid capability evidence',async()=>{
  assert.equal((await createGraphicsClient(loadConfig({})).health()).state,'unconfigured');
  assert.equal((await createGraphicsClient(config,{readKey:async()=> 'x',fetch:async()=>new Response('',{status:401})}).health()).state,'unauthorized');
  assert.equal((await createGraphicsClient(config,{readKey:async()=> 'x',fetch:async()=>Response.json({...health,capabilities:{meshRender:true}})}).health()).state,'unavailable');
  assert.equal((await createGraphicsClient(config,{readKey:async()=>{throw Error('private-path');}}).health()).state,'unavailable');
});

test('bad endpoint configuration never throws or sends a request', async () => {
  for (const endpoint of ['not a URL', 'file:///tmp/key', 'http://user:password@localhost']) {
    const client = createGraphicsClient({...config, rtxServiceUrl: endpoint}, {
      readKey: async () => { throw Error('must not read key'); },
      fetch: async () => { throw Error('must not fetch'); },
    });
    assert.equal((await client.health()).state, 'misconfigured');
  }
});

test('graphics job forwards bounded request and preserves blocked status', async () => {
  let calls = 0;
  const client = createGraphicsClient(config, {readKey: async () => 'secret', fetch: async (url, init) => {
    calls++;
    assert.equal(String(url), 'http://127.0.0.1:18793/jobs');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), {mode:'lumen_hw', resolution:[1280,720], frames:60});
    return Response.json({id:'bd27e797f19c',mode:'lumen_hw',resolution:[1280,720],frames:60,state:'blocked',progress:0,
      reason:'Unreal unavailable',error:null,created_at:'2026-09-10',started_at:null,finished_at:null,artifacts:[],meta:{api_key:'private'}});
  }});
  const result = await client.job({mode:'lumen_hw',resolution:[1280,720],frames:60});
  assert.equal(result.state, 'connected');
  if(result.state === 'connected') assert.equal(result.job.state, 'blocked');
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal((await client.job('../../private')).state, 'unavailable');
  assert.equal(calls, 1);
});

test('graphics service backpressure is not retried into duplicate GPU jobs', async () => {
  let calls = 0;
  const client = createGraphicsClient(config, {readKey:async()=> 'secret',fetch:async()=> {
    calls++; return new Response('',{status:429});
  }});
  assert.equal((await client.job({mode:'baseline',resolution:[1920,1080],frames:60})).state, 'busy');
  assert.equal(calls,1);
});

test('artifact proxy limits paths and bytes and never forwards upstream cookies', async () => {
  let calls = 0;
  const client = createGraphicsClient(config, {readKey:async()=> 'secret',fetch:async()=> {
    calls++; return new Response('image', {headers:{'set-cookie':'private=secret','content-type':'text/html'}});
  }});
  assert.equal((await client.artifact('../private','before.png')).status,400);
  assert.equal((await client.artifact('bd27e797f19c','../before.png')).status,400);
  assert.equal(calls,0);
  const response = await client.artifact('bd27e797f19c','before.png');
  assert.equal(response.headers.get('content-type'),'image/png');
  assert.equal(response.headers.get('set-cookie'),null);
  assert.equal(await response.text(),'image');
  const large = createGraphicsClient(config, {readKey:async()=> 'secret',fetch:async()=>new Response('x',{headers:{'content-length':String(129*1024*1024)}})});
  assert.equal((await large.artifact('bd27e797f19c','before.png')).status,502);
});


test('PBR scene options reject traversal, ignored mode options and invalid camera bases', () => {
  const request = {mode:'hq_pbr',resolution:[1280,720],frames:24,scene_glb:'assets/scenes/DamagedHelmet/DamagedHelmet.glb'};
  assert.equal(graphicsJobRequestSchema.safeParse(request).success,true);
  for(const path of ['../secret.glb','assets/../secret.glb','C:/secret.glb','https://host/scene.glb']) {
    assert.equal(graphicsJobRequestSchema.safeParse({...request,scene_glb:path}).success,false);
  }
  assert.equal(graphicsJobRequestSchema.safeParse({...request,scene_glb:undefined}).success,false);
  assert.equal(graphicsJobRequestSchema.safeParse({...request,mode:'baseline'}).success,false);
  const camera = {eye:[1,1,1],target:[1,1,1],up:[0,1,0]};
  assert.equal(graphicsJobRequestSchema.safeParse({...request,camera_path:[camera,camera]}).success,false);
});

test('PBR and Falcor capability flags remain separate from neural rendering', async () => {
  const client = createGraphicsClient(config,{readKey:async()=> 'secret',fetch:async()=>Response.json({...health,capabilities:{...health.capabilities,pbrRasterIBL:true,falcorPathTrace:true}})});
  const result = await client.health();
  assert.equal(result.state,'connected');
  if(result.state === 'connected') {
    assert.equal(result.health.capabilities.pbrRasterIBL,true);
    assert.equal(result.health.capabilities.falcorPathTrace,true);
    assert.equal(result.health.capabilities.pathTraceDXR,false);
    assert.equal(result.health.capabilities.dlssNeuralRendering,false);
  }
});

test('camera keyframes are sampled continuously instead of jumping then freezing', () => {
  const request = {mode:'hq_pbr',resolution:[1280,720],frames:5,scene_glb:'assets/scene.glb',camera_path:[
    {eye:[0,1,3],target:[0,1,0],up:[0,1,0]},
    {eye:[2,1,3],target:[0,1,0],up:[0,1,0]},
  ]};
  const result = graphicsJobRequestSchema.parse(request);
  assert.equal(result.camera_path?.length,5);
  assert.deepEqual(result.camera_path?.map(p=>p.eye[0]),[0,0.5,1,1.5,2]);
  const invalid = {...request,camera_path:[request.camera_path[0],{eye:[0,1,-3],target:[0,1,0],up:[0,1,0]}]};
  assert.equal(graphicsJobRequestSchema.safeParse(invalid).success,false);
});

test('single-frame camera requests remain valid across route and client validation', () => {
  const request = {mode:'hq_pbr',resolution:[1280,720],frames:1,scene_glb:'assets/scene.glb',camera_path:[{eye:[0,1,3],target:[0,1,0],up:[0,1,0]}]};
  const once = graphicsJobRequestSchema.parse(request);
  assert.deepEqual(graphicsJobRequestSchema.parse(once),once);
});
