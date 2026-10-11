import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHomeAssistant } from './ha.js';
import { loadConfiguration } from './configuration.js';
import { buildGraph, selectSubgraph, selectAreaGraph } from './graph.js';

export async function createApp({ read, config = () => loadConfiguration(process.env.HA_CONFIG_DIR || (process.env.SUPERVISOR_TOKEN ? '/homeassistant' : '')), ingressOnly = !!process.env.SUPERVISOR_TOKEN || process.env.ENTANGLE_INGRESS_ONLY === 'true', logger = true } = {}) {
  const app = Fastify({ logger });
  const shutdown = new AbortController();
  const connect = read || (() => readHomeAssistant(process.env, { signal: shutdown.signal }));
  app.addHook('preClose', async () => { shutdown.abort(); });
  // Check the TCP peer, never a caller-controlled forwarding header.
  if (ingressOnly) app.addHook('onRequest', async (request, reply) => {
    const peer = request.raw.socket.remoteAddress;
    if (peer !== '172.30.32.2' && peer !== '::ffff:172.30.32.2') return reply.code(403).send({ error: 'Access is restricted to Home Assistant Ingress.' });
  });
  let graph = null, error = null, refreshedAt = null, pending = null, retryAfter = 0;
  async function refresh() {
    if (pending) return pending;
    pending = Promise.resolve().then(async () => {
      try {
        const [data, configuration] = await Promise.all([connect(), config()]); graph = buildGraph(data, configuration); error = null; retryAfter = 0; refreshedAt = new Date().toISOString();
        app.log.info({ entities: data.states.length, devices: data.devices.length, areas: data.areas.length, analyzed: graph.analyzed, coverageNotices: graph.warnings.length }, 'Home Assistant snapshot loaded');
      }
      catch (e) { error = e.message; graph = null; retryAfter = Date.now() + 5000; app.log.warn('Home Assistant snapshot unavailable; use Refresh or reopen Live Mode to retry.'); }
      finally { pending = null; }
    });
    return pending;
  }
  const summary = () => ({ connected: !!graph && !error, error, refreshedAt, warnings: graph?.warnings || [], analyzed: graph?.analyzed || 0, entities: graph?.nodes.filter(n => n.entityId || n.kind === 'area') || [] });
  app.get('/api/snapshot', async () => { if (!graph && (!error || Date.now() >= retryAfter)) await refresh(); return summary(); });
  app.post('/api/refresh', async () => { await refresh(); return summary(); });
  app.get('/api/graph', async (request, reply) => {
    const { focus, depth = '1', view } = request.query;
    if (!graph) return reply.code(503).send({ error: error || 'Refresh the connection first.' });
    if (view === 'areas' && !focus) return selectAreaGraph(graph);
    if (!graph.nodes.some(n => n.id === focus)) return reply.code(404).send({ error: 'Entity not found.' });
    return view === 'areas' ? selectAreaGraph(graph, focus, depth === '2' ? 2 : 1) : selectSubgraph(graph, focus, depth === '2' ? 2 : 1);
  });
  app.get('/api/health', async () => ({ status: 'ok' }));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  let built = false;
  try { await fs.access(root); built = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (built) {
    await app.register(staticFiles, { root });
    app.get('/', async (request, reply) => {
      // The gateway strips the ingress prefix. Explicit base also handles slashless ingress URLs.
      const prefix = request.headers['x-ingress-path'];
      const base = typeof prefix === 'string' && /^\/[a-zA-Z0-9_\-/]+$/.test(prefix) ? `${prefix.replace(/\/$/, '')}/` : '/';
      const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
      return reply.header('Cache-Control', 'no-store').type('text/html').send(html.replace('<head>', `<head><base href="${base}">`));
    });
  } // Vite serves the frontend when dist is absent.
  return app;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  await app.listen({ port: Number(process.env.PORT || 8099), host: process.env.HOST || '127.0.0.1' });
  app.log.info({ homeAssistant: process.env.SUPERVISOR_TOKEN ? 'supervisor' : process.env.HA_TOKEN ? 'local' : 'not configured', ingressOnly: !!process.env.SUPERVISOR_TOKEN || process.env.ENTANGLE_INGRESS_ONLY === 'true' }, 'Entangle ready. Select Live Mode to connect; Sandbox remains isolated.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { app.log.info('Shutting down Entangle'); await app.close(); process.exit(0); });
}
