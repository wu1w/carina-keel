import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

const html = readFileSync(new URL("./public/app.html", import.meta.url), "utf8");
function fn(name: string) {
  const start = html.indexOf(`        function ${name}(`);
  assert.ok(start >= 0);
  const end = html.indexOf("\n        }", start + 1) + "\n        }".length;
  return html.slice(start, end);
}

test("view basis agrees with +X strafe and picking, including pitch", () => {
  const cam = { x: 0, y: 1.6, z: 0, yaw: 0.4, pitch: 0.3 };
  const { view, matrix } = runInNewContext(fn("toView") + fn("mat4look") + '\n({view:toView,matrix:mat4look})', { cam });
  const p = { x: 2, y: 2, z: 6 };
  const v = view(p), m = matrix();
  const coordinate = (r: number) => m[r]*p.x+m[4+r]*p.y+m[8+r]*p.z+m[12+r];
  assert.ok(Math.abs(coordinate(0)-v.x)<1e-9);
  assert.ok(Math.abs(coordinate(1)-v.y)<1e-9);
  assert.ok(Math.abs(coordinate(2)+v.z)<1e-9);
});

test("diagonal movement has the same speed; D moves screen-right; damping is frame-rate independent", () => {
  function simulate(keys: object, fps: number) {
    const cam = { x: 0, z: 0, yaw: 0 };
    const context = { sceneMode: false, cam, keys, surface: null, inspectGeometry: false, velocity: {x:0,z:0}, blocked: () => false, queueMove: () => {} };
    const step = runInNewContext(fn("stepPlayer")+'\nstepPlayer', context);
    for (let i=0;i<fps;i++) step(1/fps);
    return cam;
  }
  const straight = simulate({KeyW:true},60), diagonal = simulate({KeyW:true,KeyD:true},60);
  assert.ok(Math.abs(Math.hypot(diagonal.x,diagonal.z)-straight.z)<1e-9);
  assert.ok(diagonal.x>0 && diagonal.z>0);
  const slow = simulate({KeyW:true},30), fast = simulate({KeyW:true},120);
  assert.ok(Math.abs(slow.z-fast.z)<0.04);
});

test("depth mesh reprojects to the source image at its capture camera", () => {
  const cam = { x: 4, y: 1.6, z: 2, yaw: 0.5, pitch: 0.2 };
  const { mesh, view } = runInNewContext(fn("makeSurfaceMesh") + fn("toView") + '\n({mesh:makeSurfaceMesh,view:toView})', {cam});
  const data = {width:2,height:2,depth:[3,5,2,8],aspect:1.7,captureCamera:{position:cam,yaw:cam.yaw,pitch:cam.pitch,fovY:1.05}};
  const result = mesh(data);
  for (let i=0;i<4;i++) {
    const v = view({x:result.positions[i*3],y:result.positions[i*3+1],z:result.positions[i*3+2]});
    const u = 0.5+v.x/(2*v.z*Math.tan(1.05/2)*1.7);
    const t = 0.5-v.y/(2*v.z*Math.tan(1.05/2));
    assert.ok(Math.abs(u-result.uvs[i*2])<1e-9);
    assert.ok(Math.abs(t-result.uvs[i*2+1])<1e-9);
  }
});

test("neighbor switch preserves camera pose, extends coverage and reuses the return view", () => {
  const origin={id:"root",captureCamera:{position:{x:4,z:2},yaw:0}};
  const right={id:"right",captureCamera:{position:{x:4,z:2},yaw:.32}};
  const cam={x:4,z:2,yaw:.18};
  const context={cam,surface:origin,surfaceGl:null,surfaceTexture:null,inspectGeometry:false,boundary:false,pregenEnabled:false,
    viewCache:new Map([["root",{data:origin,mesh:"root-mesh",texture:"root-texture"}],["right",{data:right,mesh:"right-mesh",texture:"right-texture"}]])};
  const choose=runInNewContext(fn("viewScore")+fn("chooseView")+'\nchooseView',context);
  choose();
  assert.equal(context.surface.id,"right");assert.equal(cam.yaw,.18);assert.equal(cam.x,4);
  cam.yaw=.1;choose();
  assert.equal(context.surface.id,"root");assert.equal(context.surfaceGl,"root-mesh");
});

test('3D movement is local, collision slides along walls and unloaded chunks block escape',()=>{
  const cam={x:12,y:1.6,z:12,yaw:0};
  const chunks=new Map([['0,0',{colliders:[{min:{x:13,y:0,z:0},max:{x:13.2,y:3,z:24}}]}]]);
  const context={cam,sceneMode:true,sceneChunks:chunks,surface:null,inspectGeometry:false,keys:{KeyW:true,KeyD:true,ShiftLeft:true},velocity:{x:0,z:0},queueMove:()=>{}};
  const step=runInNewContext(fn('blocked')+fn('stepPlayer')+'\nstepPlayer',context);
  for(let i=0;i<240;i++)step(1/120);
  assert.ok(cam.x<12.73);assert.ok(cam.z>17,'forward sliding continues when right movement collides');
  for(let i=0;i<600;i++)step(1/120);
  assert.ok(cam.z<23.73,'cannot enter an unprepared chunk');
  chunks.set('0,1',{colliders:[]});
  for(let i=0;i<120;i++)step(1/120);
  assert.ok(cam.z>24,'adjacent committed chunk opens traversal without resetting the camera');
});
