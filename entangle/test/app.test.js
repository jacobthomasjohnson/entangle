import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { readHomeAssistant } from '../server/ha.js';
import { buildGraph, selectSubgraph } from '../server/graph.js';
import { loadConfiguration } from '../server/configuration.js';
import { createApp } from '../server/index.js';

const data = { states: [{ entity_id: 'light.desk', state: 'on', attributes: { friendly_name: 'Desk' } }, { entity_id: 'automation.office', state: 'on', attributes: { id: 'office' } }, { entity_id: 'script.office', state: 'off', attributes: {} }], entities: [{ entity_id: 'light.desk', device_id: 'desk' }], devices: [{ id: 'desk', name: 'Desk device', area_id: 'office' }], areas: [{ area_id: 'office', name: 'Office' }], warnings: [] };
const config = { automations: [{ id: 'office', triggers: [{ trigger: 'state', entity_id: 'light.desk' }], conditions: [{ condition: 'template', entity_id: 'light.desk', value_template: '{{ true }}' }], actions: [{ action: 'light.turn_on', target: { device_id: 'desk' }, data: { message: 'light.desk', entity_id: 'light.desk' } }] }], scripts: { office: { sequence: [{ if: [{ condition: 'state', entity_id: 'light.desk' }], then: [{ action: 'light.turn_off', target: { entity_id: 'light.desk' } }] }] } }, warnings: [] };

test('only proven registry and literal configuration edges are generated', () => {
  const graph = buildGraph(data, config);
  assert.ok(graph.edges.some(e => e.relationship === 'inherited area'));
  assert.ok(graph.edges.some(e => e.source === 'automation.office' && e.relationship === 'trigger'));
  assert.ok(graph.edges.some(e => e.source === 'automation.office' && e.relationship === 'action device'));
  assert.equal(graph.edges.some(e => e.source === 'automation.office' && ['condition', 'action'].includes(e.relationship)), false);
  assert.ok(graph.edges.some(e => e.source === 'script.office' && e.relationship === 'action'));
  assert.ok(graph.edges.some(e => e.source === 'script.office' && e.relationship === 'condition'));
  const immediate = selectSubgraph(graph, 'light.desk');
  assert.ok(immediate.nodes.some(n => n.id === 'automation.office'));
  assert.ok(selectSubgraph(graph, 'light.desk', 2).nodes.length >= immediate.nodes.length);
  assert.equal(selectSubgraph(graph, 'light.desk', 2, 2).truncated, true);
});

test('direct entity area overrides inherited device area; unmatched automation IDs are omitted', () => {
  const graph = buildGraph({ ...data, entities: [{ entity_id: 'light.desk', device_id: 'desk', area_id: 'other' }], areas: [...data.areas, { area_id: 'other', name: 'Other' }] }, { ...config, automations: [{ ...config.automations[0], id: 'unknown' }] });
  assert.ok(graph.edges.some(e => e.source === 'light.desk' && e.target === 'area:other'));
  assert.equal(graph.edges.some(e => e.source === 'light.desk' && e.target === 'area:office'), false);
  assert.equal(graph.edges.some(e => e.source === 'automation.office'), false);
});

test('malformed YAML script entries and ambiguous automation IDs do not break registry graphs', () => {
  const graph = buildGraph({ ...data, states: [...data.states, { entity_id: 'automation.duplicate', attributes: { id: 'office' } }] }, { ...config, scripts: { office: null } });
  assert.equal(graph.analyzed, 0);
  assert.ok(graph.edges.some(e => e.relationship === 'owned by'));
  assert.equal(graph.edges.some(e => e.source.startsWith('automation.')), false);
  assert.match(graph.warnings[0], /could not be uniquely mapped/);
});

test('YAML includes, packages, secrets and failures are handled conservatively', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'entangle-test-'));
  try {
    await fs.writeFile(path.join(dir, 'configuration.yaml'), 'automation: !include automations.yaml\nscript:\n  office:\n    sequence:\n      - target:\n          entity_id: light.desk\n        data:\n          password: !secret ignored\n');
    await fs.writeFile(path.join(dir, 'automations.yaml'), '- id: office\n  trigger:\n    - platform: state\n      entity_id: light.desk\n');
    const parsed = await loadConfiguration(dir);
    assert.equal(parsed.automations[0].id, 'office');
    assert.equal(parsed.scripts.office.sequence[0].data.password, null);
    await fs.writeFile(path.join(dir, 'automations.yaml'), '!include configuration.yaml');
    const failed = await loadConfiguration(dir);
    assert.equal(failed.automations.length, 0); assert.match(failed.warnings[0], /could not/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('WebSocket authentication and read-only commands; missing registries and rejected auth', async () => {
  const server = new WebSocketServer({ port: 0 }); await new Promise(resolve => server.once('listening', resolve));
  const commands = []; let rejectAuth = false;
  server.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'auth_required' }));
    ws.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.type === 'auth') { assert.equal(message.access_token, 'test-secret'); ws.send(JSON.stringify({ type: rejectAuth ? 'auth_invalid' : 'auth_ok' })); return; }
      commands.push(message.type);
      ws.send(JSON.stringify({ type: 'result', id: message.id, success: message.type !== 'config/area_registry/list', result: [], error: { code: 'unknown_command' } }));
    });
  });
  try {
    const env = { HA_URL: `http://127.0.0.1:${server.address().port}`, HA_TOKEN: 'test-secret' };
    const result = await readHomeAssistant(env);
    assert.equal(commands.length, 4); assert.equal(result.warnings.length, 1);
    rejectAuth = true; await assert.rejects(readHomeAssistant(env), /authentication failed/);
    await assert.rejects(readHomeAssistant({}), /not configured/);
  } finally { for (const client of server.clients) client.terminate(); await new Promise(resolve => server.close(resolve)); }
});

test('production static, ingress base, snapshot, bounded graph, refresh and failure responses', async () => {
  let reads = 0, fail = false;
  const app = await createApp({ read: async () => { reads++; if (fail) throw new Error('Authentication failed'); return data; }, config: async () => config });
  try {
    const page = await app.inject({ url: '/', headers: { 'x-ingress-path': '/api/hassio_ingress/example' } });
    assert.equal(page.statusCode, 200); assert.match(page.body, /<base href="\/api\/hassio_ingress\/example\/">/);
    const malicious = await app.inject({ url: '/', headers: { 'x-ingress-path': '/"><script>' } }); assert.match(malicious.body, /<base href="\/">/);
    const asset = page.body.match(/src="\.\/(assets\/[^\"]+)"/)[1];
    assert.equal((await app.inject(`/${asset}`)).statusCode, 200);
    assert.equal(reads, 0); // Loading Sandbox HTML/assets never connects to HA.
    assert.equal((await app.inject({ url: '/api/sandbox', method: 'POST', payload: { state: 'on' } })).statusCode, 404);
    const snapshot = await app.inject('/api/snapshot'); assert.equal(snapshot.json().connected, true); assert.equal(reads, 1);
    await app.inject('/api/snapshot'); assert.equal(reads, 1);
    const graph = await app.inject('/api/graph?focus=light.desk&depth=2'); assert.equal(graph.statusCode, 200); assert.ok(graph.json().edges.length);
    assert.equal((await app.inject('/api/graph?focus=missing')).statusCode, 404);
    fail = true; const result = await app.inject({ url: '/api/refresh', method: 'POST' }); assert.equal(result.json().connected, false);
    assert.equal((await app.inject('/api/graph?focus=light.desk')).statusCode, 503);
  } finally { await app.close(); }
});

test('refresh retries synchronous connection failures rather than retaining a settled request', async () => {
  let reads = 0;
  const app = await createApp({ read: () => { reads++; throw new Error('No credentials'); }, config: async () => config });
  try {
    for (let i = 0; i < 2; i++) {
      const result = await app.inject({ url: '/api/refresh', method: 'POST' });
      assert.equal(result.json().connected, false); assert.equal(result.json().entities.length, 0);
    }
    assert.equal(reads, 2);
  } finally { await app.close(); }
});
