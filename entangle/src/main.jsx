import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Background, Controls, Handle, Position, BaseEdge, EdgeLabelRenderer, ReactFlowProvider, useReactFlow, applyNodeChanges } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { selectSubgraph } from '../server/graph.js';
import { kinds, emptySandbox, starterSandbox, loadSandbox, saveSandbox, parseSandbox, serializeSandbox, updateNode, deleteNode, addRelationship, relationshipTypes } from './sandbox.js';
import '@xyflow/react/dist/style.css';
import './style.css';

async function api(endpoint, options) {
  const response = await fetch(new URL(`api/${endpoint}`, document.baseURI), options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
function storage() { try { return window.localStorage; } catch { return undefined; } }
const symbols = { entity: '◈', device: '▣', area: '⌖', automation: 'ϟ', script: '≡' };
function Node({ data, selected }) {
  return <div className={`graph-node ${data.kind} ${selected ? 'selected' : ''}`}>
    <Handle type="target" position={Position.Left}/><div className="node-kind">{symbols[data.kind]} {data.kind}</div>
    <strong title={data.label}>{data.label}</strong><small title={data.entityId || data.id}>{data.entityId || data.model || data.id}{data.state !== undefined && data.state !== null ? ` · ${data.state}` : ''}</small>
    <Handle type="source" position={Position.Right}/>
  </div>;
}
const nodeTypes = { relationship: Node };
function RelationshipEdge({ id, sourceX, sourceY, targetX, targetY, data, label, style, selected }) {
  const bend = data?.bend || 0, distance = Math.max(65, Math.abs(targetX - sourceX) * 0.45);
  const path = `M ${sourceX},${sourceY} C ${sourceX + distance},${sourceY + bend} ${targetX - distance},${targetY + bend} ${targetX},${targetY}`;
  return <><BaseEdge id={id} path={path} style={style}/><EdgeLabelRenderer><div className={`relationship-label nodrag nopan ${selected ? 'selected' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px,${(sourceY + targetY) / 2 + bend * 0.75}px)` }}>{label}</div></EdgeLabelRenderer></>;
}
const edgeTypes = { relationship: RelationshipEdge };
function layout(graph) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 35, ranksep: 100 }); g.setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach(n => g.setNode(n.id, { width: 220, height: 90 }));
  graph.edges.forEach(e => g.setEdge(e.source, e.target)); dagre.layout(g);
  const pairs = new Map();
  for (const e of graph.edges) { const key = JSON.stringify([e.source, e.target]); if (!pairs.has(key)) pairs.set(key, []); pairs.get(key).push(e.id); }
  return {
    nodes: graph.nodes.map(n => ({ id: n.id, type: 'relationship', data: n, position: { x: g.node(n.id).x - 110, y: g.node(n.id).y - 45 } })),
    edges: graph.edges.map(e => { const siblings = pairs.get(JSON.stringify([e.source, e.target])); return { ...e, type: 'relationship', data: { bend: (siblings.indexOf(e.id) - (siblings.length - 1) / 2) * 44 }, label: e.relationship, style: { stroke: '#626581' } }; }), truncated: graph.truncated,
  };
}

function NodeEditor({ node, onSave, onCancel, creating = false }) {
  const [draft, setDraft] = useState({ ...node }), [error, setError] = useState('');
  const field = (key, label, required = false, multiline = false) => <label className="edit-field" key={key}>{label}{multiline
    ? <textarea value={draft[key] || ''} maxLength={2000} onChange={e => setDraft({ ...draft, [key]: e.target.value })}/>
    : <input required={required} value={draft[key] ?? ''} maxLength={key === 'id' ? 128 : key === 'label' || key === 'entityId' ? 200 : 500} onChange={e => setDraft({ ...draft, [key]: e.target.value })}/>}</label>;
  return <form className="node-editor" onSubmit={e => { e.preventDefault(); try { onSave({ ...draft, position: node.position }); setError(''); } catch (err) { setError(err.message); } }}>
    {field('id', 'Unique node ID', true)}{field('label', 'Display name', true)}
    <label className="edit-field">Node type<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value, entityId: draft.entityId || 'sensor.new_entity' })}>{kinds.map(k => <option key={k}>{k}</option>)}</select></label>
    {draft.kind === 'entity' && <>{field('entityId', 'entity_id', true)}{field('state', 'Current state')}{field('unit', 'Unit')}</>}
    {draft.kind === 'device' && <>{field('manufacturer', 'Manufacturer')}{field('model', 'Model')}</>}
    {field('description', 'Description', false, true)}{error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions"><button type="submit">{creating ? 'Create node' : 'Save changes'}</button>{creating && <button type="button" onClick={onCancel}>Cancel</button>}</div>
  </form>;
}

function App() {
  const initial = useRef(null); if (!initial.current) initial.current = loadSandbox(storage());
  const [sandbox, setSandbox] = useState(initial.current.data), [notice, setNotice] = useState(initial.current.warning);
  const [mode, setMode] = useState('sandbox'); const editable = mode === 'sandbox';
  const [snapshot, setSnapshot] = useState(null), [busy, setBusy] = useState(false), [liveError, setLiveError] = useState('');
  const [query, setQuery] = useState(''), [focus, setFocus] = useState(''), [depth, setDepth] = useState(1);
  const [inspectedId, setInspectedId] = useState(''), [selectedEdge, setSelectedEdge] = useState(''), [creating, setCreating] = useState(false);
  const [connection, setConnection] = useState(null), [actionError, setActionError] = useState('');
  const [liveGraph, setLiveGraph] = useState({ nodes: [], edges: [] }), [graph, setGraph] = useState({ nodes: [], edges: [] }), [graphBusy, setGraphBusy] = useState(false);
  const flow = useReactFlow(), generation = useRef(0), fileInput = useRef(null), viewKey = useRef(''), fitTimer = useRef(null);
  async function refresh(initialLoad = false) {
    setBusy(true); setLiveError('');
    try { setSnapshot(await api(initialLoad ? 'snapshot' : 'refresh', initialLoad ? undefined : { method: 'POST' })); }
    catch (e) { setLiveError(e.message); setSnapshot(null); } finally { setBusy(false); }
  }
  useEffect(() => { if (mode === 'live') refresh(true); }, [mode]);
  useEffect(() => {
    const version = ++generation.current;
    if (editable || !focus || !snapshot?.connected) { setLiveGraph({ nodes: [], edges: [] }); setGraphBusy(false); return; }
    setGraphBusy(true); setLiveError('');
    api(`graph?focus=${encodeURIComponent(focus)}&depth=${depth}`).then(result => { if (version === generation.current) setLiveGraph(result); })
      .catch(e => { if (version === generation.current) { setLiveError(e.message); setLiveGraph({ nodes: [], edges: [] }); } })
      .finally(() => { if (version === generation.current) setGraphBusy(false); });
    return () => { generation.current++; };
  }, [mode, focus, depth, snapshot]);
  const rawGraph = useMemo(() => {
    if (!editable) return liveGraph;
    if (focus) return selectSubgraph(sandbox, focus, depth);
    const nodes = sandbox.nodes.slice(0, 180), ids = new Set(nodes.map(n => n.id));
    return { nodes, edges: sandbox.edges.filter(e => ids.has(e.source) && ids.has(e.target)), truncated: sandbox.nodes.length > 180 };
  }, [sandbox, editable, focus, depth, liveGraph]);
  useEffect(() => {
    const key = `${mode}|${focus}|${depth}`, resetView = viewKey.current !== key;
    viewKey.current = key; const next = layout(rawGraph);
    setGraph(previous => {
      const positions = new Map(previous.nodes.map(n => [n.id, n.position]));
      return { ...next, nodes: next.nodes.map(n => ({ ...n, position: editable ? n.data.position || (!resetView && positions.get(n.id)) || n.position : n.position })) };
    });
    // Metadata/edge edits keep the viewport. Navigation and first load fit once.
    if (resetView || (!editable && rawGraph.nodes.length)) {
      clearTimeout(fitTimer.current); fitTimer.current = setTimeout(() => flow.fitView({ padding: 0.22, duration: 150 }), 50);
    }
  }, [rawGraph, mode, focus, depth]);
  useEffect(() => () => clearTimeout(fitTimer.current), []);
  const searchable = editable ? sandbox.nodes : snapshot?.entities || [];
  const matches = useMemo(() => { const q = query.toLowerCase(); return searchable.filter(n => `${n.label} ${n.entityId || n.id} ${n.kind}`.toLowerCase().includes(q)); }, [searchable, query]);
  const inspected = (editable ? sandbox.nodes : liveGraph.nodes).find(n => n.id === inspectedId);
  const inspectedEdge = rawGraph.edges.find(e => e.id === selectedEdge);
  const choose = id => { setFocus(id); setDepth(1); setInspectedId(id); setSelectedEdge(''); setCreating(false); setActionError(''); };
  function switchMode(next) {
    setMode(next); setFocus(''); setDepth(1); setQuery(''); setInspectedId(''); setSelectedEdge(''); setCreating(false); setConnection(null); setActionError('');
  }
  function commit(next) { setSandbox(next); setNotice(saveSandbox(storage(), next)); setActionError(''); }
  function replace(next) {
    commit(next); setFocus(''); setDepth(1); setInspectedId(''); setSelectedEdge(''); setCreating(false); setConnection(null); viewKey.current = ''; setQuery('');
  }
  function createNode() { setCreating(true); setInspectedId(''); setSelectedEdge(''); setActionError(''); }
  let newNumber = 1; while (sandbox.nodes.some(n => n.id === `node-${newNumber}` || n.entityId === `sensor.new_entity_${newNumber}`)) newNumber++;
  function saveNode(node) {
    if (!editable) return;
    const originalId = creating ? null : inspectedId, next = updateNode(sandbox, originalId, node);
    const id = node.id.trim();
    commit(next); setCreating(false); setInspectedId(id);
    if (creating) setFocus(next.nodes.length > 180 ? id : '');
    else if (focus === originalId) setFocus(id);
  }
  function removeNode(id) {
    if (!editable) return;
    commit(deleteNode(sandbox, id)); setInspectedId(''); setSelectedEdge(''); if (focus === id) setFocus('');
  }
  function removeEdge(id) { if (editable) { commit({ ...sandbox, edges: sandbox.edges.filter(e => e.id !== id) }); setSelectedEdge(''); } }
  function connect({ source, target }) {
    if (!editable) return;
    const options = relationshipTypes(sandbox.nodes.find(n => n.id === source), sandbox.nodes.find(n => n.id === target));
    if (!options.length) { setActionError('Unsupported connection. Drag from an area, device, automation or script to a compatible target.'); return; }
    if (options.length > 1) { setConnection({ source, target, options, relationship: options[0] }); return; }
    try { commit(addRelationship(sandbox, source, target, options[0])); } catch (e) { setActionError(e.message); }
  }
  function autoLayout() {
    const next = layout(rawGraph);
    if (editable) { const positions = new Map(next.nodes.map(n => [n.id, n.position])); commit({ ...sandbox, nodes: sandbox.nodes.map(n => positions.has(n.id) ? { ...n, position: positions.get(n.id) } : n) }); }
    setGraph(next); clearTimeout(fitTimer.current); fitTimer.current = setTimeout(() => flow.fitView({ padding: 0.22, duration: 150 }), 50);
  }
  async function importFile(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try { if (file.size > 5 * 1024 * 1024) throw new Error('Sandbox JSON exceeds 5 MB.'); replace(parseSandbox(await file.text())); } catch (e) { setActionError(e.message); }
  }
  function exportFile() {
    const url = URL.createObjectURL(new Blob([serializeSandbox(sandbox)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'entangle-sandbox.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const error = actionError || (editable ? '' : liveError || snapshot?.error);
  const renderedNodes = graph.nodes.map(n => ({ ...n, selected: n.id === inspectedId }));
  const renderedEdges = graph.edges.map(e => ({ ...e, selected: e.id === selectedEdge, style: { ...e.style, stroke: e.id === selectedEdge ? '#a5a0f0' : '#626581', strokeWidth: e.id === selectedEdge ? 3 : 1.5 } }));
  return <div className="app">
    <header><div className="brand"><span>⋈</span> Entangle <small>ENTITY EXPLORER</small></div><div className="header-actions">
      <div className="mode-selector" role="group" aria-label="Mode">{['live', 'sandbox'].map(m => <button key={m} className={mode === m ? 'active' : ''} aria-pressed={mode === m} onClick={() => switchMode(m)}>{m === 'live' ? 'Live' : 'Sandbox'}</button>)}</div>
      <span className={`status ${editable ? 'sandbox-status' : snapshot?.connected ? 'online' : ''}`}>{editable ? 'Sandbox · virtual data' : busy ? 'Connecting…' : snapshot?.connected ? 'Connected · snapshot' : 'Disconnected'}</span>
      {editable ? <button onClick={createNode}>+ Add Node</button> : <button onClick={() => refresh()} disabled={busy}>{busy ? 'Refreshing…' : '↻ Refresh'}</button>}
    </div></header>
    <main>
      <aside className="sidebar"><div className="sidebar-top"><h2>{editable ? 'Sandbox nodes' : 'Entities'} <span>{searchable.length}</span></h2><input aria-label="Search nodes" placeholder="Search name or ID…" value={query} onChange={e => setQuery(e.target.value)}/><small>{matches.length} results{matches.length > 150 ? ' · showing first 150' : ''}</small></div>
        <div className="entity-list">{matches.slice(0, 150).map(n => <button className={`entity-row ${focus === n.id ? 'active' : ''}`} key={n.id} onClick={() => choose(n.id)}><span className={`symbol ${n.kind}`}>{symbols[n.kind]}</span><div><strong>{n.label}</strong><small>{n.entityId || n.id}</small></div></button>)}{!busy && !matches.length && <p className="muted padding">{query ? 'No matching nodes.' : editable ? 'Your sandbox is empty. Add a node to begin.' : 'Connect to Home Assistant to load entities.'}</p>}</div>
        <footer>{editable ? 'Virtual data · saved in this browser' : 'Read only · refreshed on demand'}{!editable && snapshot?.refreshedAt && <small>Updated {new Date(snapshot.refreshedAt).toLocaleTimeString()}</small>}</footer>
      </aside>
      <section className="canvas">
        <div className="graph-toolbar"><div><strong>{focus ? searchable.find(n => n.id === focus)?.label || focus : editable ? 'Sandbox workspace' : 'Explore your home'}</strong><small>{editable || focus ? `${graph.nodes.length} nodes · ${graph.edges.length} relationships` : 'Verified relationships, one entity at a time'}</small></div>
          {(editable || (focus && snapshot?.connected)) && <div className="toolbar-buttons">
            {focus && <><button onClick={() => setDepth(depth === 1 ? 2 : 1)}>{depth === 1 ? 'Expand one level' : 'Immediate only'}</button><button onClick={() => { setDepth(1); setInspectedId(focus); setSelectedEdge(''); flow.fitView({ padding: 0.22 }); }}>Reset focus</button></>}
            {editable && focus && <button onClick={() => { setFocus(''); setDepth(1); }}>Show all</button>}
            <button onClick={autoLayout}>Auto layout</button><button onClick={() => flow.fitView({ padding: 0.22 })}>Fit view</button>
            {editable && <details className="sandbox-menu"><summary>Sandbox tools</summary><div><button onClick={() => replace(starterSandbox())}>Reset Sandbox</button><button onClick={() => replace(emptySandbox())}>Clear / start empty</button><button onClick={() => fileInput.current?.click()}>Import JSON</button><button onClick={exportFile}>Export JSON</button></div></details>}
          </div>}
        </div>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importFile}/>
        {error && <div role="alert" className="error">{error}</div>}{editable && notice && <div className="storage-notice" role="status">{notice}</div>}
        <div className="flow-container">{editable || (focus && snapshot?.connected) ? <>
          <ReactFlow nodes={renderedNodes} edges={renderedEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            onNodeClick={(_, n) => { setInspectedId(n.id); setSelectedEdge(''); setCreating(false); }} onEdgeClick={(_, e) => { setSelectedEdge(e.id); setInspectedId(''); setCreating(false); }} onPaneClick={() => { setInspectedId(''); setSelectedEdge(''); setCreating(false); }}
            onNodesChange={changes => setGraph(g => ({ ...g, nodes: applyNodeChanges(changes.filter(c => c.type === 'position' || c.type === 'dimensions'), g.nodes) }))}
            onNodeDragStop={(_, node) => { if (editable) commit({ ...sandbox, nodes: sandbox.nodes.map(n => n.id === node.id ? { ...n, position: node.position } : n) }); }}
            onConnect={connect} nodesConnectable={editable} nodesDraggable={editable} edgesReconnectable={false} deleteKeyCode={null} colorMode="dark" minZoom={0.1} maxZoom={1.8} fitView>
            <Background color="#292e38" gap={24}/><Controls showInteractive={false}/>
          </ReactFlow>
          {editable && !sandbox.nodes.length && <div className="empty sandbox-empty"><span>⋈</span><h1>Build your sandbox</h1><p>Add a node or restore the starter graph from Sandbox tools.</p><button onClick={createNode}>+ Add Node</button></div>}
        </> : <div className="empty"><span>⋈</span><h1>{busy ? 'Connecting to Home Assistant' : 'Start with an entity'}</h1><p>{busy ? 'Loading states and registries…' : 'Search and select an entity to explore its connections.'}</p></div>}{graphBusy && <div className="loading" role="status">Loading relationships…</div>}</div>
        <div className="coverage">{graph.truncated && <p>Graph limited to 180 nodes. Search for a specific node to explore further.</p>}
          {editable ? <span>Sandbox · virtual data only. Drag from a right handle to a left handle to connect. Select a node or edge to edit. No automations execute.</span> : <details><summary>Coverage · graph is not exhaustive{snapshot ? ` · ${snapshot.analyzed} YAML configurations analyzed` : ''}</summary>{snapshot?.warnings.map((w, i) => <p key={i}>{w}</p>)}<p>Ownership and area assignments come from registries. Edges describe references, not guaranteed runtime execution. State is current as of the last refresh.</p></details>}
        </div>
      </section>
      {(creating || inspected || inspectedEdge) && <aside className="inspector">
        <div className="inspector-top"><h2>{creating ? 'Add Node' : inspectedEdge ? 'Relationship' : 'Inspector'}</h2><button aria-label="Close inspector" onClick={() => { setInspectedId(''); setSelectedEdge(''); setCreating(false); }}>×</button></div>
        {creating && editable && <NodeEditor key="new" creating node={{ id: `node-${newNumber}`, kind: 'entity', label: 'New entity', entityId: `sensor.new_entity_${newNumber}`, state: 'unknown' }} onSave={saveNode} onCancel={() => setCreating(false)}/>}
        {inspected && <><span className={`kind-tag ${inspected.kind}`}>{symbols[inspected.kind]} {inspected.kind}</span><h2 className="inspector-name">{inspected.label}</h2><code>{inspected.entityId || inspected.id}</code>
          {editable ? <><NodeEditor key={inspected.id} node={inspected} onSave={saveNode}/><button className="danger" onClick={() => removeNode(inspected.id)}>Delete node and connections</button></> : <dl>{[['State', inspected.state === null ? 'No current state' : inspected.state], ['Unit', inspected.unit], ['Last changed', inspected.lastChanged && new Date(inspected.lastChanged).toLocaleString()], ['Device', inspected.deviceId], ['Area', inspected.areaId], ['Manufacturer', inspected.manufacturer], ['Model', inspected.model], ['Registry', inspected.disabled ? 'Disabled' : null]].filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>}
          {inspected.id !== focus && <button className="focus-button" onClick={() => choose(inspected.id)}>Focus this {editable ? 'node' : 'entity'}</button>}
          <h3>{editable ? 'Connections' : 'Visible connections'}</h3><div className="connections">{(editable ? sandbox.edges : rawGraph.edges).filter(e => e.source === inspected.id || e.target === inspected.id).map(e => <div key={e.id}><small>{e.relationship} {e.source === inspected.id ? '→' : '←'}</small><code>{e.source === inspected.id ? e.target : e.source}</code>{editable && <button aria-label={`Remove ${e.relationship} relationship`} onClick={() => removeEdge(e.id)}>Remove</button>}</div>)}</div>
        </>}
        {inspectedEdge && <><h2 className="inspector-name">{inspectedEdge.relationship}</h2><dl><dt>Source</dt><dd>{inspectedEdge.source}</dd><dt>Target</dt><dd>{inspectedEdge.target}</dd></dl>{editable && <button className="danger" onClick={() => removeEdge(inspectedEdge.id)}>Delete relationship</button>}</>}
      </aside>}
    </main>
    {editable && connection && <div className="dialog-backdrop"><form className="connection-dialog" role="dialog" aria-modal="true" aria-labelledby="relationship-title" onSubmit={e => { e.preventDefault(); try { commit(addRelationship(sandbox, connection.source, connection.target, connection.relationship)); setConnection(null); } catch (err) { setActionError(err.message); setConnection(null); } }}>
      <h2 id="relationship-title">Choose relationship</h2><p><code>{connection.source} → {connection.target}</code></p><label className="edit-field">Relationship type<select autoFocus value={connection.relationship} onChange={e => setConnection({ ...connection, relationship: e.target.value })}>{connection.options.map(o => <option key={o}>{o}</option>)}</select></label><div className="form-actions"><button type="submit">Add relationship</button><button type="button" onClick={() => setConnection(null)}>Cancel</button></div>
    </form></div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<ReactFlowProvider><App/></ReactFlowProvider>);
