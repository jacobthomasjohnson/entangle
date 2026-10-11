import { layout, NODE_WIDTH, NODE_HEIGHT, validPosition } from './graph-ui.js';
import { areaMembership } from '../server/graph.js';
export const VIEW_KEY = 'entangle.view.v1';
export const views = [{ id: 'areas', label: 'Areas' }, { id: 'relationships', label: 'Relationships' }, { id: 'flow', label: 'Automation flow' }];
// A new key prevents the old flowchart coordinates from overriding compact groups.
export const viewPositionKey = (mode, view, direction) => view === 'areas' ? `entangle.positions.${mode}.areas.v2` : `entangle.positions.${mode}.v1`;
const PAD = 24, HEADER = 64, GAP = 24;
const order = (a, b) => `${a.label}:${a.id}`.localeCompare(`${b.label}:${b.id}`);

function ownersOf(graph) {
  const nodes = new Map(graph.nodes.map(n => [n.id, n])), candidates = new Map();
  for (const e of graph.edges) {
    const device = e.relationship === 'owned by' ? e.target : e.relationship === 'provides' ? e.source : null;
    const child = e.relationship === 'owned by' ? e.source : e.target;
    if (nodes.get(device)?.kind !== 'device' || nodes.get(child)?.kind !== 'entity') continue;
    if (!candidates.has(child)) candidates.set(child, new Set());
    candidates.get(child).add(device);
  }
  return new Map([...candidates].filter(([, ids]) => ids.size === 1).map(([id, ids]) => [id, [...ids][0]]));
}

// Pack cards into shelves, reserving manually positioned rectangles first.
function pack(nodes, saved, parentId, maxWidth, top = HEADER) {
  const occupied = [], pinned = new Map();
  const size = n => ({ width: n.style?.width || NODE_WIDTH, height: n.style?.height || NODE_HEIGHT });
  for (const n of nodes) {
    const p = saved[n.id];
    if (validPosition(p) && (p.parentId || undefined) === parentId) {
      const position = { x: Math.max(PAD, p.x), y: Math.max(top, p.y) };
      pinned.set(n.id, position); occupied.push({ ...position, ...size(n) });
    }
  }
  let x = PAD, y = top, rowHeight = 0, width = NODE_WIDTH + PAD * 2, height = top + PAD;
  for (const n of nodes) {
    const dimensions = size(n);
    let position = pinned.get(n.id);
    if (!position) {
      if (x > PAD && x + dimensions.width + PAD > maxWidth) { x = PAD; y += rowHeight + GAP; rowHeight = 0; }
      position = { x, y };
      let collision;
      while ((collision = occupied.find(p => position.x < p.x + p.width + GAP && position.x + dimensions.width + GAP > p.x && position.y < p.y + p.height + GAP && position.y + dimensions.height + GAP > p.y))) {
        position.y = collision.y + collision.height + GAP;
      }
      x += dimensions.width + GAP; y = position.y; rowHeight = Math.max(rowHeight, dimensions.height);
      occupied.push({ ...position, ...dimensions });
    }
    n.position = position;
    if (parentId) Object.assign(n, { parentId, extent: 'parent', expandParent: true });
    width = Math.max(width, position.x + dimensions.width + PAD);
    height = Math.max(height, position.y + dimensions.height + PAD);
  }
  return { width, height };
}

export function areaLayout(graph, _direction = 'LR', _retained = new Map(), saved = {}) {
  const membership = graph.membership ? new Map(Object.entries(graph.membership)) : areaMembership(graph);
  const owners = ownersOf(graph), base = layout({ ...graph, nodes: graph.nodes.map(({ position, ...n }) => n) }, 'LR');
  const byId = new Map(base.nodes.map(n => [n.id, n]));
  const areas = [], devices = [], entities = [], loose = [];
  for (const device of graph.nodes.filter(n => n.kind === 'device').sort(order)) {
    const members = graph.nodes.filter(n => owners.get(n.id) === device.id && membership.get(n.id) === membership.get(device.id)).sort(order);
    const children = members.map(n => byId.get(n.id));
    const dimensions = pack(children, saved, device.id, members.length > 1 ? 2 * NODE_WIDTH + 3 * PAD : NODE_WIDTH + 2 * PAD);
    const group = { ...byId.get(device.id), type: 'deviceGroup', data: { ...device, direction: 'LR', memberCount: members.length }, style: dimensions, dragHandle: '.device-heading' };
    if (!members.length) group.style.height = HEADER + 44;
    devices.push(group); entities.push(...children);
  }
  const nested = new Set(entities.map(n => n.id));
  loose.push(...base.nodes.filter(n => n.data.kind !== 'area' && n.data.kind !== 'device' && !nested.has(n.id)));
  const cards = [...devices, ...loose];
  for (const area of graph.nodes.filter(n => n.kind === 'area').sort(order)) {
    const members = cards.filter(n => membership.get(n.id) === area.id).sort((a,b) => Number(b.type === 'deviceGroup') - Number(a.type === 'deviceGroup') || order(a.data,b.data));
    const dimensions = pack(members, saved, area.id, 1120);
    areas.push({ id: area.id, type: 'area', data: { ...area, direction: 'LR', memberCount: graph.nodes.filter(n => membership.get(n.id) === area.id).length }, position: { x: 0, y: 0 }, style: dimensions, dragHandle: '.area-heading' });
  }
  pack([...areas, ...cards.filter(n => !membership.has(n.id))], saved, undefined, 2400, PAD);
  const edges = base.edges.filter(e => !['owned by', 'provides'].includes(e.relationship)
    && !(['assigned area','inherited area'].includes(e.relationship) && membership.get(e.source) === e.target)
    && !(['contains','assigned to'].includes(e.relationship) && membership.get(e.target) === e.source));
  // Parents must precede children for React Flow's nested coordinate system.
  return { ...graph, nodes: [...areas, ...devices, ...loose, ...entities], edges };
}

export function areaEdges(graph, nodeId = '', edgeId = '', showAll = false) {
  if (showAll) return graph.edges;
  const selected = new Set(nodeId ? [nodeId] : []);
  // Includes entities nested in devices nested in a selected area.
  for (const n of graph.nodes) if (selected.has(n.parentId)) selected.add(n.id);
  return graph.edges.filter(e => e.id === edgeId || selected.has(e.source) || selected.has(e.target));
}
