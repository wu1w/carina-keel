import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildChunk, batchNodes, recipeSchema, type Recipe } from './geometry.js';
import { createSceneService } from './service.js';
import { buildMeshesGlb } from '../exporter/glb.js';
import type { Application } from '../server/bind-application.js';
import type { CarinaConfig } from '../config.js';
const recipe:Recipe={title:'湖边酒馆',description:'参数化建造',ground:[.18,.24,.12],wood:[.25,.13,.07],stone:[.43,.4,.32],foliage:[.12,.25,.14],roof:[.25,.12,.08],density:.6,landmarks:['tavern','grove','camp']};

test('immutable geometry, valid indices/normals, material batching preserves triangle count',()=>{
  const a=buildChunk(recipe,'world',0,0),b=buildChunk(recipe,'world',0,0);
  assert.deepEqual(a.nodes,b.nodes);assert.deepEqual(a.colliders,b.colliders);
  const batched=batchNodes(a.nodes);
  assert.ok(batched.length<=10);assert.ok(a.nodes.length>60);
  assert.equal(batched.reduce((n,m)=>n+m.mesh.indices.length,0),a.triangles*3);
  for(const n of a.nodes) {
    assert.equal(n.mesh.positions.length,n.mesh.normals.length);
    assert.ok(n.mesh.indices.every(i=>i>=0&&i<n.mesh.positions.length/3));
    assert.ok(n.mesh.positions.every(Number.isFinite));
    for(let i=0;i<n.mesh.normals.length;i+=3)assert.ok(Math.abs(Math.hypot(...n.mesh.normals.slice(i,i+3))-1)<.015);
  }
  const bytes=buildMeshesGlb(batched);assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x46546c67);
});

test('neighbor seams, spawn and four exits have unobstructed collision clearance',()=>{
  for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++) {
    const chunk=buildChunk(recipe,'world',x,z);
    for(const point of [[12,12],[.3,12],[23.7,12],[12,.3],[12,23.7]]) {
      const px=point[0]!+x*24,pz=point[1]!+z*24;
      assert.ok(!chunk.colliders.some(b=>px+.28>b.min.x&&px-.28<b.max.x&&pz+.28>b.min.z&&pz-.28<b.max.z));
    }
  }
});

test('preparation coalesces, background chunks persist, replay and export work with models offline',async()=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),'scene-test-'));let sources=0,plans=0;
  const config={dataDir} as CarinaConfig;
  const bound={getSessionView:async()=>({session:{name:'test'},worldDocuments:{}})} as unknown as Application;
  const deps={source:async()=>{sources++;return {imageHash:'a'.repeat(64)} as never;},plan:async()=>{plans++;return recipe;}};
  try {
    const service=createSceneService(config,deps);
    await Promise.all([service.prepare(bound,'world'),service.prepare(bound,'world')]);
    async function ready(s:ReturnType<typeof createSceneService>) {for(let i=0;i<200;i++){if(s.status('world').phase==='ready')return;await new Promise(r=>setTimeout(r,10));}assert.fail('preparation timed out');}
    await ready(service);assert.equal(sources,1);assert.equal(plans,1);
    await service.heartbeat('world',{x:12,z:12,yaw:0,enabled:false});
    const original=await service.chunk('world','0,0');assert.ok(original.bytes.length>10000);
    const second=createSceneService(config,{source:async()=>{throw Error('offline');}});
    await second.prepare(bound,'world');await ready(second);
    await second.heartbeat('world',{x:12,z:12,yaw:0,enabled:false});
    assert.deepEqual((await second.chunk('world','0,0')).bytes,original.bytes);
    assert.ok((await second.exportScene('world')).byteLength>10000);
    await assert.rejects(()=>second.chunk('world','../../secret'));
  }finally{await new Promise(r=>setTimeout(r,50));await rm(dataDir,{recursive:true,force:true});}
});

test('model recipes reject unbounded or invalid outputs',()=>{
  assert.equal(recipeSchema.safeParse({...recipe,density:100}).success,false);
  assert.equal(recipeSchema.safeParse({...recipe,landmarks:['execute code']}).success,false);
});
