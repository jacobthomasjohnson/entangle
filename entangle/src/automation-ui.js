import { areaMembership } from '../server/graph.js';
import { isDiagnostic, isHiddenEntityType } from './graph-ui.js';
export function referenceContext(graph, id) {
  const node = graph.nodes.find(n => n.id === id);
  const membership = areaMembership(graph);
  const deviceId = node?.kind === 'entity' ? graph.edges.find(e => e.relationship === 'owned by' && e.source === id)?.target
    || graph.edges.find(e => e.relationship === 'provides' && e.target === id)?.source : null;
  return { node, device: graph.nodes.find(n => n.id === deviceId), area: graph.nodes.find(n => n.id === membership.get(id)) };
}
export function hiddenReference(graph, id, hideDiagnostic, hiddenTypes) {
  const n = graph.nodes.find(n => n.id === id) || { id, entityId: id, kind: id.startsWith('device:') ? 'device' : id.startsWith('area:') ? 'area' : id.startsWith('script.') ? 'script' : id.startsWith('automation.') ? 'automation' : 'entity' };
  return (hideDiagnostic && isDiagnostic(n)) || isHiddenEntityType(n, hiddenTypes);
}
export function referenceGroups(graph, focus) {
  const groups = new Map();
  for (const edge of graph.edges) {
    if (edge.source !== focus && edge.target !== focus) continue;
    if (['owned by','assigned area','inherited area','contains','provides','assigned to'].includes(edge.relationship)) continue;
    const role = /trigger/.test(edge.relationship) ? 'Trigger references' : /condition/.test(edge.relationship) ? 'Condition references' : /action|control|calls/.test(edge.relationship) ? 'Action references' : 'Other references';
    if (!groups.has(role)) groups.set(role, new Set());
    groups.get(role).add(edge.source === focus ? edge.target : edge.source);
  }
  return [...groups].map(([label, ids]) => ({ label, references: [...ids].sort() }));
}
