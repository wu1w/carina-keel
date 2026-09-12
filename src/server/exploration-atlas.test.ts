import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createExplorationAtlas, nextCamera } from "./exploration-atlas.js";
import { loadConfig } from "../config.js";
import type { ExplorationSurface } from "./exploration.js";
const root:ExplorationSurface={schemaVersion:1,quality:"estimated-single-view",imageHash:"a".repeat(64),image:{mime:"image/jpeg",base64:"eA=="},width:2,height:2,aspect:1.7,depth:[2,3,4,5],captureCamera:{position:{x:4,y:1.6,z:2},yaw:0,pitch:0,fovY:1.05,aspect:1.7}};

test("numeric relative cameras follow the same navigation axes",()=>{
 assert.equal(nextCamera(root.captureCamera,"forward").position.z,2.55);
 assert.equal(nextCamera(root.captureCamera,"right").yaw,.32);
 assert.equal(nextCamera(root.captureCamera,"strafeLeft").position.x,3.45);
 const rotated=nextCamera({...root.captureCamera,yaw:Math.PI/2},"forward");
 assert.ok(Math.abs(rotated.position.x-4.55)<1e-9);
});

test("prefetch is asynchronous, deduplicated, cancellable and retained across restart",async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),"carina-atlas-"));t.after(()=>rm(dir,{recursive:true,force:true}));
 const config=loadConfig({CARINA_DATA_DIR:dir,CARINA_RENDERER_URL:"http://unused",CARINA_DEPTH_URL:"http://unused"});
 let release!:()=>void, count=0;
 const barrier=new Promise<void>(r=>release=r);
 const atlas=createExplorationAtlas(config,async()=>{count++;await barrier;return root;});
 await atlas.ensureRoot("world1",root);
 const input={root:root.imageHash,source:root.imageHash,enabled:true};
 await atlas.prefetch("world1",input);
 await atlas.prefetch("world1",input);
 let status=await atlas.status("world1",root.imageHash);
 assert.equal(status.jobs.length,3);assert.equal(count,1);
 await atlas.prefetch("world1",{...input,enabled:false});
 status=await atlas.status("world1",root.imageHash);
 assert.equal(status.jobs.length,1);
 release();
 for(let i=0;i<100;i++) {status=await atlas.status("world1",root.imageHash);if(status.nodes.length===2)break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(status.nodes.length,2);assert.equal(count,1);
 const restarted=createExplorationAtlas(loadConfig({CARINA_DATA_DIR:dir}));
 assert.equal((await restarted.status("world1",root.imageHash)).nodes.length,2);
 assert.equal((await restarted.status("world2",root.imageHash)).nodes.length,0);
 const original=await restarted.read("world1",root.imageHash,root.imageHash);
 assert.deepEqual(original.captureCamera,root.captureCamera);
 await assert.rejects(restarted.read("../bad",root.imageHash,root.imageHash));
});

test("warmup runs without movement and keeps expanding after readiness within its budget",async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),"carina-warmup-"));t.after(()=>rm(dir,{recursive:true,force:true}));
 const config={...loadConfig({CARINA_DATA_DIR:dir,CARINA_RENDERER_URL:"http://unused",CARINA_DEPTH_URL:"http://unused"}),explorationBudget:28,explorationWarmupViews:24};
 let count=0;
 const atlas=createExplorationAtlas(config,async()=>{count++;return root;});
 await atlas.ensureRoot("world",root);
 await atlas.prefetch("world",{root:root.imageHash,source:root.imageHash,enabled:true,phase:"warmup"});
 let status=await atlas.status("world",root.imageHash);
 for(let i=0;i<400;i++) {status=await atlas.status("world",root.imageHash);if(status.nodes.length===28)break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(status.nodes.length,28);
 assert.equal(status.warmup.ready,true);
 assert.equal(count,27);
 assert.ok(status.warmup.coverage>.99);
 assert.ok(!status.jobs.some(j=>j.state==="queued"||j.state==="generating"));
});

test("depth retry reuses the saved generated frame instead of repeating GPU inference",async t=>{
 const {createServer}=await import("node:http");
 const {sha256Hex}=await import("../pack/hash.js");
 const {generateNeighbor}=await import("./exploration-atlas.js");
 const dir=await mkdtemp(path.join(tmpdir(),"carina-frame-retry-"));t.after(()=>rm(dir,{recursive:true,force:true}));
 let generations=0,depths=0;
 const server=createServer((req,res)=>{
  req.resume();req.on("end",()=>{
   res.setHeader("content-type","application/json");
   if(req.url==="/v1/explore") {generations++;res.end(JSON.stringify({base64:"eA==",cameraConditioning:"numeric-opencv",frameCount:13}));}
   else {depths++;if(depths===1){res.statusCode=503;res.end("{}");}else res.end(JSON.stringify({...root,imageHash:sha256Hex(Buffer.from("x"))}));}
  });
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>server.close());
 const addr=server.address();assert.ok(addr&&typeof addr!=="string");
 const url=`http://127.0.0.1:${addr.port}`;
 const config=loadConfig({CARINA_DATA_DIR:dir,CARINA_RENDERER_URL:url,CARINA_DEPTH_URL:url});
 await assert.rejects(generateNeighbor(config,root,"forward"));
 await generateNeighbor(config,root,"forward");
 assert.equal(generations,1);assert.equal(depths,2);
});
