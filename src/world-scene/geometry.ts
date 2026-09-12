import type { MeshNode } from '../exporter/glb.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const color = z.tuple([z.number().min(.02).max(1),z.number().min(.02).max(1),z.number().min(.02).max(1)]);
export const recipeSchema = z.object({
  title: z.string().max(120), description: z.string().max(1200),
  ground: color, wood: color, stone: color, foliage: color, roof: color,
  density: z.number().min(.15).max(1),
  landmarks: z.array(z.enum(['tavern','grove','rocks','camp'])).min(1).max(12),
});
export type Recipe = z.infer<typeof recipeSchema>;
export const SIZE = 24;
export type Box = {min:{x:number;y:number;z:number};max:{x:number;y:number;z:number}};
export type Chunk = {id:string;x:number;z:number;nodes:MeshNode[];colliders:Box[];buildMs:number;triangles:number};
type Color = [number,number,number];
const wood: Color = [.28,.15,.075], metal:Color=[.12,.13,.13], glass:Color=[.95,.59,.19];

/** Parameterized solid assets: no camera projection, depth sheets or view-dependent geometry. */
class Builder {
  nodes:MeshNode[]=[]; colliders:Box[]=[];
  constructor(readonly x:number,readonly z:number){}
  node(name:string, positions:number[], normals:number[], indices:number[], albedo:Color) {
    this.nodes.push({name,translation:{x:this.x*SIZE,y:0,z:this.z*SIZE},mesh:{positions,normals,indices,albedo}});
  }
  box(name:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,c:Color,solid=false) {
    const p:number[]=[],n:number[]=[],idx:number[]=[];
    for(const [axis,sign] of [[0,1],[0,-1],[1,1],[1,-1],[2,1],[2,-1]]) {
      const a=axis!, s=sign!, b=(a+1)%3,d=(a+2)%3, center=[x,y+sy/2,z],size=[sx,sy,sz],base=p.length/3;
      for(const [u,v] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
        const q=[...center],normal=[0,0,0];q[a]=center[a]!+s*size[a]!/2;q[b]=center[b]!+u!*size[b]!/2;q[d]=center[d]!+v!*size[d]!/2;normal[a]=s;p.push(...q);n.push(...normal);
      }
      if(s>0)idx.push(base,base+1,base+2,base,base+2,base+3);else idx.push(base,base+2,base+1,base,base+3,base+2);
    }
    this.node(name,p,n,idx,c);
    if(solid) this.colliders.push({min:{x:x-sx/2+this.x*SIZE,y,z:z-sz/2+this.z*SIZE},max:{x:x+sx/2+this.x*SIZE,y:y+sy,z:z+sz/2+this.z*SIZE}});
  }
  lathe(name:string,x:number,y:number,z:number,profile:number[][],c:Color,segments=12) {
    const p:number[]=[],n:number[]=[],idx:number[]=[];
    for(let j=0;j<profile.length;j++) {
      const [r,h]=profile[j]!;
      const before=profile[Math.max(0,j-1)]!,after=profile[Math.min(profile.length-1,j+1)]!;
      const ny=before[0]!-after[0]!,nr=after[1]!-before[1]!,len=Math.hypot(ny,nr)||1;
      for(let i=0;i<=segments;i++) {const a=i/segments*Math.PI*2;p.push(x+Math.cos(a)*r!,y+h!,z+Math.sin(a)*r!);n.push(Math.cos(a)*nr/len,ny/len,Math.sin(a)*nr/len);
        if(j<profile.length-1&&i<segments){const k=j*(segments+1)+i;idx.push(k,k+1,k+segments+2,k,k+segments+2,k+segments+1);}
      }
    }
    this.node(name,p,n,idx,c);
  }
  barrel(x:number,z:number,c:Color) {
    this.lathe('barrel',x,0,z,[[0,0],[.38,0],[.48,.25],[.5,.65],[.43,1.1],[0,1.1]],c,16);
    for(const y of [.16,.8])this.lathe('iron hoop',x,y,z,[[.47,0],[.49,.045],[.49,.11],[.47,.15]],metal,16);
    this.colliders.push({min:{x:x-.5+this.x*SIZE,y:0,z:z-.5+this.z*SIZE},max:{x:x+.5+this.x*SIZE,y:1.1,z:z+.5+this.z*SIZE}});
  }
  table(x:number,z:number,c:Color) {
    for(let i=0;i<5;i++)this.box('table plank',x-.8+i*.4,.85,z,.385,.12,1.15,c);
    for(const dx of [-.75,.75])for(const dz of [-.4,.4])this.box('table leg',x+dx,0,z+dz,.13,.85,.13,c);
    this.colliders.push({min:{x:x-1+this.x*SIZE,y:0,z:z-.58+this.z*SIZE},max:{x:x+1+this.x*SIZE,y:.97,z:z+.58+this.z*SIZE}});
    for(const dz of [-1.1,1.1]) {this.box('bench',x,.43,z+dz,1.9,.12,.38,c,true);for(const dx of [-.7,.7])this.box('bench support',x+dx,0,z+dz,.15,.43,.3,c);}
    this.lathe('ceramic jug',x+.25,.97,z,[[.05,0],[.13,.04],[.15,.18],[.07,.28],[.08,.34]], [.68,.4,.2]);
  }
  tree(x:number,z:number,r:number,c:Color) {
    this.lathe('trunk',x,0,z,[[.3,0],[.17,2],[.09,4.4]],wood);
    for(let i=0;i<3;i++)this.lathe('canopy',x,1.7+i*.9,z,[[r*(1-i*.17),0],[r*.63,.45],[0,2.25]],c,10);
    this.colliders.push({min:{x:x-.32+this.x*SIZE,y:0,z:z-.32+this.z*SIZE},max:{x:x+.32+this.x*SIZE,y:4,z:z+.32+this.z*SIZE}});
  }
  tavern(x:number,z:number,r:Recipe) {
    // Open doorway at -Z, actual interior, solid wall colliders and articulated furniture.
    this.box('foundation',x,-.12,z,7,.12,7,r.stone);
    for(let i=0;i<23;i++)this.box('floorboard',x-3.3+i*.3,0,z,.285,.045,6.8,r.wood);
    this.box('rear plaster',x,0,z+3.5,7,3.4,.22,r.stone,true);
    for(const dx of [-3.5,3.5]) this.box('side plaster',x+dx,0,z,.22,3.4,7,r.stone,true);
    for(const dx of [-2.3,2.3])this.box('entry wall',x+dx,0,z-3.5,2.4,3.4,.22,r.stone,true);
    this.box('door lintel',x,2.5,z-3.5,2.2,.9,.25,r.wood);
    for(const dx of [-3.5,-1.05,1.05,3.5]) this.box('timber upright',x+dx,0,z-3.63,.18,3.5,.18,r.wood);
    for(const zz of [-3.63,3.63])for(const y of [.4,3.1])this.box('timber rail',x,y,z+zz,7.2,.18,.18,r.wood);
    // Sloped roof made from two continuous triangle planes with thickness below the ridge.
    const p=[x-3.9,3.5,z-3.9,x,5.1,z-3.9,x,5.1,z+3.9,x-3.9,3.5,z+3.9,x,5.1,z-3.9,x+3.9,3.5,z-3.9,x+3.9,3.5,z+3.9,x,5.1,z+3.9];
    this.node('pitched roof',p,[-.38,.92,0,-.38,.92,0,-.38,.92,0,-.38,.92,0,.38,.92,0,.38,.92,0,.38,.92,0,.38,.92,0],[0,2,1,0,3,2,4,6,5,4,7,6],r.roof);
    // Close the roof gables, then add interior joinery and shelves as independently exportable meshes.
    for(const [zz,normal] of [[z-3.5,-1],[z+3.5,1]]) {
      this.node('plaster gable',[x-3.5,3.4,zz!,x+3.5,3.4,zz!,x,5,zz!],[0,0,normal!,0,0,normal!,0,0,normal!],normal!>0?[0,1,2]:[0,2,1],r.stone);
    }
    for(const zz of [-2.5,-.8,.8,2.5])this.box('ceiling beam',x,3.25,z+zz,7,.22,.18,r.wood);
    for(const yy of [1.3,2,2.7]) {
      this.box('bottle shelf',x,yy,z+3.1,4.8,.1,.5,r.wood);
      for(let i=0;i<9;i++)this.lathe('bottle',x-2+i*.5,yy+.1,z+3.08,[[.08,0],[.09,.23],[.04,.31],[.04,.42],[0,.43]],i%2?r.foliage:glass,8);
    }
    for(const xx of [-2.4,2.4])this.box('shelf upright',x+xx,1.15,z+3.1,.1,1.7,.5,r.wood);
    this.box('chimney' ,x+2.4,3,z+2,.65,2.7,.65,r.stone);
    this.box('bar counter',x+2.4,0,z+1.1,.75,1.05,3.2,r.wood,true);
    this.table(x-1.4,z+.7,r.wood); this.barrel(x+2.5,z+2.7,r.wood);
    for(const dx of [-1.35,1.35]) {this.box('lantern bracket',x+dx,1.9,z-3.85,.08,.5,.08,metal);this.box('lantern glow',x+dx,1.85,z-3.86,.24,.3,.22,glass);}
  }
}
function random(seed:string) {let state=createHash('sha256').update(seed).digest().readUInt32LE();return()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};}

export function buildChunk(recipe:Recipe,seed:string,x:number,z:number):Chunk {
  const start=performance.now(),b=new Builder(x,z),rnd=random(`${seed}:${x}:${z}`);
  b.box('ground',12,-.18,12,24,.18,24,recipe.ground);
  // Globally aligned 4 m trails guarantee seam continuity and traversable edges.
  b.box('trail north',12,.004,12,4,.008,24,recipe.stone);
  b.box('trail east',12,.005,12,24,.008,4,recipe.stone);
  const kind=x===0&&z===0?recipe.landmarks[0]:recipe.landmarks[Math.floor(rnd()*recipe.landmarks.length)];
  if(kind==='tavern')b.tavern(5.8,6,recipe);
  if(kind==='camp') {b.table(5,5,recipe.wood);b.barrel(7,7,recipe.wood);}
  for(let i=0;i<Math.floor(12+recipe.density*16);i++) {
    const px=1.8+rnd()*20.4,pz=1.8+rnd()*20.4;
    if(Math.abs(px-12)<3.2||Math.abs(pz-12)<3.2||(kind==='tavern'&&px<10&&pz<10))continue;
    if(rnd()<.75&&kind!=='rocks')b.tree(px,pz,.9+rnd()*.9,recipe.foliage);
    else b.lathe('weathered rock',px,-.08,pz,[[.65,0],[.8,.35],[.52,.85],[.1,1.1]],recipe.stone,7);
  }
  const triangles=b.nodes.reduce((s,n)=>s+n.mesh.indices.length/3,0);
  return {id:`${x},${z}`,x,z,nodes:b.nodes,colliders:b.colliders,triangles,buildMs:performance.now()-start};
}

/** Batching by material keeps a chunk to a handful of draws. Preserve originals for editable export. */
export function batchNodes(nodes:MeshNode[]):MeshNode[] {
  const groups=new Map<string,MeshNode>();
  for(const node of nodes){const key=node.mesh.albedo.join(',');let dest=groups.get(key);
    if(!dest||dest.mesh.positions.length/3+node.mesh.positions.length/3>60000) {
      dest={name:node.name,translation:node.translation,mesh:{positions:[],normals:[],indices:[],albedo:node.mesh.albedo}};groups.set(key+':'+groups.size,dest);groups.set(key,dest);
    }
    const base=dest.mesh.positions.length/3;
    dest.mesh.positions.push(...node.mesh.positions);dest.mesh.normals.push(...node.mesh.normals);dest.mesh.indices.push(...node.mesh.indices.map(i=>i+base));
  }
  return [...new Set(groups.values())];
}
