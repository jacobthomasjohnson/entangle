import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket, { WebSocketServer } from 'ws';
import YAML from 'yaml';
import { createApp } from '../server/index.js';
import { readHomeAssistant } from '../server/ha.js';
import { buildGraph } from '../server/graph.js';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const emptyData = { states: [], entities: [], devices: [], areas: [], warnings: [] };
const emptyConfig = { automations: [], scripts: {}, warnings: [] };

test('custom repository metadata, App permissions, versions and self-contained Docker context agree', async () => {
  const repository = YAML.parse(await fs.readFile(path.join(appRoot, '../repository.yaml'), 'utf8'));
  const config = YAML.parse(await fs.readFile(path.join(appRoot, 'config.yaml'), 'utf8'));
  const pkg = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(appRoot, 'package-lock.json'), 'utf8'));
  const docker = await fs.readFile(path.join(appRoot, 'Dockerfile'), 'utf8');
  assert.equal(repository.url, 'https://github.com/jacobthomasjohnson/entangle'); assert.ok(repository.name);
  for (const key of ['name', 'slug', 'version', 'description']) assert.equal(typeof config[key], 'string');
  assert.equal(config.slug, path.basename(appRoot)); assert.deepEqual(config.arch, ['amd64']);
  assert.equal(config.version, pkg.version); assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(config.homeassistant_api, true); assert.equal(config.ingress, true); assert.equal(config.panel_admin, true);
  assert.equal(config.ingress_port, 8099); assert.equal(config.panel_icon, 'mdi:graph-outline'); assert.equal(config.panel_title, 'Entangle');
  assert.equal(config.startup, 'application'); assert.equal(config.boot, 'auto'); assert.equal(config.init, false);
  assert.equal(config.ports, undefined); assert.equal(config.host_network, undefined); assert.equal(config.image, undefined);
  assert.deepEqual(config.map, [{ type: 'homeassistant_config', read_only: true, path: '/homeassistant' }]);
  assert.equal(config.environment.ENTANGLE_INGRESS_ONLY, 'true');
  assert.match(docker, /FROM node:24-alpine AS build/); assert.doesNotMatch(docker, /BUILD_FROM/);
  assert.match(docker, /RUN npm ci/); assert.match(docker, /npm run build/); assert.match(docker, /npm prune --omit=dev/);
  assert.match(docker, /CMD \["node", "server\/index.js"\]/); assert.match(docker, /HOST=0.0.0.0 PORT=8099/);
  for (const name of ['src', 'server', 'index.html', 'vite.config.js', 'package.json', 'package-lock.json', 'DOCS.md']) await fs.access(path.join(appRoot, name));
  await assert.rejects(fs.access(path.join(appRoot, '../config.yaml'))); // No duplicate root app.
});

test('Ingress peer restrictions protect HTML, assets and API; spoofed headers cannot bypass them', async () => {
  let reads = 0;
  const app = await createApp({ ingressOnly: true, logger: false, read: async () => { reads++; return emptyData; }, config: async () => emptyConfig });
  try {
    for (const url of ['/', '/api/health', '/api/snapshot', '/assets/anything.js']) {
      const denied = await app.inject({ url, remoteAddress: '172.30.33.4', headers: { 'x-forwarded-for': '172.30.32.2', 'x-ingress-path': '/api/hassio_ingress/token' } });
      assert.equal(denied.statusCode, 403);
    }
    assert.equal(reads, 0);
    const page = await app.inject({ url: '/', remoteAddress: '172.30.32.2', headers: { 'x-ingress-path': '/api/hassio_ingress/example_token-' } });
    assert.equal(page.statusCode, 200); assert.equal(page.headers['cache-control'], 'no-store');
    assert.match(page.body, /<base href="\/api\/hassio_ingress\/example_token-\/">/);
    const asset = page.body.match(/src="\.\/(assets\/[^\"]+)"/)[1];
    assert.equal((await app.inject({ url: `/${asset}`, remoteAddress: '172.30.32.2' })).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/health', remoteAddress: '::ffff:172.30.32.2' })).statusCode, 200);
    const snapshot = await app.inject({ url: '/api/snapshot', remoteAddress: '172.30.32.2' });
    assert.equal(snapshot.json().connected, true); assert.equal(reads, 1);
  } finally { await app.close(); }
});

test('Supervisor uses its own WebSocket route and frame authentication, without REST bearer headers', async () => {
  const server = new WebSocketServer({ port: 0 }); await new Promise(resolve => server.once('listening', resolve));
  const frames = [], targets = [];
  class RoutedWebSocket extends WebSocket {
    constructor(url, options) { targets.push({ url, options }); super(`ws://127.0.0.1:${server.address().port}`, options); }
  }
  server.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'auth_required' }));
    ws.on('message', raw => {
      const message = JSON.parse(raw); frames.push(message);
      ws.send(JSON.stringify(message.type === 'auth' ? { type: 'auth_ok' } : { type: 'result', id: message.id, success: true, result: [] }));
    });
  });
  try {
    const result = await readHomeAssistant({ SUPERVISOR_TOKEN: 'synthetic-supervisor-token', HA_TOKEN: 'must-not-use', HA_URL: 'http://must-not-use' }, { WebSocketImpl: RoutedWebSocket });
    assert.equal(targets[0].url, 'ws://supervisor/core/websocket'); assert.equal(targets[0].options.headers, undefined);
    assert.deepEqual(frames[0], { type: 'auth', access_token: 'synthetic-supervisor-token' });
    assert.deepEqual(frames.slice(1).map(f => f.type), ['get_states', 'config/entity_registry/list', 'config/device_registry/list', 'config/area_registry/list']);
    assert.equal(JSON.stringify(result).includes('synthetic-supervisor-token'), false);
  } finally { for (const client of server.clients) client.terminate(); await new Promise(resolve => server.close(resolve)); }
});

test('pending Home Assistant authentication can be cancelled for prompt shutdown', async () => {
  const server = new WebSocketServer({ port: 0 }); await new Promise(resolve => server.once('listening', resolve));
  const controller = new AbortController();
  const connected = new Promise(resolve => server.once('connection', resolve));
  const reading = readHomeAssistant({ HA_URL: `http://127.0.0.1:${server.address().port}`, HA_TOKEN: 'synthetic-token' }, { signal: controller.signal });
  const rejection = assert.rejects(reading, /cancelled during shutdown/);
  try { await connected; controller.abort(); await rejection; }
  finally { for (const client of server.clients) client.terminate(); await new Promise(resolve => server.close(resolve)); }
});

test('failed snapshots reconnect on reentry after cooldown, without polling or fake entities', async t => {
  let clock = Date.now(), reads = 0;
  t.mock.method(Date, 'now', () => clock);
  const app = await createApp({ ingressOnly: false, logger: false, read: async () => { if (++reads === 1) throw new Error('Core temporarily unavailable'); return emptyData; }, config: async () => emptyConfig });
  try {
    const failed = (await app.inject('/api/snapshot')).json(); assert.equal(failed.connected, false); assert.deepEqual(failed.entities, []);
    await app.inject('/api/snapshot'); assert.equal(reads, 1);
    clock += 5001; assert.equal((await app.inject('/api/snapshot')).json().connected, true); assert.equal(reads, 2);
    await app.inject('/api/snapshot'); assert.equal(reads, 2);
  } finally { await app.close(); }
});

test('direct known script calls are discovered, templates and missing services are omitted', () => {
  const graph = buildGraph({ ...emptyData, states: [{ entity_id: 'automation.arrival', attributes: { id: 'arrival' } }, { entity_id: 'script.evening', attributes: {} }] }, {
    scripts: {}, warnings: [], automations: [{ id: 'arrival', actions: [{ action: 'script.evening' }, { service: 'script.evening' }, { action: 'script.unknown' }, { action: 'script.{{ selected }}' }] }],
  });
  assert.deepEqual(graph.edges, [{ id: 'automation.arrival|calls|script.evening', source: 'automation.arrival', target: 'script.evening', relationship: 'calls' }]);
});
