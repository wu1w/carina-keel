import { mkdir, readFile, readdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sha256Hex } from "../pack/hash.js";
import type { CarinaConfig } from "../config.js";
import { cachedSchema, explorationSchema, type ExplorationSurface } from "./exploration.js";

export const directionSchema = z.enum(["forward", "back", "left", "right", "strafeLeft", "strafeRight"]);
type Direction = z.infer<typeof directionSchema>;
export const prefetchSchema = z.object({ root: z.string().regex(/^[a-f0-9]{64}$/), source: z.string().regex(/^[a-f0-9]{64}$/), direction: directionSchema.optional(), enabled: z.boolean().default(true), phase: z.enum(["warmup", "exploring"]).optional() });
const nodeSchema = cachedSchema.and(z.object({ id: z.string(), parentId: z.string().optional(), direction: directionSchema.optional() }));
type Node = z.infer<typeof nodeSchema>;
type Task = { world: string; root: string; source: Node; direction: Direction; id: string; key: string; state: "queued" | "generating" | "ready" | "failed"; error?: string; retryAt?: number; automatic?: boolean };
type Lease = { anchor: string; phase: "warmup" | "exploring"; expiresAt: number };
const ALL_DIRECTIONS: Direction[] = ["left","right","forward","back","strafeLeft","strafeRight"];
const angleDistance = (a:number,b:number) => Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
const sameCamera = (a:ExplorationSurface["captureCamera"],b:ExplorationSurface["captureCamera"]) =>
  Math.hypot(a.position.x-b.position.x,a.position.z-b.position.z)<.12 && angleDistance(a.yaw,b.yaw)<.12;

export function warmupStatus(list:Array<{captureCamera:ExplorationSurface["captureCamera"]}>, origin:ExplorationSurface["captureCamera"], target:number) {
  const angles=list.filter(n=>Math.hypot(n.captureCamera.position.x-origin.position.x,n.captureCamera.position.z-origin.position.z)<.12)
    .map(n=>((n.captureCamera.yaw%(2*Math.PI))+2*Math.PI)%(2*Math.PI)).sort((a,b)=>a-b);
  let gap=2*Math.PI;
  if(angles.length>1) gap=Math.max(...angles.map((a,i)=>(i+1<angles.length?angles[i+1]!:angles[0]!+2*Math.PI)-a));
  const coverage=Math.min(1,(2*Math.PI-gap+.35)/(2*Math.PI));
  return { target, completed:list.length, coverage, ready:list.length>=target && gap<=.40 };
}

export function nextCamera(c: ExplorationSurface["captureCamera"], direction: Direction) {
  const localX = direction === "strafeLeft" ? -.55 : direction === "strafeRight" ? .55 : 0;
  const localZ = direction === "forward" ? .55 : direction === "back" ? -.55 : 0;
  return { ...c, position: { ...c.position,
    x: c.position.x + Math.cos(c.yaw)*localX + Math.sin(c.yaw)*localZ,
    z: c.position.z - Math.sin(c.yaw)*localX + Math.cos(c.yaw)*localZ },
    yaw: c.yaw + (direction === "left" ? -.32 : direction === "right" ? .32 : 0) };
}

export function createExplorationAtlas(config: CarinaConfig, generate = generateNeighbor) {
  const tasks = new Map<string, Task>();
  const queue: Task[] = [];
  let running = false;
  const lists = new Map<string, Node[]>();
  const leases = new Map<string, Lease>();
  const expanding = new Set<string>();
  const budget=config.explorationBudget ?? 192;
  const warmupTarget=Math.min(budget,config.explorationWarmupViews ?? 24);
  function directory(world: string, root: string) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(world) || !/^[a-f0-9]{64}$/.test(root)) throw new Error("Invalid atlas");
    return path.join(config.dataDir, "exploration", world, "atlas", root);
  }
  async function read(world: string, root: string, id: string): Promise<Node> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid node");
    return nodeSchema.parse(JSON.parse(await readFile(path.join(directory(world,root),id+".json"),"utf8")));
  }
  async function save(world: string, root: string, node: Node) {
    const dir = directory(world,root);
    await mkdir(dir,{recursive:true});
    const target = path.join(dir,node.id+".json");
    const temporary=target+"."+randomUUID()+".tmp";
    await writeFile(temporary,JSON.stringify(node));
    await rename(temporary,target);
    const cached=lists.get(dir);
    if (cached) {const index=cached.findIndex(n=>n.id===node.id);if(index<0)cached.push(node);else cached[index]=node;}
  }
  async function ensureRoot(world: string, surface: ExplorationSurface) {
    const root = surface.imageHash;
    try { await read(world,root,root); }
    catch { await save(world,root,{...surface,id:root}); }
    return root;
  }
  async function nodes(world: string, root: string) {
    const dir=directory(world,root);
    const cached=lists.get(dir);
    if (cached) return cached;
    const files = await readdir(dir).catch(() => []);
    const list: Node[] = [];
    for (const file of files) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
      list.push(await read(world,root,file.slice(0,-5)));
    }
    lists.set(dir,list);
    return list;
  }
  async function status(world: string, root: string) {
    const list = await nodes(world,root);
    const origin=list.find(n=>n.id===root);
    return { root, budget, warmup:origin ? warmupStatus(list,origin.captureCamera,warmupTarget) : {target:warmupTarget,completed:0,coverage:0,ready:false},
      nodes:list.map(n => ({id:n.id,parentId:n.parentId,direction:n.direction,captureCamera:n.captureCamera})),
      jobs:[...tasks.values()].filter(t => t.world===world && t.root===root).map(t => ({id:t.id,source:t.source.id,direction:t.direction,state:t.state,error:t.error})) };
  }
  function enqueue(world:string,root:string,source:Node,direction:Direction,list:Node[],priority:boolean,automatic:boolean) {
    const id=sha256Hex(Buffer.from(source.id+":"+direction));
    const key=world+":"+root+":"+id;
    const existing=tasks.get(key);
    if(existing?.state==="queued" && priority) {
      const index=queue.indexOf(existing);if(index>=0){queue.splice(index,1);queue.unshift(existing);}
    }
    if(list.some(n=>n.id===id)||(existing&&(existing.state!=="failed"||(existing.retryAt??0)>Date.now())))return false;
    const target=nextCamera(source.captureCamera,direction);
    if(list.some(n=>sameCamera(n.captureCamera,target)))return false;
    const active=[...tasks.values()].filter(t=>t.world===world&&t.root===root&&(t.state==="queued"||t.state==="generating"));
    if(list.length+active.length>=budget||active.length>=8)return false;
    if(active.some(t=>sameCamera(nextCamera(t.source.captureCamera,t.direction),target)))return false;
    const task:Task={world,root,source,direction,id,key,state:"queued",automatic};
    tasks.set(key,task);if(priority)queue.unshift(task);else queue.push(task);
    return true;
  }
  async function expand(world:string,root:string) {
    const key=world+":"+root, lease=leases.get(key);
    if(!lease||lease.expiresAt<Date.now()||expanding.has(key))return;
    expanding.add(key);
    try {
      const list=await nodes(world,root);
      if(leases.get(key)!==lease||lease.expiresAt<Date.now())return;
      const origin=list.find(n=>n.id===root), anchor=list.find(n=>n.id===lease.anchor)??origin;
      if(!origin||!anchor||list.length>=budget)return;
      const warm=warmupStatus(list,origin.captureCamera,warmupTarget);
      const warming=!warm.ready;
      const buildingRing=warm.coverage<.992;
      const candidates=list.flatMap(source=>ALL_DIRECTIONS.map(direction=>{
        const target=nextCamera(source.captureCamera,direction);
        const focus=warming?origin.captureCamera:anchor.captureCamera;
        const dx=target.position.x-focus.position.x,dz=target.position.z-focus.position.z;
        const distance=Math.hypot(dx,dz);
        const angle=angleDistance(target.yaw,focus.yaw);
        const rotation=direction==="left"||direction==="right";
        const score=warming ? (distance<.12&&rotation ? angle*.1 : 5+distance+angle) :
          distance+angle*.5-.2*(Math.sin(focus.yaw)*dx+Math.cos(focus.yaw)*dz);
        return {source,direction,score,ring:distance<.12&&rotation};
      })).filter(candidate=>!buildingRing||candidate.ring).sort((a,b)=>a.score-b.score);
      for(const candidate of candidates) {
        if(leases.get(key)!==lease)break;
        enqueue(world,root,candidate.source,candidate.direction,list,false,true);
        if(queue.filter(t=>t.world===world&&t.root===root).length>=8)break;
      }
    } finally {expanding.delete(key);}
  }
  async function work() {
    if (running) return;
    running=true;
    try {
      while (queue.length) {
        const task=queue.shift()!;
        const lease=leases.get(task.world+":"+task.root);
        if(task.automatic&&(!lease||lease.expiresAt<Date.now())) {tasks.delete(task.key);continue;}
        task.state="generating";
        try {
          const surface=await generate(config,task.source,task.direction);
          await save(task.world,task.root,{...surface,id:task.id,parentId:task.source.id,direction:task.direction,captureCamera:nextCamera(task.source.captureCamera,task.direction)});
          task.state="ready";
        } catch (error) {
          task.state="failed";
          task.error=error instanceof Error ? error.message : "Generation failed";
          task.retryAt=Date.now()+60_000;
        }
        await expand(task.world,task.root);
      }
    } finally { running=false; }
  }
  async function prefetch(world: string, input: z.infer<typeof prefetchSchema>) {
    const source = await read(world,input.root,input.source);
    const key=world+":"+input.root;
    if (!input.enabled) {
      leases.delete(key);
      for (let i=queue.length-1;i>=0;i--) if (queue[i]!.world===world) { tasks.delete(queue[i]!.key); queue.splice(i,1); }
      return status(world,input.root);
    }
    if (!config.rendererUrl || !config.depthUrl) throw new Error("Generation services are not configured");
    if(input.phase)leases.set(key,{anchor:source.id,phase:input.phase,expiresAt:Date.now()+60_000});
    const list=await nodes(world,input.root);
    if(input.direction) enqueue(world,input.root,source,input.direction,list,true,!!input.phase);
    else if(!input.phase) for(const direction of ["forward","left","right"] as Direction[]) enqueue(world,input.root,source,direction,list,false,false);
    await expand(world,input.root);
    void work();
    return status(world,input.root);
  }
  return { ensureRoot, read, status, prefetch };
}

export async function generateNeighbor(config: CarinaConfig, source: ExplorationSurface, direction: Direction): Promise<ExplorationSurface> {
  const frameSchema=z.object({base64:z.string().max(16_000_000),cameraConditioning:z.literal("numeric-opencv"),frameCount:z.number().min(2)});
  const frameKey=sha256Hex(Buffer.from(source.imageHash+":"+direction+":"+source.captureCamera.fovY));
  const frameDir=path.join(config.dataDir,"exploration-frames");
  const frameFile=path.join(frameDir,frameKey+".json");
  let frame;
  try { frame=frameSchema.parse(JSON.parse(await readFile(frameFile,"utf8"))); } catch { /* First generation. */ }
  if(!frame) {
    const response=await fetch(new URL("/v1/explore",config.rendererUrl),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({base64:source.image.base64,direction,fovY:source.captureCamera.fovY,seed:parseInt(source.imageHash.slice(0,7),16)}),signal:AbortSignal.timeout(240_000)});
    if (!response.ok) throw new Error(response.status===429 ? "Generator busy; retry later" : "Camera generation failed");
    frame=frameSchema.parse(await response.json());
    await mkdir(frameDir,{recursive:true});
    const temporary=frameFile+"."+randomUUID()+".tmp";
    await writeFile(temporary,JSON.stringify(frame));
    await rename(temporary,frameFile);
  }
  const depth=await fetch(new URL("/reconstruct",config.depthUrl),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({base64:frame.base64}),signal:AbortSignal.timeout(90_000)});
  if (!depth.ok) throw new Error("Neighbor depth reconstruction failed");
  const surface=explorationSchema.parse(await depth.json());
  if (surface.imageHash!==sha256Hex(Buffer.from(frame.base64,"base64"))) throw new Error("Mismatched neighbor image");
  return {...surface,captureCamera:nextCamera(source.captureCamera,direction)};
}
