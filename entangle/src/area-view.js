import { layout, NODE_WIDTH, NODE_HEIGHT, validPosition } from './graph-ui.js';
import { areaMembership } from '../server/graph.js';
export const VIEW_KEY = 'entangle.view.v1';
export const views = [{id:'areas',label:'Areas'}, {id:'relationships',label:'Relationships'}];
export const viewPositionKey = (mode, view, direction) => view === 'areas' ? `entangle.positions.${mode}.areas.${direction}.v1` : `entangle.positions.${mode}.v1`;
export function areaLayout(graph, direction = 'LR', retained = new Map(), saved = {}) {
  const membership = graph.membership ? new Map(Object.entries(graph.membership)) : areaMembership(graph);
  const base = layout({...graph,nodes:graph.nodes.map(({position,...n})=>n)},direction);
  const areas = graph.nodes.filter(n=>n.kind === 'area').sort((a,b)=>a.id.localeCompare(b.id));
  const children = [], groups = [];
  for (const area of areas) {
    const members = graph.nodes.filter(n=>membership.get(n.id) === area.id).sort((a,b)=>`${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
    const columns = Math.max(1,Math.ceil(Math.sqrt(members.length)));
    const rows = Math.max(1,Math.ceil(members.length/columns));
    let width = 2*24 + columns*(NODE_WIDTH+28)-28, height = 76 + Math.max(1,Math.ceil(members.length/columns))*(NODE_HEIGHT+28);
    members.forEach((member,index)=>{
      const old = retained.get(member.id), persisted = saved[member.id];
      const retainedPosition = old?.parentId === area.id && validPosition(old.position) ? old.position : null;
      const savedPosition = persisted?.parentId === area.id && validPosition(persisted) ? persisted : null;
      const position = savedPosition || retainedPosition || {x:24+(direction === 'LR' ? index%columns : Math.floor(index/rows))*(NODE_WIDTH+28),y:76+(direction === 'LR' ? Math.floor(index/columns) : index%rows)*(NODE_HEIGHT+28)};
      const clamped = {x:Math.max(24,position.x),y:Math.max(76,position.y)};
      width=Math.max(width,clamped.x+NODE_WIDTH+24);height=Math.max(height,clamped.y+NODE_HEIGHT+24);
      children.push({...base.nodes.find(n=>n.id===member.id),position:clamped,parentId:area.id,extent:'parent',expandParent:true});
    });
    groups.push({id:area.id,type:'area',data:{...area,direction,memberCount:members.length},position:{x:0,y:0},style:{width,height},dragHandle:'.area-heading'});
  }
  const outside = base.nodes.filter(n=>n.data.kind!=='area' && !membership.has(n.id));
  let offset=0;
  for (const node of [...groups,...outside]) {
    const old = retained.get(node.id), persisted=saved[node.id];
    node.position = validPosition(persisted) && !persisted.parentId ? {x:persisted.x,y:persisted.y} : old && !old.parentId ? old.position : direction==='LR' ? {x:offset,y:0} : {x:0,y:offset};
    offset += (direction==='LR' ? node.style?.width || NODE_WIDTH : node.style?.height || NODE_HEIGHT)+80;
  }
  // Only membership lines are replaced by containment. References to an area remain edges.
  const edges=base.edges.filter(e=> !(['assigned area','inherited area'].includes(e.relationship) && membership.get(e.source)===e.target) && !(['contains','assigned to'].includes(e.relationship) && membership.get(e.target)===e.source));
  return {...graph,nodes:[...groups,...outside,...children],edges};
}
