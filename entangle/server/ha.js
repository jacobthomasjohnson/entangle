import WebSocket from 'ws';

// Only these read-only commands can leave this process.
const allowed = new Set(['get_states', 'config/entity_registry/list', 'config/device_registry/list', 'config/area_registry/list']);
export async function readHomeAssistant(env = process.env, { signal, WebSocketImpl = WebSocket } = {}) {
  const token = env.SUPERVISOR_TOKEN || env.HA_TOKEN;
  if (!token) throw new Error('Home Assistant is not configured. Set HA_URL and HA_TOKEN on the server.');
  let url;
  if (env.SUPERVISOR_TOKEN) url = 'ws://supervisor/core/websocket';
  else {
    const base = new URL(env.HA_URL || 'http://homeassistant.local:8123');
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error('HA_URL must use http or https.');
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    base.pathname = `${base.pathname.replace(/\/$/, '')}/api/websocket`;
    base.search = ''; base.hash = ''; url = base.href;
  }
  if (signal?.aborted) throw new Error('Home Assistant request cancelled during shutdown.');
  const ws = new WebSocketImpl(url, { maxPayload: 32 * 1024 * 1024 });
  let id = 0;
  const pending = new Map();
  let authenticate, failAuth;
  const auth = new Promise((resolve, reject) => { authenticate = resolve; failAuth = reject; });
  const fail = () => { failAuth(new Error('Home Assistant connection closed or unavailable.')); for (const p of pending.values()) p.reject(new Error('Home Assistant connection interrupted.')); pending.clear(); };
  const abort = () => { failAuth(new Error('Home Assistant request cancelled during shutdown.')); for (const p of pending.values()) p.reject(new Error('Home Assistant request cancelled during shutdown.')); pending.clear(); ws.terminate(); };
  signal?.addEventListener('abort', abort, { once: true });
  ws.on('error', fail); ws.on('close', fail);
  ws.on('message', raw => {
    let message; try { message = JSON.parse(raw); } catch { fail(); ws.close(); return; }
    if (message.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }));
    if (message.type === 'auth_ok') authenticate();
    if (message.type === 'auth_invalid') failAuth(new Error('Home Assistant authentication failed. Check the server token and permissions.'));
    if (message.type === 'result') {
      const p = pending.get(message.id); if (!p) return; pending.delete(message.id);
      if (message.success) p.resolve(message.result);
      else p.reject(new Error(`${p.type}: ${message.error?.code || 'command failed'}`));
    }
  });
  const timer = setTimeout(() => { failAuth(new Error('Home Assistant request timed out.')); for (const p of pending.values()) p.reject(new Error('Home Assistant request timed out.')); ws.terminate(); }, 20000);
  try {
    await auth;
    const command = type => new Promise((resolve, reject) => {
      if (!allowed.has(type)) return reject(new Error('Unsupported command'));
      const requestId = ++id; pending.set(requestId, { resolve, reject, type });
      ws.send(JSON.stringify({ id: requestId, type }));
    });
    const types = [...allowed];
    const results = await Promise.allSettled(types.map(command));
    if (results[0].status === 'rejected') throw results[0].reason;
    if (!Array.isArray(results[0].value)) throw new Error('Home Assistant returned invalid state data.');
    const warnings = [];
    const values = results.map((r, i) => { if (r.status === 'fulfilled' && Array.isArray(r.value)) return r.value; warnings.push(`${types[i]} unavailable; related relationships omitted.`); return []; });
    return { states: values[0], entities: values[1], devices: values[2], areas: values[3], warnings };
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort); ws.close();
    const closeTimer = setTimeout(() => ws.terminate(), 1000); closeTimer.unref();
    ws.once('close', () => clearTimeout(closeTimer));
  }
}
