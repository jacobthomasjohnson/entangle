import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../server/graph.js';
import { starterSandbox, updateNode, serializeSandbox, parseSandbox } from '../src/sandbox.js';
import { DIAGNOSTIC_FILTER_KEY, loadHideDiagnostic, writePreference, isDiagnostic, filterDiagnosticGraph, diagnosticSelection, filterNodes, layout } from '../src/graph-ui.js';
const graph = {
  nodes: [
    { id: 'device', kind: 'device', label: 'Device' },
    { id: 'area', kind: 'area', label: 'Area' },
    { id: 'automation', kind: 'automation', label: 'Automation' },
    { id: 'script', kind: 'script', label: 'Script' },
    { id: 'sensor.battery', entityId: 'sensor.battery', kind: 'entity', label: 'Battery', entity_category: 'diagnostic' },
    { id: 'sensor.config', entityId: 'sensor.config', kind: 'entity', label: 'Setting', entity_category: 'config' },
    { id: 'sensor.regular', entityId: 'sensor.regular', kind: 'entity', label: 'Diagnostic battery temperature', deviceClass: 'battery' },
  ],
  edges: [
    { id: 'owner', source: 'sensor.battery', target: 'device', relationship: 'owned by' },
    { id: 'area-edge', source: 'sensor.battery', target: 'area', relationship: 'assigned area' },
    { id: 'trigger', source: 'automation', target: 'sensor.battery', relationship: 'trigger' },
    { id: 'regular', source: 'sensor.regular', target: 'device', relationship: 'owned by' },
  ],
};
test('diagnostics default to hidden; explicit false persists and malformed preferences default safely', () => {
  const values = new Map(), storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  assert.equal(loadHideDiagnostic(storage), true);
  writePreference(storage, DIAGNOSTIC_FILTER_KEY, false);
  assert.equal(loadHideDiagnostic(storage), false);
  writePreference(storage, DIAGNOSTIC_FILTER_KEY, true);
  assert.equal(loadHideDiagnostic(storage), true);
  storage.setItem(DIAGNOSTIC_FILTER_KEY, 'invalid');
  assert.equal(loadHideDiagnostic(storage), true);
});
test('classification uses only entity registry category, never names, domain, device class or state attributes', () => {
  assert.equal(isDiagnostic(graph.nodes[4]), true);
  assert.equal(isDiagnostic(graph.nodes[5]), false);
  assert.equal(isDiagnostic(graph.nodes[6]), false);
  const result = buildGraph({
    states: ['sensor.diag', 'sensor.config', 'sensor.named_diagnostic'].map(entity_id => ({ entity_id, attributes: { entity_category: 'diagnostic', device_class: 'battery' } })),
    entities: [{ entity_id: 'sensor.diag', entity_category: 'diagnostic' }, { entity_id: 'sensor.config', entity_category: 'config' }], devices: [], areas: [], warnings: [],
  }, { automations: [], scripts: {}, warnings: [] });
  assert.deepEqual(result.nodes.map(n => n.entity_category), ['diagnostic', 'config', undefined]);
  assert.deepEqual(result.nodes.map(isDiagnostic), [true, false, false]);
});
test('view filtering removes every incident edge without deleting source data or creating replacement edges', () => {
  const original = structuredClone(graph);
  graph.nodes.forEach(Object.freeze); graph.edges.forEach(Object.freeze);
  const visible = filterDiagnosticGraph(graph);
  assert.deepEqual(visible.nodes.map(n => n.id), ['device', 'area', 'automation', 'script', 'sensor.config', 'sensor.regular']);
  assert.deepEqual(visible.edges.map(e => e.id), ['regular']);
  assert.deepEqual(graph, original);
  assert.equal(filterDiagnosticGraph(graph, false), graph);
});
test('hidden selected nodes and incident edges clear selection while visible selections survive', () => {
  assert.deepEqual(diagnosticSelection(graph, true, 'sensor.battery', 'trigger'), { nodeId: '', edgeId: '' });
  assert.deepEqual(diagnosticSelection(graph, true, 'device', 'owner'), { nodeId: 'device', edgeId: '' });
  assert.deepEqual(diagnosticSelection(graph, true, 'sensor.regular', 'regular'), { nodeId: 'sensor.regular', edgeId: 'regular' });
  assert.deepEqual(diagnosticSelection(graph, false, 'sensor.battery', 'owner'), { nodeId: 'sensor.battery', edgeId: 'owner' });
});
test('filtering a laid-out view preserves manual coordinates and restores the same nodes and edges', () => {
  const positioned = layout(graph, 'LR', new Map(), { 'sensor.battery': { x: 513, y: 923 }, device: { x: 42, y: 12 } });
  const before = structuredClone(positioned);
  const visible = filterDiagnosticGraph(positioned, true);
  assert.deepEqual(visible.nodes.find(n => n.id === 'device').position, { x: 42, y: 12 });
  assert.deepEqual(filterDiagnosticGraph(positioned, false), before);
  assert.deepEqual(positioned.nodes.find(n => n.id === 'sensor.battery').position, { x: 513, y: 923 });
});
test('diagnostic filtering composes with search and domains for large lists and full counts', () => {
  const nodes = Array.from({ length: 5000 }, (_, i) => ({ id: `sensor.battery_${i}`, entityId: `sensor.battery_${i}`, kind: 'entity', label: 'Battery', entity_category: i % 2 ? 'diagnostic' : 'config' }));
  const searched = filterNodes(nodes, 'battery', ['sensor']);
  assert.equal(searched.length, 5000);
  assert.equal(searched.filter(n => !isDiagnostic(n)).length, 2500);
  assert.equal(filterNodes(nodes, 'battery', ['light']).length, 0);
});
test('Sandbox categories survive editing and import/export; existing datasets remain compatible', () => {
  const original = starterSandbox(), lamp = original.nodes.find(n => n.id === 'lamp');
  assert.equal(lamp.entity_category, undefined);
  for (const category of ['diagnostic', 'config', '']) {
    const edited = updateNode(original, 'lamp', { ...lamp, entity_category: category, position: { x: 50, y: 60 } });
    const restored = parseSandbox(serializeSandbox(edited));
    assert.equal(restored.nodes.find(n => n.id === 'lamp').entity_category, category || undefined);
    assert.deepEqual(restored.edges, original.edges);
    const visible = filterDiagnosticGraph(restored);
    assert.equal(visible.nodes.some(n => n.id === 'lamp'), category !== 'diagnostic');
    assert.equal(restored.nodes.length, original.nodes.length);
  }
  assert.throws(() => updateNode(original, 'lamp', { ...lamp, entity_category: 'other' }), /entity_category/);
});
