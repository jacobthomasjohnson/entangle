// Sandbox data never passes through the Home Assistant connector or API.
export const SANDBOX_VERSION = 1;
export const STORAGE_KEY = 'entangle.sandbox.v1';
export const kinds = ['entity', 'device', 'area', 'automation', 'script'];
const rules = {
  'device:entity': ['provides'],
  'area:device': ['contains'],
  'area:entity': ['assigned to'],
  'automation:entity': ['triggers from', 'checks condition', 'controls'],
  'script:entity': ['controls'],
  'automation:script': ['calls'],
};
export function relationshipTypes(source, target) {
  if (!source || !target || source.id === target.id) return [];
  return rules[`${source.kind}:${target.kind}`] || [];
}
export function emptySandbox() { return { version: SANDBOX_VERSION, nodes: [], edges: [] }; }
export function starterSandbox() {
  return validateSandbox({ version: SANDBOX_VERSION, nodes: [
    { id: 'studio', kind: 'area', label: 'Studio', description: 'Virtual workspace' },
    { id: 'lamp-device', kind: 'device', label: 'Studio lamp', manufacturer: 'Sandbox', model: 'Dimmable lamp' },
    { id: 'lamp', kind: 'entity', label: 'Studio light', entityId: 'light.studio_lamp', state: 'off' },
    { id: 'door', kind: 'entity', label: 'Front door', entityId: 'binary_sensor.front_door', state: 'off' },
    { id: 'door-device', kind: 'device', label: 'Door sensor', manufacturer: 'Sandbox', model: 'Contact sensor' },
    { id: 'arrival', kind: 'automation', label: 'Welcome home', description: 'Illustrative references only; this automation does not run.' },
    { id: 'evening', kind: 'script', label: 'Evening lights', description: 'A virtual script, without execution.' },
  ], edges: [
    { id: 'e1', source: 'studio', target: 'lamp-device', relationship: 'contains' },
    { id: 'e2', source: 'lamp-device', target: 'lamp', relationship: 'provides' },
    { id: 'e3', source: 'studio', target: 'lamp', relationship: 'assigned to' },
    { id: 'e4', source: 'door-device', target: 'door', relationship: 'provides' },
    { id: 'e5', source: 'arrival', target: 'door', relationship: 'triggers from' },
    { id: 'e6', source: 'arrival', target: 'lamp', relationship: 'checks condition' },
    { id: 'e7', source: 'arrival', target: 'evening', relationship: 'calls' },
    { id: 'e8', source: 'evening', target: 'lamp', relationship: 'controls' },
  ] });
}
function string(value, name, required = false, max = 500) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${name} must be ${required ? 'a nonempty' : 'a'} string (max ${max} characters).`);
  return value.trim();
}
export function validateSandbox(value) {
  if (!value || typeof value !== 'object' || value.version !== SANDBOX_VERSION) throw new Error('Unsupported sandbox version. Import a version 1 export or reset the sandbox.');
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges) || value.nodes.length > 2000 || value.edges.length > 10000) throw new Error('Sandbox must contain nodes and edges arrays (max 2,000 nodes / 10,000 edges).');
  const ids = new Set(), entityIds = new Set();
  const nodes = value.nodes.map(n => {
    if (!n || !kinds.includes(n.kind)) throw new Error('Invalid node type.');
    const id = string(n.id, 'Node ID', true, 128);
    if (!/^[a-zA-Z0-9_.:-]+$/.test(id)) throw new Error('Node IDs may contain letters, numbers, _, ., :, and - only.');
    if (ids.has(id)) throw new Error(`Duplicate node ID: ${id}`); ids.add(id);
    const node = { id, kind: n.kind, label: string(n.label, 'Display name', true, 200) };
    for (const key of ['description', ...(n.kind === 'entity' ? ['state', 'unit'] : n.kind === 'device' ? ['manufacturer', 'model'] : [])]) {
      const result = string(n[key], key, false, key === 'description' ? 2000 : 500);
      if (result !== undefined) node[key] = result;
    }
    if (n.kind === 'entity') {
      if (n.entity_category !== undefined && n.entity_category !== null && n.entity_category !== '') {
        if (!['diagnostic', 'config'].includes(n.entity_category)) throw new Error('entity_category must be diagnostic, config, or uncategorized.');
        node.entity_category = n.entity_category;
      }
      const entityId = string(n.entityId, 'entity_id', true, 200);
      if (!/^[a-z_]+\.[a-z0-9_]+$/.test(entityId)) throw new Error('entity_id must look like light.studio_lamp.');
      if (entityIds.has(entityId)) throw new Error(`Duplicate entity_id: ${entityId}`); entityIds.add(entityId);
      node.entityId = entityId;
    }
    if (n.position !== undefined) {
      if (!n.position || !['x', 'y'].every(k => Number.isFinite(n.position[k]) && Math.abs(n.position[k]) <= 1000000)) throw new Error('Invalid node position.');
      node.position = { x: n.position.x, y: n.position.y };
    }
    return node;
  });
  const byId = new Map(nodes.map(n => [n.id, n])), edgeIds = new Set(), relationships = new Set();
  const edges = value.edges.map(e => {
    if (!e || typeof e !== 'object') throw new Error('Invalid relationship.');
    const id = string(e.id, 'Edge ID', true, 128);
    const source = string(e.source, 'Source', true, 128), target = string(e.target, 'Target', true, 128);
    const relationship = string(e.relationship, 'Relationship', true, 100);
    if (!relationshipTypes(byId.get(source), byId.get(target)).includes(relationship)) throw new Error(`Unsupported relationship: ${source} → ${target} (${relationship}). Remove incompatible connections before changing a node type.`);
    const key = JSON.stringify([source, target, relationship]);
    if (edgeIds.has(id) || relationships.has(key)) throw new Error('Duplicate relationship or edge ID.');
    edgeIds.add(id); relationships.add(key);
    return { id, source, target, relationship };
  });
  return { version: SANDBOX_VERSION, nodes, edges };
}
export function serializeSandbox(data) { return JSON.stringify(validateSandbox(data), null, 2); }
export function parseSandbox(text) {
  if (typeof text !== 'string' || text.length > 5 * 1024 * 1024) throw new Error('Sandbox JSON exceeds 5 MB.');
  let parsed; try { parsed = JSON.parse(text); } catch { throw new Error('Invalid JSON. The current sandbox has not been changed.'); }
  return validateSandbox(parsed);
}
export function loadSandbox(storage) {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    return { data: saved ? parseSandbox(saved) : starterSandbox(), warning: '' };
  } catch { return { data: starterSandbox(), warning: 'Saved sandbox is unavailable, malformed or outdated. Starter data is shown; saved data is replaced only after an edit, import or reset.' }; }
}
export function saveSandbox(storage, data) {
  try { storage.setItem(STORAGE_KEY, serializeSandbox(data)); return ''; }
  catch { return 'Browser storage is unavailable or full. Changes remain in memory; export JSON to keep them.'; }
}
export function updateNode(data, originalId, node) {
  if (originalId && !data.nodes.some(n => n.id === originalId)) throw new Error('Node no longer exists.');
  return validateSandbox({ ...data,
    nodes: originalId ? data.nodes.map(n => n.id === originalId ? node : n) : [...data.nodes, node],
    edges: data.edges.map(e => ({ ...e, source: e.source === originalId ? node.id : e.source, target: e.target === originalId ? node.id : e.target })),
  });
}
export function deleteNode(data, id) { return { ...data, nodes: data.nodes.filter(n => n.id !== id), edges: data.edges.filter(e => e.source !== id && e.target !== id) }; }
export function addRelationship(data, source, target, relationship) {
  let i = 1; const ids = new Set(data.edges.map(e => e.id)); while (ids.has(`edge-${i}`)) i++;
  return validateSandbox({ ...data, edges: [...data.edges, { id: `edge-${i}`, source, target, relationship }] });
}
