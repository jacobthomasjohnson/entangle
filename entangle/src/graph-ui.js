import dagre from '@dagrejs/dagre';
export const NODE_WIDTH = 220, NODE_HEIGHT = 90;
export function readPreference(storage, key, fallback) {
  try { return JSON.parse(storage?.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
export function writePreference(storage, key, value) {
  try { if (!storage) throw new Error(); storage.setItem(key, JSON.stringify(value)); return ''; }
  catch { return 'Browser storage is unavailable. Layout and filter preferences may not survive refresh.'; }
}
export const positionKey = mode => `entangle.positions.${mode}.v1`;
export function validPosition(p) { return p && ['x', 'y'].every(k => Number.isFinite(p[k]) && Math.abs(p[k]) <= 1000000); }
export function relationshipStyle(type = '') {
  if (/trigger/.test(type)) return { stroke: 'var(--color-87b99d, #87b99d)', strokeDasharray: '5 3' };
  if (/condition/.test(type)) return { stroke: 'var(--color-b29ac9, #b29ac9)', strokeDasharray: '2 4' };
  if (/action|control|calls/.test(type)) return { stroke: 'var(--color-c5a17e, #c5a17e)' };
  return { stroke: 'var(--color-7f97a7, #7f97a7)' };
}
export function layout(graph, direction = 'LR', retained = new Map(), saved = {}, focus = '') {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: direction, nodesep: 48, ranksep: 110, edgesep: 24, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  const ordered = [...graph.nodes].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  ordered.forEach(n => g.setNode(n.id, { width: retained.get(n.id)?.measured?.width || NODE_WIDTH, height: retained.get(n.id)?.measured?.height || NODE_HEIGHT }));
  [...graph.edges].sort((a, b) => a.id.localeCompare(b.id)).forEach(e => { if (g.hasNode(e.source) && g.hasNode(e.target)) {
    // Registry ownership points toward parents; reverse only the layout constraint.
    const parent = ['owned by', 'inherited area', 'assigned area'].includes(e.relationship);
    g.setEdge(parent ? e.target : e.source, parent ? e.source : e.target, { weight: parent || /contains|provides/.test(e.relationship) ? 3 : 1 }, e.id);
  } });
  dagre.layout(g);
  const pairs = new Map();
  for (const e of graph.edges) { const key = JSON.stringify([e.source, e.target]); if (!pairs.has(key)) pairs.set(key, []); pairs.get(key).push(e.id); }
  const placed = ordered.filter(n => validPosition(saved[n.id]) || retained.has(n.id) || validPosition(n.position)).map(n => {
    const old = retained.get(n.id); return { id: n.id, type: 'relationship', data: { ...n, direction }, position: validPosition(saved[n.id]) ? saved[n.id] : old?.position || n.position };
  });
  const anchor = placed.find(n => n.id === focus) || placed[0];
  const anchorLayout = anchor && g.node(anchor.id);
  for (const n of ordered.filter(n => !placed.some(p => p.id === n.id))) {
    const size = g.node(n.id), position = { x: size.x - size.width / 2, y: size.y - size.height / 2 };
    if (anchorLayout) { position.x += anchor.position.x - (anchorLayout.x - anchorLayout.width / 2); position.y += anchor.position.y - (anchorLayout.y - anchorLayout.height / 2); }
    // Preserve existing nodes; move only newcomers out of occupied rectangles.
    while (placed.some(p => Math.abs(p.position.x - position.x) < NODE_WIDTH + 28 && Math.abs(p.position.y - position.y) < NODE_HEIGHT + 28)) {
      if (direction === 'LR') position.y += NODE_HEIGHT + 48; else position.x += NODE_WIDTH + 48;
    }
    placed.push({ id: n.id, type: 'relationship', data: { ...n, direction }, position });
  }
  return { nodes: placed, edges: graph.edges.map(e => {
    const siblings = pairs.get(JSON.stringify([e.source, e.target])).slice().sort();
    return { ...e, type: 'relationship', data: { direction, bend: (siblings.indexOf(e.id) - (siblings.length - 1) / 2) * 32 }, label: e.relationship, style: relationshipStyle(e.relationship) };
  }), truncated: graph.truncated };
}
export const domainOf = n => n.kind !== 'entity' ? n.kind : (n.entityId || n.id || '').split('.')[0];
export function filterNodes(nodes, query, domains) {
  const q = query.trim().toLowerCase(), chosen = new Set(domains);
  return nodes.filter(n => (!chosen.size || chosen.has(domainOf(n))) && `${n.label} ${n.entityId || n.id} ${n.kind}`.toLowerCase().includes(q));
}

export const DIAGNOSTIC_FILTER_KEY = 'entangle.hideDiagnostic.v1';
export function loadHideDiagnostic(storage) { return readPreference(storage, DIAGNOSTIC_FILTER_KEY, true) !== false; }
export function isDiagnostic(node) {
  const entity = node.data || node;
  return entity.kind === 'entity' && entity.entity_category === 'diagnostic';
}
// Filter the view only: retain source objects, coordinates, and original relationships.
export function filterDiagnosticGraph(graph, hideDiagnostic = true) {
  if (!hideDiagnostic) return graph;
  const hidden = new Set(graph.nodes.filter(isDiagnostic).map(n => n.id));
  if (!hidden.size) return graph;
  return { ...graph, nodes: graph.nodes.filter(n => !hidden.has(n.id)), edges: graph.edges.filter(e => !hidden.has(e.source) && !hidden.has(e.target)) };
}
export function diagnosticSelection(graph, hideDiagnostic, nodeId, edgeId) {
  if (!hideDiagnostic) return { nodeId, edgeId };
  const hidden = new Set(graph.nodes.filter(isDiagnostic).map(n => n.id));
  const edge = graph.edges.find(e => e.id === edgeId);
  return { nodeId: hidden.has(nodeId) ? '' : nodeId, edgeId: edge && (hidden.has(edge.source) || hidden.has(edge.target)) ? '' : edgeId };
}
