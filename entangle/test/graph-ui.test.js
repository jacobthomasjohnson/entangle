import test from 'node:test';
import assert from 'node:assert/strict';
import { layout, positionKey, readPreference, writePreference, filterNodes, HIDDEN_TYPES_KEY, loadHiddenTypes, entityTypeOptions, filterEntityTypes } from '../src/graph-ui.js';
import { buildGraph } from '../server/graph.js';
const graph = { nodes: [{ id: 'area', kind: 'area', label: 'Office' }, { id: 'light.desk', entityId: 'light.desk', kind: 'entity', label: 'Desk' }], edges: [{ id: 'owns', source: 'light.desk', target: 'area', relationship: 'assigned area' }] };
test('hidden entity types support whole domains and device classes across devices without deleting data',()=>{
 const source={nodes:[{id:'device',kind:'device',label:'Device'},
  {id:'sensor.battery1',kind:'entity',deviceClass:'battery'},
  {id:'sensor.battery2',kind:'entity',deviceClass:'battery'},
  {id:'sensor.temperature',kind:'entity',deviceClass:'temperature'},
  {id:'update.firmware',kind:'entity'}, {id:'area',kind:'area'}],
  edges:[{id:'battery',source:'device',target:'sensor.battery1'},{id:'temp',source:'device',target:'sensor.temperature'}]};
 const original=structuredClone(source), visible=filterEntityTypes(source,['sensor:battery','update']);
 assert.deepEqual(visible.nodes.map(n=>n.id),['device','sensor.temperature','area']);
 assert.deepEqual(visible.edges.map(e=>e.id),['temp']);
 assert.deepEqual(source,original);
 assert.deepEqual(filterEntityTypes(source,[]),source);
 assert.deepEqual(filterEntityTypes(source,['sensor']).nodes.map(n=>n.id),['device','update.firmware','area']);
 assert.deepEqual(filterEntityTypes({nodes:source.nodes.map(n=>({id:n.id,data:n,position:{x:1,y:2}})),edges:source.edges},['sensor:battery']).nodes.map(n=>n.id),['device','sensor.temperature','update.firmware','area']);
 assert.equal(entityTypeOptions(source.nodes).filter(t=>t.id==='sensor:battery').length,1);
 assert.equal(entityTypeOptions(source.nodes).some(t=>t.id==='device'),false);
 const storage={getItem:()=>JSON.stringify(['sensor:battery',3,'sensor:battery','update'])};
 assert.deepEqual(loadHiddenTypes(storage),['sensor:battery','update']);
 assert.deepEqual(loadHiddenTypes({getItem:()=>'{bad'}),[]);
 assert.deepEqual(loadHiddenTypes({getItem:()=>'{"sensor":true}'}),[]);
 const saved=new Map(), writable={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
 writePreference(writable,HIDDEN_TYPES_KEY,['sensor:battery']);
 assert.deepEqual(loadHiddenTypes(writable),['sensor:battery']);
});
test('layout is deterministic, hierarchical in both directions and preserves relationship semantics', () => {
  for (const direction of ['LR', 'TB']) {
    const result = layout(graph, direction);
    assert.deepEqual(result, layout({ nodes: [...graph.nodes].reverse(), edges: graph.edges }, direction));
    const parent = result.nodes.find(n => n.id === 'area'), child = result.nodes.find(n => n.id === 'light.desk');
    assert.ok(direction === 'LR' ? parent.position.x < child.position.x : parent.position.y < child.position.y);
    assert.equal(result.edges[0].source, 'light.desk');
  }
});
test('saved positions survive reload and navigation, and expansion preserves every existing position', () => {
  const values = new Map(), storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  const saved = { 'light.desk': { x: 123, y: 456 }, deleted: { x: 0, y: 0 } };
  assert.equal(writePreference(storage, positionKey('live'), saved), '');
  const result = layout(graph, 'LR', new Map(), readPreference(storage, positionKey('live'), {}), 'light.desk');
  assert.deepEqual(result.nodes.find(n => n.id === 'light.desk').position, saved['light.desk']);
  const expanded = layout({ ...graph, nodes: [...graph.nodes, { id: 'sensor.new', kind: 'entity' }], edges: [...graph.edges, { id: 'new', source: 'sensor.new', target: 'area', relationship: 'assigned area' }] }, 'LR', new Map(result.nodes.map(n => [n.id, n])), saved, 'light.desk');
  result.nodes.forEach(n => assert.deepEqual(expanded.nodes.find(v => v.id === n.id).position, n.position));
  assert.equal(expanded.nodes.length, 3);
  assert.deepEqual(readPreference(storage, positionKey('sandbox'), {}), {});
  assert.notDeepEqual(layout(graph).nodes.find(n => n.id === 'light.desk').position, saved['light.desk']);
});
test('invalid storage and unavailable nodes are harmless; storage failures are visible', () => {
  assert.deepEqual(readPreference({ getItem: () => '{bad' }, 'key', {}), {});
  assert.match(writePreference(undefined, 'key', {}), /unavailable/);
  const result = layout(graph, 'TB', new Map(), { 'light.desk': { x: Infinity, y: 0 } });
  assert.ok(result.nodes.every(n => Number.isFinite(n.position.x) && Number.isFinite(n.position.y)));
});
test('multi-domain filters combine with search and count all results before limiting rendering', () => {
  const nodes = [...graph.nodes, ...Array.from({ length: 2000 }, (_, i) => ({ id: `sensor.${i}`, entityId: `sensor.${i}`, kind: 'entity', label: `Temperature ${i}` }))];
  assert.equal(filterNodes(nodes, 'temperature', ['sensor']).length, 2000);
  assert.equal(filterNodes(nodes, 'desk', ['sensor']).length, 0);
  assert.equal(filterNodes(nodes, 'desk', ['light', 'sensor']).length, 1);
  assert.equal(filterNodes(nodes, '', []).length, 2002);
});
test('device class is normalized without exposing arbitrary state attributes', () => {
  const result = buildGraph({ states: [{ entity_id: 'sensor.temperature', attributes: { device_class: 'temperature', private: 'secret' } }], entities: [], devices: [], areas: [], warnings: [] }, { automations: [], scripts: {}, warnings: [] });
  assert.equal(result.nodes[0].deviceClass, 'temperature');
  assert.equal(result.nodes[0].private, undefined);
});
