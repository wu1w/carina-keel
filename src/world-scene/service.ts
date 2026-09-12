import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { randomUUID } from 'node:crypto';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import type { CarinaConfig } from '../config.js';
import type { Application } from '../server/bind-application.js';
import type { ExplorationSurface } from '../server/exploration.js';
import { buildMeshesGlb } from '../exporter/glb.js';
import { batchNodes, buildChunk, recipeSchema, SIZE, type Recipe, type Chunk } from './geometry.js';
import { z } from 'zod';

export const positionSchema=z.object({x:z.number().finite().min(-24000).max(24000),z:z.number().finite().min(-24000).max(24000),yaw:z.number().finite(),enabled:z.boolean().default(true)});
const savedSchema=z.object({version:z.literal(1),recipe:recipeSchema,seed:z.string(),sourceHash:z.string(),planningMs:z.number()});
type Saved=z.infer<typeof savedSchema>;
type State={phase:'planning'|'ready'|'failed';error?:string;saved?:Saved;chunks:Map<string,Omit<Chunk,'nodes'>>;pending:Set<string>;lease:number;anchor:{x:number;z:number};task?:Promise<void>};
type Dependencies={source:(bound:Application,id:string)=>Promise<ExplorationSurface>;plan?:(source:ExplorationSurface,context:string)=>Promise<Recipe>};

export function createSceneService(config:CarinaConfig,deps:Dependencies) {
  const states=new Map<string,State>();
  const dir=(id:string)=>{if(!/^[A-Za-z0-9_-]{1,80}$/.test(id))throw Error('Invalid session');return path.join(config.dataDir,'scenes-v2',id);};
  async function atomic(file:string,data:string|Uint8Array) {await mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,data);await rename(tmp,file);}
  async function plan(source:ExplorationSurface,context:string):Promise<Recipe> {
    if(deps.plan)return deps.plan(source,context);
    if(!config.apiKey)throw Error('场景规划需要已配置的管家模型');
    const provider=createOpenAI({apiKey:config.apiKey,baseURL:config.modelBaseUrl});
    const result=await generateText({model:provider.chat(config.model),abortSignal:AbortSignal.timeout(100_000),maxOutputTokens:1600,
      system:'You translate a world-model reference image into a reusable 3D scene construction recipe. This is semantic assembly, NOT exact reconstruction. Return JSON only. Colors must be linear RGB triples in [0.02,1]. Available detailed assets: tavern (enterable timber building), grove (pine forest), rocks, camp (tables benches barrels). Choose landmarks that match image and world context, most characteristic first. All chunks share the same palette; recipes are immutable. Schema: {"title":"Chinese title","description":"Chinese description, disclose geometric approximation","ground":[0.18,0.24,0.12],"wood":[0.25,0.13,0.07],"stone":[0.43,0.4,0.32],"foliage":[0.12,0.25,0.14],"roof":[0.25,0.12,0.08],"density":0.6,"landmarks":["tavern","grove","camp"]}. Avoid unsupported features. Do not produce code.',
      messages:[{role:'user',content:[{type:'text',text:context.slice(0,8000)},{type:'image',image:`data:${source.image.mime};base64,${source.image.base64}`}]}]});
    const text=result.text.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,'');return recipeSchema.parse(JSON.parse(text));
  }
  async function prepare(bound:Application,id:string) {
    const existing=states.get(id);if(existing&&existing.phase!=='failed')return status(id);
    // Validate the world before creating state or doing model work.
    const view=await bound.getSessionView(id);
    if(states.get(id)&&states.get(id)!.phase!=='failed')return status(id);
    const state:State={phase:'planning',chunks:new Map(),pending:new Set(),lease:Date.now()+30_000,anchor:{x:0,z:0}};states.set(id,state);
    state.task=(async()=>{
      try {
        let saved:Saved;
        try {saved=savedSchema.parse(JSON.parse(await readFile(path.join(dir(id),'recipe.json'),'utf8')));}
        catch {const start=performance.now(),source=await deps.source(bound,id);const recipe=await plan(source,JSON.stringify({name:view.session.name,documents:view.worldDocuments}));saved={version:1,recipe,seed:id,sourceHash:source.imageHash,planningMs:performance.now()-start};await atomic(path.join(dir(id),'recipe.json'),JSON.stringify(saved));}
        state.saved=saved;
        for(const file of await readdir(dir(id))){if(!/^-?\d+,-?\d+\.json$/.test(file))continue;try{const row=JSON.parse(await readFile(path.join(dir(id),file),'utf8')) as Omit<Chunk,'nodes'>;if(row.id===file.slice(0,-5))state.chunks.set(row.id,row);}catch{}}
        await build(id,state,0,0);state.phase='ready';void expand(id,state);
      }catch(error){state.phase='failed';state.error=error instanceof Error?error.message:'Scene preparation failed';}
    })();
    return status(id);
  }
  async function build(id:string,state:State,x:number,z:number) {
    const key=`${x},${z}`;if(state.chunks.has(key)||state.pending.has(key)||!state.saved)return;
    state.pending.add(key);
    try {const chunk=buildChunk(state.saved.recipe,state.saved.seed,x,z),{nodes,...meta}=chunk;
      const glb=buildMeshesGlb(batchNodes(nodes));
      await atomic(path.join(dir(id),key+'.assets.json'),JSON.stringify(nodes));
      await atomic(path.join(dir(id),key+'.glb'),glb);await atomic(path.join(dir(id),key+'.json'),JSON.stringify(meta));state.chunks.set(key,meta);
    }finally{state.pending.delete(key);}
  }
  const expanding=new Set<string>();
  async function expand(id:string,state:State) {
    if(expanding.has(id))return;expanding.add(id);
    try {while(state.lease>Date.now()&&state.phase==='ready') {
      const {x,z}=state.anchor,coords=[];
      for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)coords.push({x:x+dx,z:z+dz,d:dx*dx+dz*dz});
      const next=coords.sort((a,b)=>a.d-b.d).find(c=>!state.chunks.has(`${c.x},${c.z}`));if(!next)break;
      await build(id,state,next.x,next.z);
      // Yield between chunks so snapshots, movement transport and other sessions remain responsive.
      await new Promise<void>(resolve=>setImmediate(resolve));
    }}catch(error){state.error=String(error);}finally{expanding.delete(id);}
  }
  function status(id:string) {const state=states.get(id);if(!state)return {phase:'idle',chunks:[]};return {phase:state.phase,error:state.error,title:state.saved?.recipe.title,description:state.saved?.recipe.description,planningMs:state.saved?.planningMs,sourceHash:state.saved?.sourceHash,compilerVersion:2,chunkSize:SIZE,spawn:state.saved?.recipe.landmarks[0]==='tavern'?{x:5.8,y:1.6,z:3.4,yaw:.15}:{x:12,y:1.6,z:12,yaw:0},totalChunks:state.chunks.size,chunks:[...state.chunks.values()].filter(c=>Math.abs(c.x-state.anchor.x)<=3&&Math.abs(c.z-state.anchor.z)<=3).map(({colliders,...row})=>row),pending:[...state.pending]};}
  async function heartbeat(id:string,input:z.infer<typeof positionSchema>) {const state=states.get(id);if(!state)throw Error('Prepare the scene first');state.anchor={x:Math.floor(input.x/SIZE),z:Math.floor(input.z/SIZE)};state.lease=input.enabled?Date.now()+30_000:0;void expand(id,state);return status(id);}
  function colliders(id:string,key:string) {if(!/^-?\d+,-?\d+$/.test(key)||!states.get(id)?.chunks.has(key))throw Error('Chunk is not ready');return states.get(id)!.chunks.get(key)!.colliders;}
  async function chunk(id:string,key:string) {if(!/^-?\d+,-?\d+$/.test(key)||!states.get(id)?.chunks.has(key))throw Error('Chunk is not ready');return {bytes:await readFile(path.join(dir(id),key+'.glb')),metadata:states.get(id)!.chunks.get(key)!};}
  async function exportScene(id:string) {const state=states.get(id);if(!state?.saved||state.phase!=='ready')throw Error('Scene is not ready');
    // Bound the export to a snapshot of the prepared disk-backed chunks, retaining editable asset nodes.
    const nodes=[];for(const meta of [...state.chunks.values()]){let assets;try{assets=JSON.parse(await readFile(path.join(dir(id),meta.id+'.assets.json'),'utf8'));}catch{throw Error('This early cached chunk has no editable asset archive; export its committed chunk GLB instead.');}nodes.push(...assets);await new Promise<void>(r=>setImmediate(r));}
    return buildMeshesGlb(nodes);
  }
  async function archive(id:string) {
    const state=states.get(id);if(!state?.saved)throw Error('Scene is not ready');
    const files:Record<string,Uint8Array>={'recipe.json':strToU8(JSON.stringify(state.saved,null,2)),
      'README.txt':strToU8('Carina procedural scene assets, compiler v2. Coordinates: meters, Y up. Each GLB uses world-space node translations. Colliders live in matching JSON files. This asset archive is not the legacy .carina world-pack format. Geometry is semantic assembly from a generated reference, not calibrated reconstruction.')} ;
    for(const meta of [...state.chunks.values()]) {files['chunks/'+meta.id+'.glb']=await readFile(path.join(dir(id),meta.id+'.glb'));files['chunks/'+meta.id+'.json']=strToU8(JSON.stringify(meta));}
    return zipSync(files,{level:0});
  }
  return {prepare,status,heartbeat,chunk,colliders,exportScene,archive};
}
