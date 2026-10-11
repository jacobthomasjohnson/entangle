import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, starterSandbox, emptySandbox, validateSandbox, relationshipTypes, addRelationship, updateNode, deleteNode, serializeSandbox, parseSandbox, loadSandbox, saveSandbox } from '../src/sandbox.js';

test('starter sandbox is deterministic and supports exactly the requested relationship matrix', () => {
  assert.deepEqual(starterSandbox(), starterSandbox());
  const expected = { 'device:entity': ['provides'], 'area:device': ['contains'], 'area:entity': ['assigned to'], 'automation:entity': ['triggers from', 'checks condition', 'controls'], 'script:entity': ['controls'], 'automation:script': ['calls'] };
  for (const source of ['entity', 'device', 'area', 'automation', 'script']) {
    for (const target of ['entity', 'device', 'area', 'automation', 'script']) assert.deepEqual(relationshipTypes({ id: 'a', kind: source }, { id: 'b', kind: target }), expected[`${source}:${target}`] || []);
  }
  assert.deepEqual(relationshipTypes({ id: 'a', kind: 'area' }, { id: 'a', kind: 'device' }), []);
});

test('relationship creation rejects unsupported, dangling, duplicate and self edges', () => {
  const data = starterSandbox();
  assert.throws(() => addRelationship(data, 'lamp-device', 'lamp', 'provides'), /Duplicate/);
  assert.throws(() => addRelationship(data, 'lamp', 'lamp-device', 'provides'), /Unsupported/);
  assert.throws(() => addRelationship(data, 'missing', 'lamp', 'controls'), /Unsupported/);
  assert.throws(() => addRelationship(data, 'arrival', 'arrival', 'calls'), /Unsupported/);
  const next = addRelationship(data, 'arrival', 'lamp', 'controls');
  assert.equal(next.edges.length, data.edges.length + 1);
  assert.equal(data.edges.length, 8); // Inputs are never mutated.
});

test('node edits preserve connections on rename, validate types and IDs, deletion cascades', () => {
  const data = starterSandbox(), lamp = data.nodes.find(n => n.id === 'lamp');
  const changed = updateNode(data, lamp.id, { ...lamp, id: 'new-lamp', entityId: 'light.renamed', state: 'on', label: 'Renamed' });
  assert.equal(changed.nodes.find(n => n.id === 'new-lamp').state, 'on');
  assert.ok(changed.edges.some(e => e.target === 'new-lamp')); assert.equal(changed.edges.some(e => e.target === 'lamp'), false);
  assert.throws(() => updateNode(data, lamp.id, { ...lamp, id: 'studio' }), /Duplicate node/);
  assert.throws(() => updateNode(data, lamp.id, { ...lamp, entityId: 'binary_sensor.front_door' }), /Duplicate entity/);
  assert.throws(() => updateNode(data, lamp.id, { ...lamp, entityId: '{{ light.desk }}' }), /entity_id/);
  assert.throws(() => updateNode(data, lamp.id, { ...lamp, kind: 'area' }), /Unsupported relationship/);
  const deleted = deleteNode(changed, 'new-lamp');
  assert.equal(deleted.nodes.some(n => n.id === 'new-lamp'), false); assert.equal(deleted.edges.some(e => e.source === 'new-lamp' || e.target === 'new-lamp'), false);
  assert.deepEqual(validateSandbox(deleted), deleted);
});

test('versioned import/export is lossless, bounded and rejects invalid data', () => {
  const data = starterSandbox(); data.nodes[0].position = { x: 125, y: -40 };
  assert.deepEqual(parseSandbox(serializeSandbox(data)), data);
  assert.deepEqual(parseSandbox(serializeSandbox(emptySandbox())), emptySandbox());
  assert.throws(() => parseSandbox('{no'), /Invalid JSON/);
  assert.throws(() => parseSandbox('{"version":0,"nodes":[],"edges":[]}'), /Unsupported sandbox version/);
  assert.throws(() => validateSandbox({ ...data, nodes: [...data.nodes, data.nodes[0]] }), /Duplicate/);
  assert.throws(() => validateSandbox({ ...data, nodes: [{ ...data.nodes[0], position: { x: NaN, y: 0 } }] }), /position/);
  assert.throws(() => parseSandbox('x'.repeat(5 * 1024 * 1024 + 1)), /5 MB/);
});

test('browser persistence survives reload, recovers from invalid saves and reports quota failures', () => {
  const values = new Map(); const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(loadSandbox(storage).data, starterSandbox());
  const edited = deleteNode(starterSandbox(), 'arrival');
  assert.equal(saveSandbox(storage, edited), ''); assert.deepEqual(loadSandbox(storage).data, edited);
  values.set(STORAGE_KEY, '{broken');
  assert.match(loadSandbox(storage).warning, /malformed/); assert.equal(values.get(STORAGE_KEY), '{broken');
  values.set(STORAGE_KEY, '{"version":99,"nodes":[],"edges":[]}'); assert.ok(loadSandbox(storage).warning);
  assert.match(saveSandbox({ setItem() { throw new Error('quota'); } }, edited), /export JSON/);
  assert.ok(loadSandbox({ getItem() { throw new Error('blocked'); } }).warning);
  assert.equal(saveSandbox(storage, emptySandbox()), ''); assert.deepEqual(loadSandbox(storage).data, emptySandbox());
});
