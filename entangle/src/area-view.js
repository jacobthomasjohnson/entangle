import { layout, NODE_WIDTH, NODE_HEIGHT, validPosition } from './graph-ui.js';
import { areaMembership } from '../server/graph.js';
export const VIEW_KEY = 'entangle.view.v1';
export const views = [{id:'areas',label:'Areas'}, {id:'relationships',label:'Relationships'}];
export const viewPositionKey = (mode, view, direction) => view === 'areas' ? `entangle.positions.${mode}.areas.${direction}.v1` : `entangle.positions.${mode}.v1`;
// Use ownership only for family placement; automation references never split a family.
export function familyPositions(members, edges, direction) {
  const byId = new Map(members.map(n => [n.id, n])), owners = new Map();
  for (const e of edges) {
    const device = e.relationship === 'owned by' ? e.target : e.relationship === 'provides' ? e.source : null;
    const child = e.relationship === 'owned by' ? e.source : e.target;
    if (byId.get(device)?.kind !== 'device' || byId.get(child)?.kind !== 'entity') continue;
    if (!owners.has(child)) owners.set(child, new Set());
    owners.get(child).add(device);
  }
  const ordered = [...members].sort((a,b) => `${a.label}:${a.id}`.localeCompare(`${b.label}:${b.id}`));
  const devices = ordered.filter(n => n.kind === 'device'), positions = new Map(), assigned = new Set();
  let offset = 76;
  for (const device of devices) {
    const entities = ordered.filter(n => owners.get(n.id)?.size === 1 && owners.get(n.id).has(device.id));
    positions.set(device.id, { x: 24, y: offset }); assigned.add(device.id);
    entities.forEach((n,i) => {
      positions.set(n.id, direction === 'LR'
        ? { x: 24 + (1 + i % 2) * (NODE_WIDTH + 80), y: offset + Math.floor(i / 2) * (NODE_HEIGHT + 28) }
        : { x: 24 + i % 3 * (NODE_WIDTH + 28), y: offset + NODE_HEIGHT + 60 + Math.floor(i / 3) * (NODE_HEIGHT + 28) });
      assigned.add(n.id);
    });
    offset += direction === 'LR' ? Math.max(1, Math.ceil(entities.length / 2)) * (NODE_HEIGHT + 28) + 60
      : NODE_HEIGHT + 60 + Math.ceil(entities.length / 3) * (NODE_HEIGHT + 28) + 60;
  }
  ordered.filter(n => !assigned.has(n.id)).forEach((n,i) => positions.set(n.id, { x: 24 + i % 3 * (NODE_WIDTH + 28), y: offset + Math.floor(i / 3) * (NODE_HEIGHT + 28) }));
  return positions;
}
export function areaLayout(graph, direction = 'LR', retained = new Map(), saved = {}) {
  const membership = graph.membership ? new Map(Object.entries(graph.membership)) : areaMembership(graph);
  const base = layout({...graph,nodes:graph.nodes.map(({position,...n})=>n)},direction);
  const areas = graph.nodes.filter(n=>n.kind === 'area').sort((a,b)=>a.id.localeCompare(b.id));
  const children = [], groups = [];
  for (const area of areas) {
    const members = graph.nodes.filter(n=>membership.get(n.id) === area.id).sort((a,b)=>`${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
    const defaults = familyPositions(members, graph.edges, direction);
    let width = NODE_WIDTH + 48, height = 76 + NODE_HEIGHT + 28;
    members.forEach(member=>{
      const old = retained.get(member.id), persisted = saved[member.id];
      const retainedPosition = old?.parentId === area.id && validPosition(old.position) ? old.position : null;
      const savedPosition = persisted?.parentId === area.id && validPosition(persisted) ? persisted : null;
      const position = savedPosition || retainedPosition || defaults.get(member.id);
      const clamped = {x:Math.max(24,position.x),y:Math.max(76,position.y)};
      width=Math.max(width,clamped.x+NODE_WIDTH+24);height=Math.max(height,clamped.y+NODE_HEIGHT+24);
      children.push({...base.nodes.find(n=>n.id===member.id),position:clamped,parentId:area.id,extent:'parent',expandParent:true});
    });
    groups.push({id:area.id,type:'area',data:{...area,direction,memberCount:members.length},position:{x:0,y:0},style:{width,height},dragHandle:'.area-heading'});
  }
  const outside = base.nodes.filter(n=>n.data.kind!=='area' && !membership.has(n.id));
  const outsideDefaults = familyPositions(outside.map(n=>n.data),graph.edges,direction);
  let offset=0;
  for (const node of groups) {
    const old = retained.get(node.id), persisted=saved[node.id];
    node.position = validPosition(persisted) && !persisted.parentId ? {x:persisted.x,y:persisted.y} : old && !old.parentId ? old.position : direction==='LR' ? {x:offset,y:0} : {x:0,y:offset};
    offset += (direction==='LR' ? node.style?.width || NODE_WIDTH : node.style?.height || NODE_HEIGHT)+80;
  }
  for (const node of outside) {
    const old = retained.get(node.id), persisted = saved[node.id], local = outsideDefaults.get(node.id);
    node.position = validPosition(persisted) && !persisted.parentId ? {x:persisted.x,y:persisted.y} : old && !old.parentId ? old.position
      : {x:local.x + (direction === 'LR' ? offset : 0),y:local.y + (direction === 'TB' ? offset : 0)};
  }
  // Only membership lines are replaced by containment. References to an area remain edges.
  const edges=base.edges.filter(e=> !(['assigned area','inherited area'].includes(e.relationship) && membership.get(e.source)===e.target) && !(['contains','assigned to'].includes(e.relationship) && membership.get(e.target)===e.source));
  return {...graph,nodes:[...groups,...outside,...children],edges};
}
