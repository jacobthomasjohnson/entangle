const literals = value => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',').map(x => x.trim()) : []).filter(x => typeof x === 'string' && !/[{}%]/.test(x));
export function buildGraph(data, configuration) {
  const nodes = new Map(), edges = new Map();
  const registry = new Map(data.entities.map(e => [e.entity_id, e]));
  const states = new Map(data.states.map(s => [s.entity_id, s]));
  const add = node => nodes.set(node.id, node);
  for (const a of data.areas) add({ id: `area:${a.area_id}`, kind: 'area', label: a.name, areaId: a.area_id });
  for (const d of data.devices) add({ id: `device:${d.id}`, kind: 'device', label: d.name_by_user || d.name || d.id, manufacturer: d.manufacturer, model: d.model, areaId: d.area_id });
  for (const entityId of new Set([...registry.keys(), ...states.keys()])) {
    const r = registry.get(entityId), s = states.get(entityId);
    const device = nodes.get(`device:${r?.device_id}`);
    const domain = entityId.split('.')[0];
    add({ id: entityId, entityId, kind: ['automation', 'script'].includes(domain) ? domain : 'entity', label: s?.attributes?.friendly_name || r?.name || r?.original_name || entityId, state: s?.state ?? null, lastChanged: s?.last_changed, unit: s?.attributes?.unit_of_measurement, deviceId: r?.device_id, areaId: r?.area_id || device?.areaId, disabled: !!r?.disabled_by });
  }
  const edge = (source, target, relationship) => {
    if (!nodes.has(source) || !nodes.has(target) || source === target) return;
    const id = `${source}|${relationship}|${target}`; edges.set(id, { id, source, target, relationship });
  };
  for (const node of nodes.values()) {
    if (node.entityId && node.deviceId) edge(node.id, `device:${node.deviceId}`, 'owned by');
    if (node.areaId) edge(node.id, `area:${node.areaId}`, node.entityId && !registry.get(node.id)?.area_id ? 'inherited area' : 'assigned area');
  }
  let analyzed = 0;
  const automationIds = new Map();
  for (const s of states.values()) {
    if (!s.entity_id.startsWith('automation.') || s.attributes?.id == null) continue;
    const id = String(s.attributes.id);
    if (!automationIds.has(id)) automationIds.set(id, []);
    automationIds.get(id).push(s.entity_id);
  }
  function walk(value, source, role) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(v => walk(v, source, role)); return; }
    // A template condition's entity_id is a rendering hint, not a proven dependency.
    if (value.condition === 'template' || value.platform === 'template' || value.trigger === 'template') return;
    const service = value.action || value.service;
    if (role === 'action' && typeof service === 'string' && /^script\.[a-z0-9_]+$/.test(service) && !['script.turn_on', 'script.turn_off', 'script.toggle', 'script.reload'].includes(service) && nodes.get(service)?.kind === 'script') edge(source, service, 'calls');
    for (const id of literals(value.entity_id)) if (/^[a-z_]+\.[a-z0-9_]+$/.test(id)) edge(source, id, role);
    for (const id of literals(value.device_id)) edge(source, `device:${id}`, `${role} device`);
    for (const id of literals(value.area_id)) edge(source, `area:${id}`, `${role} area`);
    for (const [key, child] of Object.entries(value)) {
      // Only structural action/condition fields and service targets; never arbitrary data strings.
      if (['target', 'conditions', 'condition', 'if', 'while', 'until', 'sequence', 'then', 'else', 'choose', 'default', 'repeat', 'parallel', 'wait_for_trigger'].includes(key)) walk(child, source, key === 'wait_for_trigger' ? 'trigger' : ['conditions', 'condition', 'if', 'while', 'until'].includes(key) ? 'condition' : role);
    }
  }
  for (const automation of configuration.automations) {
    if (!automation || automation.id == null || automation.use_blueprint) continue;
    const matches = automationIds.get(String(automation.id)) || [];
    if (matches.length !== 1) continue;
    const source = matches[0]; analyzed++;
    walk(automation.triggers || automation.trigger, source, 'trigger'); walk(automation.conditions || automation.condition, source, 'condition'); walk(automation.actions || automation.action, source, 'action');
  }
  for (const [key, script] of Object.entries(configuration.scripts)) {
    if (!nodes.has(`script.${key}`) || !script || typeof script !== 'object' || Array.isArray(script) || script.use_blueprint) continue;
    analyzed++; walk(script.sequence, `script.${key}`, 'action');
  }
  const skipped = configuration.automations.length + Object.keys(configuration.scripts).length - analyzed;
  return { nodes: [...nodes.values()], edges: [...edges.values()], warnings: [...data.warnings, ...configuration.warnings, ...(skipped ? [`${skipped} YAML configurations could not be uniquely mapped to a current automation/script entity or use a blueprint; their relationships are omitted.`] : [])], analyzed };
}
export function selectSubgraph(graph, focus, depth = 1, limit = 180) {
  const selected = new Set([focus]); let frontier = new Set([focus]); let truncated = false;
  for (let level = 0; level < depth; level++) {
    const next = new Set();
    for (const e of graph.edges) {
      const other = frontier.has(e.source) ? e.target : frontier.has(e.target) ? e.source : null;
      if (!other || selected.has(other)) continue;
      if (selected.size >= limit) { truncated = true; continue; }
      selected.add(other); next.add(other);
    }
    frontier = next;
  }
  return { nodes: graph.nodes.filter(n => selected.has(n.id)), edges: graph.edges.filter(e => selected.has(e.source) && selected.has(e.target)), truncated };
}
