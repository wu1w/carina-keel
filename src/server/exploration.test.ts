import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { loadConfig } from "../config.js";
import { createExplorationLoader, explorationSchema } from "./exploration.js";
import { sha256Hex } from "../pack/hash.js";
import type { Application } from "./bind-application.js";

const camera = {position:{x:4,y:1.6,z:2},yaw:0,pitch:0,fovY:1.05,aspect:1.7};
const image = Buffer.from("test image");
const surface = {schemaVersion:1,quality:"estimated-single-view",imageHash:sha256Hex(image),image:{mime:"image/jpeg",base64:image.toString("base64")},width:2,height:2,aspect:1.7,depth:[2,3,4,5]};

test("rejects invalid reconstruction dimensions and nonphysical depth", () => {
  assert.equal(explorationSchema.safeParse(surface).success,true);
  assert.equal(explorationSchema.safeParse({...surface,depth:[2,3]}).success,false);
  assert.equal(explorationSchema.safeParse({...surface,depth:[2,0,4,5]}).success,false);
});

test("coalesces reconstruction and restores the captured camera offline without cross-session reuse", async t => {
  const dir = await mkdtemp(path.join(tmpdir(),"carina-exploration-"));
  t.after(() => rm(dir,{recursive:true,force:true}));
  let requests = 0;
  const server = createServer((req,res) => {
    requests++;
    req.resume();
    req.on("end", () => {res.setHeader("content-type","application/json");res.end(JSON.stringify(surface));});
  });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const config = loadConfig({CARINA_DATA_DIR:dir,CARINA_DEPTH_URL:`http://127.0.0.1:${address.port}`});
  let moved = false;
  const bound = {
    getCommittedMap:async () => ({captureCamera:moved?{...camera,position:{x:99,y:1.6,z:99}}:camera}),
    getObservation:() => ({still:{mime:"image/jpeg",base64:image.toString("base64")}}),
  } as unknown as Application;
  const load = createExplorationLoader(config);
  const [a,b] = await Promise.all([load(bound,"world1"),load(bound,"world1")]);
  assert.deepEqual(a,b);
  assert.equal(requests,1);
  moved = true;
  const offline = createExplorationLoader(loadConfig({CARINA_DATA_DIR:dir}));
  assert.deepEqual(await offline(bound,"world1"),a);
  await assert.rejects(offline(bound,"world2"));
  await assert.rejects(offline(bound,"../escape"));
});
