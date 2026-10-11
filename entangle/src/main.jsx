import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Background, Controls, Handle, Position, BaseEdge, EdgeLabelRenderer, ReactFlowProvider, useReactFlow, applyNodeChanges } from '@xyflow/react';
import { layout, readPreference, writePreference, positionKey, domainOf, filterNodes, DIAGNOSTIC_FILTER_KEY, loadHideDiagnostic, isDiagnostic, filterDiagnosticGraph, diagnosticSelection } from './graph-ui.js';
import { appearance, NodeIcon } from './appearance.jsx';
import { selectSubgraph, selectAreaGraph } from '../server/graph.js';
import { kinds, emptySandbox, starterSandbox, loadSandbox, saveSandbox, parseSandbox, serializeSandbox, updateNode, deleteNode, addRelationship, relationshipTypes } from './sandbox.js';
import '@xyflow/react/dist/style.css';
import './style.css';
import { AppearanceSettings } from './settings.jsx';
import { areaLayout, VIEW_KEY, views, viewPositionKey } from './area-view.js';
import { THEME_KEY, sanitizeTheme, themeStyle } from './theme.js';

async function api(endpoint, options) {
  const response = await fetch(new URL(`api/${endpoint}`, document.baseURI), options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
function storage() { try { return window.localStorage; } catch { return undefined; } }
function Node({ data, selected }) {
  const visual = appearance(data), vertical = data.direction === 'TB';
  return <div className={`graph-node ${selected ? 'selected' : ''}`} style={{ '--node-color': visual.color }}>
    <Handle type="target" position={vertical ? Position.Top : Position.Left}/>
    <div className="node-heading"><NodeIcon node={data}/><strong title={data.label}>{data.label}</strong></div>
    <div className="node-kind">{visual.label}</div>
    {data.state != null && <small title={`${data.state} ${data.unit || ''}`}>{data.state} {data.unit || ''}</small>}
    <Handle type="source" position={vertical ? Position.Bottom : Position.Right}/>
  </div>;
}
function AreaNode({data,selected}) {
 const vertical=data.direction==='TB';
 return <div className={`area-container ${selected ? 'selected' : ''}`}>
  <Handle type="target" position={vertical ? Position.Top : Position.Left}/>
  <div className="area-heading"><NodeIcon node={data}/><strong>{data.label}</strong><small>{data.memberCount} members shown</small></div>
  <Handle type="source" position={vertical ? Position.Bottom : Position.Right}/>
 </div>;
}
const nodeTypes = { relationship: Node, area: AreaNode };
function RelationshipEdge({ id, source, target, sourceX, sourceY, targetX, targetY, data, label, style, selected }) {
  const [hovered, setHovered] = useState(false);
  const bend = data?.bend || 0, vertical = data?.direction === 'TB';
  const distance = Math.max(65, Math.abs(vertical ? targetY - sourceY : targetX - sourceX) * 0.45);
  const path = vertical
    ? `M ${sourceX},${sourceY} C ${sourceX + bend},${sourceY + distance} ${targetX + bend},${targetY - distance} ${targetX},${targetY}`
    : `M ${sourceX},${sourceY} C ${sourceX + distance},${sourceY + bend} ${targetX - distance},${targetY + bend} ${targetX},${targetY}`;
  return <><g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}><title>{`${source} ? ${target}: ${label}`}</title><BaseEdge id={id} path={path} style={style}/></g>
    {(selected || hovered) && <EdgeLabelRenderer><div className="relationship-label nodrag nopan selected" style={{ transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2 + (vertical ? bend * .75 : 0)}px,${(sourceY + targetY) / 2 + (vertical ? 0 : bend * .75)}px)` }} title={`${source} ? ${target}: ${label}`}>{label}</div></EdgeLabelRenderer>}</>;
}
const edgeTypes = { relationship: RelationshipEdge };

function NodeEditor({ node, onSave, onCancel, creating = false }) {
  const [draft, setDraft] = useState({ ...node }), [error, setError] = useState('');
  const field = (key, label, required = false, multiline = false) => <label className="edit-field" key={key}>{label}{multiline
    ? <textarea value={draft[key] || ''} maxLength={2000} onChange={e => setDraft({ ...draft, [key]: e.target.value })}/>
    : <input required={required} value={draft[key] ?? ''} maxLength={key === 'id' ? 128 : key === 'label' || key === 'entityId' ? 200 : 500} onChange={e => setDraft({ ...draft, [key]: e.target.value })}/>}</label>;
  return <form className="node-editor" onSubmit={e => { e.preventDefault(); try { onSave({ ...draft, position: node.position }); setError(''); } catch (err) { setError(err.message); } }}>
    {field('id', 'Unique node ID', true)}{field('label', 'Display name', true)}
    <label className="edit-field">Node type<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value, entityId: draft.entityId || 'sensor.new_entity' })}>{kinds.map(k => <option key={k}>{k}</option>)}</select></label>
    {draft.kind === 'entity' && <>{field('entityId', 'entity_id', true)}{field('state', 'Current state')}{field('unit', 'Unit')}<label className="edit-field">Entity category<select value={draft.entity_category || ''} onChange={e => setDraft({ ...draft, entity_category: e.target.value })}><option value="">Uncategorized</option><option value="diagnostic">Diagnostic</option><option value="config">Configuration</option></select></label></>}
    {draft.kind === 'device' && <>{field('manufacturer', 'Manufacturer')}{field('model', 'Model')}</>}
    {field('description', 'Description', false, true)}{error && <p className="form-error" role="alert">{error}</p>}
    <div className="form-actions"><button type="submit">{creating ? 'Create node' : 'Save changes'}</button>{creating && <button type="button" onClick={onCancel}>Cancel</button>}</div>
  </form>;
}

function App() {
 const [settingsOpen,setSettingsOpen] = useState(false);
 const [theme,setTheme] = useState(()=>sanitizeTheme(readPreference(storage(),THEME_KEY,{})));
 const [themeNotice,setThemeNotice] = useState('');
 function changeTheme(next) {
  const clean=sanitizeTheme(next);setTheme(clean);
  try { if (!storage()) throw new Error(); storage().setItem(THEME_KEY,JSON.stringify(clean));setThemeNotice(''); }
  catch { setThemeNotice('Changes apply now, but browser storage is unavailable. They will not survive a refresh.'); }
 }

  const initial = useRef(null); if (!initial.current) initial.current = loadSandbox(storage());
  const [sandbox, setSandbox] = useState(initial.current.data), [notice, setNotice] = useState(initial.current.warning);
  const [mode, setMode] = useState('sandbox'); const editable = mode === 'sandbox';
  const [snapshot, setSnapshot] = useState(null), [busy, setBusy] = useState(false), [liveError, setLiveError] = useState('');
  const [view, setView] = useState(() => readPreference(storage(), VIEW_KEY, 'areas') === 'relationships' ? 'relationships' : 'areas');
  const [direction, setDirection] = useState(() => readPreference(storage(), 'entangle.direction.v1', 'LR') === 'TB' ? 'TB' : 'LR');
  const positionsKey = viewPositionKey(mode, view, direction);
  const [domains, setDomains] = useState(() => { const value = readPreference(storage(), 'entangle.filters.v1', []); return Array.isArray(value) ? value.filter(d => typeof d === 'string') : []; });
  const [hideDiagnostic, setHideDiagnostic] = useState(() => loadHideDiagnostic(storage()));
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [query, setQuery] = useState(''), [focus, setFocus] = useState(''), [depth, setDepth] = useState(1);
  const [inspectedId, setInspectedId] = useState(''), [selectedEdge, setSelectedEdge] = useState(''), [creating, setCreating] = useState(false);
  const [connection, setConnection] = useState(null), [actionError, setActionError] = useState('');
  const [liveGraph, setLiveGraph] = useState({ nodes: [], edges: [] }), [graph, setGraph] = useState({ nodes: [], edges: [] }), [graphBusy, setGraphBusy] = useState(false);
  const flow = useReactFlow(), generation = useRef(0), fileInput = useRef(null), viewKey = useRef(''), layoutDirection = useRef(direction), fitTimer = useRef(null), fitPending = useRef(true);
  async function refresh(initialLoad = false) {
    setBusy(true); setLiveError('');
    try { setSnapshot(await api(initialLoad ? 'snapshot' : 'refresh', initialLoad ? undefined : { method: 'POST' })); }
    catch (e) { setLiveError(e.message); setSnapshot(null); } finally { setBusy(false); }
  }
  useEffect(() => { if (mode === 'live') refresh(true); }, [mode]);
  useEffect(() => {
    const version = ++generation.current;
    if (editable || (view === 'relationships' && !focus) || !snapshot?.connected) { setLiveGraph({ nodes: [], edges: [] }); setGraphBusy(false); return; }
    setGraphBusy(true); setLiveError('');
    api(`graph?view=${view}&focus=${encodeURIComponent(focus)}&depth=${depth}`).then(result => { if (version === generation.current) setLiveGraph(result); })
      .catch(e => { if (version === generation.current) { setLiveError(e.message); setLiveGraph({ nodes: [], edges: [] }); } })
      .finally(() => { if (version === generation.current) setGraphBusy(false); });
    return () => { generation.current++; };
  }, [mode, view, focus, depth, snapshot]);
  const rawGraph = useMemo(() => {
    if (!editable) return liveGraph;
    if (view === 'areas') return selectAreaGraph(sandbox, focus, depth);
    if (focus) return selectSubgraph(sandbox, focus, depth);
    const nodes = sandbox.nodes.slice(0, 180), ids = new Set(nodes.map(n => n.id));
    return { nodes, edges: sandbox.edges.filter(e => ids.has(e.source) && ids.has(e.target)), truncated: sandbox.nodes.length > 180 };
  }, [sandbox, editable, view, focus, depth, liveGraph]);
  useEffect(() => {
    const key = `${mode}|${view}|${focus}`, resetView = viewKey.current !== key;
    const directionChanged = layoutDirection.current !== direction; layoutDirection.current = direction;
    viewKey.current = key;
    const stored = readPreference(storage(), positionsKey, {});
    setGraph(previous => {
      const retained = resetView || directionChanged ? new Map() : new Map(previous.nodes.map(n => [n.id,n]));
      const saved = stored && typeof stored === 'object' ? stored : {};
      return view === 'areas' ? areaLayout(rawGraph,direction,retained,saved) : layout(rawGraph,direction,retained,saved,focus);
    });
    if (resetView || directionChanged) fitPending.current = true;
    if (rawGraph.nodes.length && fitPending.current) {
      fitPending.current = false;
      clearTimeout(fitTimer.current); fitTimer.current = setTimeout(() => flow.fitView({ padding: 0.22, duration: 150 }), 50);
    }
  }, [rawGraph, mode, view, focus, direction, layoutRevision]);
  useEffect(() => () => clearTimeout(fitTimer.current), []);
  const searchable = editable ? sandbox.nodes : snapshot?.entities || [];
  const availableDomains = useMemo(() => [...new Set(searchable.map(domainOf))].sort(), [searchable]);
  const searchMatches = useMemo(() => filterNodes(searchable, query, domains), [searchable, query, domains]);
  const matches = useMemo(() => hideDiagnostic ? searchMatches.filter(n => !isDiagnostic(n)) : searchMatches, [searchMatches, hideDiagnostic]);
  const hiddenDiagnosticCount = searchMatches.length - matches.length;
  const visibleGraph = useMemo(() => filterDiagnosticGraph(graph, hideDiagnostic), [graph, hideDiagnostic]);
  const visibleConnections = useMemo(() => filterDiagnosticGraph(editable ? sandbox : rawGraph, hideDiagnostic).edges, [editable, sandbox, rawGraph, hideDiagnostic]);
  const selection = useMemo(() => diagnosticSelection(rawGraph, hideDiagnostic, inspectedId, selectedEdge), [rawGraph, hideDiagnostic, inspectedId, selectedEdge]);
  useEffect(() => {
    if (selection.nodeId !== inspectedId) setInspectedId(selection.nodeId);
    if (selection.edgeId !== selectedEdge) setSelectedEdge(selection.edgeId);
  }, [selection, inspectedId, selectedEdge]);
  function changeDiagnostic(next) {
    setHideDiagnostic(next); setNotice(writePreference(storage(), DIAGNOSTIC_FILTER_KEY, next));
  }
  function changeDomains(next) { setDomains(next); setNotice(writePreference(storage(), 'entangle.filters.v1', next)); }
  function persistPosition(node) {
    const saved = readPreference(storage(), positionsKey, {});
    const next = { ...(saved && typeof saved === 'object' ? saved : {}), [node.id]: { ...node.position, ...(node.parentId ? {parentId:node.parentId} : {}) } };
    setNotice(writePreference(storage(), positionsKey, next));
    if (editable && view === 'relationships') commit({ ...sandbox, nodes: sandbox.nodes.map(n => n.id === node.id ? { ...n, position: node.position } : n) });
  }
  const inspected = (editable ? sandbox.nodes : liveGraph.nodes).find(n => n.id === selection.nodeId && (!hideDiagnostic || !isDiagnostic(n)));
  const inspectedEdge = visibleConnections.find(e => e.id === selection.edgeId);
  const choose = id => { setFocus(id); setDepth(1); setInspectedId(id); setSelectedEdge(''); setCreating(false); setActionError(''); };
  function switchMode(next) {
    setMode(next); setFocus(''); setDepth(1); setQuery(''); setInspectedId(''); setSelectedEdge(''); setCreating(false); setConnection(null); setActionError('');
  }
  function commit(next) { setSandbox(next); setNotice(saveSandbox(storage(), next)); setActionError(''); }
  function replace(next) {
    for (const key of [positionKey('sandbox'),viewPositionKey('sandbox','areas','LR'),viewPositionKey('sandbox','areas','TB')]) setNotice(writePreference(storage(),key,{}));
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
    const saved = readPreference(storage(), positionsKey, {}), nextSaved = { ...saved };
    rawGraph.nodes.forEach(n => delete nextSaved[n.id]);
    setNotice(writePreference(storage(), positionsKey, nextSaved));
    const clean = { ...rawGraph, nodes: rawGraph.nodes.map(({ position, ...n }) => n) };
    const next = view === 'areas' ? areaLayout(clean,direction) : layout(clean,direction);
    if (editable && view === 'relationships') {
      const ids = new Set(rawGraph.nodes.map(n => n.id));
      commit({ ...sandbox, nodes: sandbox.nodes.map(n => { if (!ids.has(n.id)) return n; const { position, ...rest } = n; return rest; }) });
    }
    setGraph(next); viewKey.current = ''; setLayoutRevision(v => v + 1);
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
  const connected = new Set(selection.nodeId ? [selection.nodeId] : []);
  if (selection.nodeId) visibleConnections.forEach(e => { if (e.source === selection.nodeId || e.target === selection.nodeId) { connected.add(e.source); connected.add(e.target); } });
  for (const node of visibleGraph.nodes) if (node.parentId === selection.nodeId) connected.add(node.id);
  const selectedRelationship = visibleGraph.edges.find(e => e.id === selection.edgeId);
  if (selectedRelationship) { connected.add(selectedRelationship.source); connected.add(selectedRelationship.target); }
  const renderedNodes = visibleGraph.nodes.map(n => ({ ...n, selected: n.id === selection.nodeId || (!selection.nodeId && n.id === focus), data: n.type === 'area' ? {...n.data, memberCount:visibleGraph.nodes.filter(child=>child.parentId===n.id).length} : n.data, style: { ...n.style, opacity: n.type === 'area' ? 1 : connected.size && !connected.has(n.id) ? .5 : 1 } }));
  const renderedEdges = visibleGraph.edges.map(e => {
    const highlighted = e.id === selection.edgeId || (selection.nodeId && (e.source === selection.nodeId || e.target === selection.nodeId));
    return { ...e, selected: e.id === selection.edgeId, style: { ...e.style, opacity: connected.size && !highlighted ? .3 : 1, strokeWidth: highlighted ? 2.5 : 1.5 } };
  });
  return <div className="app" style={themeStyle(theme)}>
    <header><div className="brand"><span>⋈</span> Entangle <small>ENTITY EXPLORER</small></div><div className="header-actions"><button onClick={()=>setSettingsOpen(true)}>Settings</button>
      <div className="mode-selector" role="group" aria-label="Mode">{['live', 'sandbox'].map(m => <button key={m} className={mode === m ? 'active' : ''} aria-pressed={mode === m} onClick={() => switchMode(m)}>{m === 'live' ? 'Live' : 'Sandbox'}</button>)}</div>
      <span className={`status ${editable ? 'sandbox-status' : snapshot?.connected ? 'online' : ''}`}>{editable ? 'Sandbox · virtual data' : busy ? 'Connecting…' : snapshot?.connected ? 'Connected · snapshot' : 'Disconnected'}</span>
      {editable ? <button onClick={createNode}>+ Add Node</button> : <button onClick={() => refresh()} disabled={busy}>{busy ? 'Refreshing…' : '↻ Refresh'}</button>}
    </div></header>
    <main hidden={settingsOpen}>
      <aside className="sidebar"><div className="sidebar-top"><h2>{editable ? 'Sandbox nodes' : 'Entities and areas'} <span>{searchable.length}</span></h2><input aria-label="Search nodes" placeholder="Search name or ID…" value={query} onChange={e => setQuery(e.target.value)}/><details className="domain-filter"><summary>Domains {domains.length ? `(${domains.length})` : '(all)'}</summary><div>{availableDomains.map(domain => <label key={domain}><input type="checkbox" checked={domains.includes(domain)} onChange={e => changeDomains(e.target.checked ? [...domains, domain] : domains.filter(d => d !== domain))}/><NodeIcon node={{ kind: 'entity', entityId: `${domain}.filter` }}/>{domain.replaceAll('_', ' ')}</label>)}{domains.filter(d => !availableDomains.includes(d)).map(d => <label key={d}><input type="checkbox" checked onChange={() => changeDomains(domains.filter(v => v !== d))}/>{d} (unavailable)</label>)}</div></details><label className="diagnostic-toggle"><input type="checkbox" checked={hideDiagnostic} onChange={e => changeDiagnostic(e.target.checked)}/>Hide diagnostic entities</label>{(domains.length > 0 || query) && <button className="clear-filters" onClick={() => { changeDomains([]); setQuery(''); }}>Clear Filters</button>}<small>{matches.length} results{hiddenDiagnosticCount > 0 && ` / ${hiddenDiagnosticCount} diagnostic hidden`}{matches.length > 150 ? ' · showing first 150' : ''}</small></div>
        <div className="entity-list">{matches.slice(0, 150).map(n => <button className={`entity-row ${focus === n.id ? 'active' : ''}`} key={n.id} onClick={() => choose(n.id)}><span className="symbol"><NodeIcon node={n}/></span><div><strong>{n.label}</strong><small>{n.entityId || n.id}</small></div></button>)}{!busy && !matches.length && <p className="muted padding">{query || domains.length || hiddenDiagnosticCount ? 'No matching nodes.' : editable ? 'Your sandbox is empty. Add a node to begin.' : 'Connect to Home Assistant to load entities.'}</p>}</div>
        <footer>{editable ? 'Virtual data · saved in this browser' : 'Read only · refreshed on demand'}{!editable && snapshot?.refreshedAt && <small>Updated {new Date(snapshot.refreshedAt).toLocaleTimeString()}</small>}</footer>
      </aside>
      <section className="canvas">
        <div className="graph-toolbar"><div><strong>{focus ? searchable.find(n => n.id === focus)?.label || focus : editable ? 'Sandbox workspace' : 'Explore your home'}</strong><small>{editable || focus || view === 'areas' ? `${visibleGraph.nodes.length} nodes · ${visibleGraph.edges.length} relationships` : 'Verified relationships, one entity at a time'}</small></div>
          {(editable || snapshot?.connected) && <div className="toolbar-buttons">
            {focus && <><button onClick={() => setDepth(depth === 1 ? 2 : 1)}>{depth === 1 ? 'Expand one level' : 'Immediate only'}</button><button onClick={() => { setDepth(1); setInspectedId(focus); setSelectedEdge(''); flow.fitView({ padding: 0.22 }); }}>Reset focus</button></>}
            {focus && <button onClick={() => { setFocus(''); setDepth(1); }}>Show all</button>}
            <select aria-label="View type" value={view} onChange={e => {setView(e.target.value);setSelectedEdge('');setNotice(writePreference(storage(),VIEW_KEY,e.target.value));}}>{views.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select>
            <select aria-label="Layout direction" value={direction} onChange={e => { setDirection(e.target.value); writePreference(storage(), 'entangle.direction.v1', e.target.value); }}><option value="LR">Left to right</option><option value="TB">Top to bottom</option></select><button onClick={autoLayout}>Reset Layout</button><button onClick={() => flow.fitView({ padding: 0.22 })}>Fit view</button>
            {editable && <details className="sandbox-menu"><summary>Sandbox tools</summary><div><button onClick={() => replace(starterSandbox())}>Reset Sandbox</button><button onClick={() => replace(emptySandbox())}>Clear / start empty</button><button onClick={() => fileInput.current?.click()}>Import JSON</button><button onClick={exportFile}>Export JSON</button></div></details>}
          </div>}
        </div>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importFile}/>
        {error && <div role="alert" className="error">{error}</div>}{notice && <div className="storage-notice" role="status">{notice}</div>}
        <div className="flow-container">{editable || ((focus || view === 'areas') && snapshot?.connected) ? <>
          <ReactFlow nodes={renderedNodes} edges={renderedEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            onNodeClick={(_, n) => { setInspectedId(n.id); setSelectedEdge(''); setCreating(false); }} onEdgeClick={(_, e) => { setSelectedEdge(e.id); setInspectedId(''); setCreating(false); }} onPaneClick={() => { setInspectedId(''); setSelectedEdge(''); setCreating(false); }}
            onNodesChange={changes => setGraph(g => ({ ...g, nodes: applyNodeChanges(changes.filter(c => c.type === 'position' || c.type === 'dimensions'), g.nodes) }))}
            onNodeDragStop={(_, node) => persistPosition(node)}
            onConnect={connect} nodesConnectable={editable} nodesDraggable={true} edgesReconnectable={false} deleteKeyCode={null} colorMode="dark" minZoom={0.1} maxZoom={1.8} fitView>
            <Background color="var(--color-292e38, #292e38)" gap={24}/><Controls showInteractive={false}/>
          </ReactFlow>
          {editable && !sandbox.nodes.length && <div className="empty sandbox-empty"><span>⋈</span><h1>Build your sandbox</h1><p>Add a node or restore the starter graph from Sandbox tools.</p><button onClick={createNode}>+ Add Node</button></div>}
        </> : <div className="empty"><span>⋈</span><h1>{busy ? 'Connecting to Home Assistant' : 'Start with an entity'}</h1><p>{busy ? 'Loading states and registries…' : 'Search and select an entity to explore its connections.'}</p></div>}{graphBusy && <div className="loading" role="status">Loading relationships…</div>}</div>
        <div className="coverage">{graph.truncated && <p>View limited to 180 nodes. Search for an area or entity to explore further.</p>}
          {view === 'areas' && <p>Areas contain their assigned devices and entities. Drag an area by its heading to move its members together. Unassigned nodes remain outside. Area membership is shown by containment; other relationships remain visible.</p>}
          {editable ? <span>Sandbox · virtual data only. Drag from a right handle to a left handle to connect. Select a node or edge to edit. No automations execute.</span> : <details><summary>Coverage · graph is not exhaustive{snapshot ? ` · ${snapshot.analyzed} YAML configurations analyzed` : ''}</summary>{snapshot?.warnings.map((w, i) => <p key={i}>{w}</p>)}<p>Ownership and area assignments come from registries. Edges describe references, not guaranteed runtime execution. State is current as of the last refresh.</p></details>}
        </div>
      </section>
      {(creating || inspected || inspectedEdge) && <aside className="inspector">
        <div className="inspector-top"><h2>{creating ? 'Add Node' : inspectedEdge ? 'Relationship' : 'Inspector'}</h2><button aria-label="Close inspector" onClick={() => { setInspectedId(''); setSelectedEdge(''); setCreating(false); }}>×</button></div>
        {creating && editable && <NodeEditor key="new" creating node={{ id: `node-${newNumber}`, kind: 'entity', label: 'New entity', entityId: `sensor.new_entity_${newNumber}`, state: 'unknown' }} onSave={saveNode} onCancel={() => setCreating(false)}/>}
        {inspected && <><span className="kind-tag" style={{ color: appearance(inspected).color }}><NodeIcon node={inspected}/> {appearance(inspected).label}</span><h2 className="inspector-name">{inspected.label}</h2><code>{inspected.entityId || inspected.id}</code>
          {editable ? <><NodeEditor key={inspected.id} node={inspected} onSave={saveNode}/><button className="danger" onClick={() => removeNode(inspected.id)}>Delete node and connections</button></> : <dl>{[['State', inspected.state === null ? 'No current state' : inspected.state], ['Type', appearance(inspected).label], ['Device class', inspected.deviceClass], ['Entity category', inspected.entity_category], ['Unit', inspected.unit], ['Last changed', inspected.lastChanged && new Date(inspected.lastChanged).toLocaleString()], ['Device', inspected.deviceId], ['Area', inspected.areaId], ['Manufacturer', inspected.manufacturer], ['Model', inspected.model], ['Registry', inspected.disabled ? 'Disabled' : null]].filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>}
          {inspected.id !== focus && <button className="focus-button" onClick={() => choose(inspected.id)}>Focus this {editable ? 'node' : 'entity'}</button>}
          <h3>{editable ? 'Connections' : 'Visible connections'}</h3><div className="connections">{visibleConnections.filter(e => e.source === inspected.id || e.target === inspected.id).map(e => <div key={e.id}><small>{e.relationship} {e.source === inspected.id ? '→' : '←'}</small><code>{e.source === inspected.id ? e.target : e.source}</code>{editable && <button aria-label={`Remove ${e.relationship} relationship`} onClick={() => removeEdge(e.id)}>Remove</button>}</div>)}</div>
        </>}
        {inspectedEdge && <><h2 className="inspector-name">{inspectedEdge.relationship}</h2><dl><dt>Source</dt><dd>{inspectedEdge.source}</dd><dt>Target</dt><dd>{inspectedEdge.target}</dd></dl>{editable && <button className="danger" onClick={() => removeEdge(inspectedEdge.id)}>Delete relationship</button>}</>}
      </aside>}
    </main>
    {settingsOpen && <AppearanceSettings theme={theme} onChange={changeTheme} notice={themeNotice} onClose={()=>setSettingsOpen(false)}/>}
    {editable && connection && <div className="dialog-backdrop"><form className="connection-dialog" role="dialog" aria-modal="true" aria-labelledby="relationship-title" onSubmit={e => { e.preventDefault(); try { commit(addRelationship(sandbox, connection.source, connection.target, connection.relationship)); setConnection(null); } catch (err) { setActionError(err.message); setConnection(null); } }}>
      <h2 id="relationship-title">Choose relationship</h2><p><code>{connection.source} → {connection.target}</code></p><label className="edit-field">Relationship type<select autoFocus value={connection.relationship} onChange={e => setConnection({ ...connection, relationship: e.target.value })}>{connection.options.map(o => <option key={o}>{o}</option>)}</select></label><div className="form-actions"><button type="submit">Add relationship</button><button type="button" onClick={() => setConnection(null)}>Cancel</button></div>
    </form></div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<ReactFlowProvider><App/></ReactFlowProvider>);
