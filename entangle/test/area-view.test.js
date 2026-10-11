import test from 'node:test';
import assert from 'node:assert/strict';
import { areaMembership, selectAreaGraph, buildGraph } from '../server/graph.js';
import { areaLayout, areaEdges, viewPositionKey } from '../src/area-view.js';
import { starterSandbox } from '../src/sandbox.js';
import { filterDiagnosticGraph } from '../src/graph-ui.js';
import { createApp } from '../server/index.js';
const configuration={automations:[],scripts:{},warnings:[]};
const data={areas:[{area_id:'office',name:'Office'},{area_id:'hall',name:'Hall'}],devices:[{id:'desk',name:'Desk',area_id:'office'}],entities:[{entity_id:'light.desk',device_id:'desk'},{entity_id:'sensor.door',device_id:'desk',area_id:'hall'},{entity_id:'sensor.debug',device_id:'desk',entity_category:'diagnostic'}],states:[],warnings:[]};
test('compact device containers replace ownership lines and ignore flowchart direction',()=>{
 const nodes=[{id:'area',kind:'area',label:'Room'},{id:'d1',kind:'device',label:'Desk'},{id:'d2',kind:'device',label:'Lamp'},
  ...Array.from({length:7},(_,i)=>({id:`e${i}`,kind:'entity',label:`Entity ${i}`})),{id:'auto',kind:'automation',label:'Arrival'}];
 const edges=nodes.filter(n=>n.kind==='entity').map((n,i)=>({id:n.id,source:i%2?'d2':'d1',target:n.id,relationship:'provides'}));
 edges.push({id:'a1',source:'area',target:'d1',relationship:'contains'},{id:'a2',source:'area',target:'d2',relationship:'contains'},
  {id:'trigger',source:'auto',target:'e0',relationship:'triggers from'});
 const graph={nodes,edges}, result=areaLayout(graph);
 assert.deepEqual(result,areaLayout(graph,'TB'));
 assert.equal(result.nodes.length,nodes.length);
 for(const device of ['d1','d2']) assert.equal(result.nodes.find(n=>n.id===device).type,'deviceGroup');
 for(let i=0;i<7;i++) assert.equal(result.nodes.find(n=>n.id===`e${i}`).parentId,i%2?'d2':'d1');
 assert.deepEqual(result.edges.map(e=>e.id),['trigger']);
 assert.deepEqual(areaEdges(result),[]);
 assert.deepEqual(areaEdges(result,'d1').map(e=>e.id),['trigger']);
 assert.deepEqual(areaEdges(result,'area').map(e=>e.id),['trigger']);
 assert.deepEqual(areaEdges(result,'d2'),[]);
 assert.deepEqual(areaEdges(result,'','',true),result.edges);
 assert.deepEqual(areaEdges(result,'','trigger'),result.edges);
 const hidden=filterDiagnosticGraph({...graph,nodes:nodes.map(n=>['e0','e2'].includes(n.id)?{...n,entity_category:'diagnostic'}:n)});
 const smaller=areaLayout(hidden);
 assert.ok(smaller.nodes.find(n=>n.id==='d1').style.height<result.nodes.find(n=>n.id==='d1').style.height);
});
test('HA area grouping honors explicit assignments over devices and includes empty rooms',()=>{
 const graph=buildGraph(data,configuration), membership=areaMembership(graph);
 assert.equal(membership.get('light.desk'),'area:office');
 assert.equal(membership.get('device:desk'),'area:office');
 assert.equal(membership.get('sensor.door'),'area:hall');
 const result=areaLayout(selectAreaGraph(graph));
 assert.equal(result.nodes.find(n=>n.id==='sensor.door').parentId,'area:hall');
 assert.equal(result.edges.some(e=>/area$/.test(e.relationship)),false);
 assert.equal(result.edges.some(e=>e.relationship==='owned by'),false);
 assert.equal(result.nodes.find(n=>n.id==='light.desk').parentId,'device:desk');
 assert.deepEqual(graph,buildGraph(data,configuration));
});
test('sandbox inherits device areas, keeps cross-room links, and leaves unassigned nodes outside',()=>{
 const graph=starterSandbox();graph.edges=graph.edges.filter(e=>e.id!=='e3');
 const result=areaLayout(selectAreaGraph(graph));
 assert.equal(result.nodes.find(n=>n.id==='lamp').parentId,'lamp-device');
 assert.equal(result.nodes.find(n=>n.id==='door').parentId,'door-device');
 assert.equal(result.nodes.find(n=>n.id==='arrival').parentId,undefined);
 assert.ok(result.edges.some(e=>e.id==='e8'));
 assert.equal(result.nodes[0].type,'area');
 graph.nodes.push({id:'hall',kind:'area',label:'Hall'});
 graph.edges.push({id:'direct',source:'hall',target:'lamp',relationship:'assigned to'});
 assert.equal(areaMembership(graph).get('lamp'),'hall');
 graph.edges.push({id:'conflict',source:'studio',target:'lamp',relationship:'assigned to'});
 assert.equal(areaMembership(graph).has('lamp'),false);
});
test('container geometry encloses members in both directions and manual positions stay within their view',()=>{
 for(const direction of ['LR','TB']) {
  const graph=selectAreaGraph(starterSandbox()), result=areaLayout(graph,direction);
  for(const child of result.nodes.filter(n=>n.parentId)) {
   const parent=result.nodes.find(n=>n.id===child.parentId);
   assert.ok(result.nodes.indexOf(parent)<result.nodes.indexOf(child));
   assert.ok(child.position.x>=24 && child.position.y>=64);
   assert.ok(child.position.x+(child.style?.width || 220)<=parent.style.width && child.position.y+(child.style?.height || 90)<=parent.style.height);
   assert.equal(child.extent,'parent');
  }
  const saved={lamp:{x:480,y:250,parentId:'lamp-device'}};
  const moved=areaLayout(graph,direction,new Map(),saved);
  assert.deepEqual(moved.nodes.find(n=>n.id==='lamp').position,{x:480,y:250});
  const expanded=areaLayout(graph,direction,new Map(moved.nodes.map(n=>[n.id,n])),saved);
  assert.deepEqual(expanded.nodes.find(n=>n.id==='lamp').position,{x:480,y:250});
  const stale=areaLayout(graph,direction,new Map(),{lamp:{x:480,y:250,parentId:'deleted'}});
  assert.notDeepEqual(stale.nodes.find(n=>n.id==='lamp').position,{x:480,y:250});
 }
 assert.equal(viewPositionKey('sandbox','areas','LR'),viewPositionKey('sandbox','areas','TB'));
 assert.notEqual(viewPositionKey('sandbox','areas','LR'),viewPositionKey('sandbox','relationships','LR'));
});
test('manual cards reserve space and automatic siblings do not overlap',()=>{
 const graph=selectAreaGraph(starterSandbox());
 const saved={'lamp-device':{x:24,y:64,parentId:'studio'},lamp:{x:24,y:64,parentId:'lamp-device'}};
 const result=areaLayout(graph,'LR',new Map(),saved);
 assert.deepEqual(result.nodes.find(n=>n.id==='lamp-device').position,{x:24,y:64});
 for(const parent of [undefined,...result.nodes.map(n=>n.id)]) {
  const siblings=result.nodes.filter(n=>n.parentId===parent);
  for(let i=0;i<siblings.length;i++) for(let j=i+1;j<siblings.length;j++) {
   const a=siblings[i],b=siblings[j];
   assert.ok(a.position.x+(a.style?.width||220)<=b.position.x || b.position.x+(b.style?.width||220)<=a.position.x
    || a.position.y+(a.style?.height||90)<=b.position.y || b.position.y+(b.style?.height||90)<=a.position.y);
  }
 }
});
test('bounded overview and area focus preserve parents, induced edges, and truncation notices',()=>{
 const graph=starterSandbox();
 graph.nodes.push(...Array.from({length:220},(_,i)=>({id:`sensor.${i}`,kind:'entity',label:`Sensor ${i}`})));
 graph.edges.push(...Array.from({length:220},(_,i)=>({id:`member.${i}`,source:'studio',target:`sensor.${i}`,relationship:'assigned to'})));
 for(const focus of ['', 'studio','lamp']) {
  const selected=selectAreaGraph(graph,focus,2);
  assert.ok(selected.nodes.length<=180);
  assert.ok(selected.nodes.some(n=>n.id==='studio'));
  if(focus!=='lamp') assert.equal(selected.truncated,true);
  const ids=new Set(selected.nodes.map(n=>n.id));
  assert.ok(selected.edges.every(e=>ids.has(e.source)&&ids.has(e.target)));
  assert.ok(Object.values(selected.membership).every(id=>ids.has(id)));
 }
});
test('diagnostic filtering keeps containers and removes incident edges',()=>{
 const graph=areaLayout(selectAreaGraph(buildGraph(data,configuration)));
 const visible=filterDiagnosticGraph(graph,true);
 assert.ok(visible.nodes.some(n=>n.id==='area:office'));
 assert.equal(visible.nodes.some(n=>n.id==='sensor.debug'),false);
 assert.equal(visible.edges.some(e=>e.source==='sensor.debug'||e.target==='sensor.debug'),false);
});
test('Live API serves bounded area overview and lets rooms be searched and focused',async()=>{
 const app=await createApp({read:async()=>data,config:async()=>configuration,logger:false,ingressOnly:false});
 try {
  const snapshot=(await app.inject('/api/snapshot')).json();
  assert.ok(snapshot.entities.some(n=>n.id==='area:office'));
  const overview=await app.inject('/api/graph?view=areas');
  assert.equal(overview.statusCode,200);
  assert.equal(overview.json().membership['light.desk'],'area:office');
  const room=(await app.inject('/api/graph?view=areas&focus=area:office')).json();
  assert.ok(room.nodes.some(n=>n.id==='light.desk'));
  assert.equal((await app.inject('/api/graph?view=areas&focus=missing')).statusCode,404);
  assert.equal((await app.inject('/api/graph')).statusCode,404);
 } finally {await app.close();}
});
