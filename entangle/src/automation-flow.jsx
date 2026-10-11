import React, { useState } from 'react';
import { Zap, Play, GitBranch, Clock, Filter, Repeat, Square, ArrowDown, Layers, ChevronDown, ChevronRight } from 'lucide-react';
import { NodeIcon } from './appearance.jsx';
import { flowReferences } from '../server/automation-flow.js';
import { referenceContext, hiddenReference, referenceGroups } from './automation-ui.js';
import './automation-flow.css';
const icons = { trigger: Zap, condition: Filter, if: GitBranch, choose: GitBranch, parallel: Layers, repeat: Repeat, delay: Clock, wait: Clock, stop: Square };

function References({ ids = [], context }) {
  const visible = ids.filter(id => !hiddenReference(context.graph, id, context.hideDiagnostic, context.hiddenTypes));
  const hidden = ids.length - visible.length;
  return <div className="flow-references">{visible.map(id => {
    const { node, device, area } = referenceContext(context.graph, id);
    return node ? <button key={id} className="flow-reference" onClick={() => context.onExplore(id)} title={`Explore ${node.entityId || node.id}`}>
      <NodeIcon node={node} size={16}/><span><strong>{node.label}</strong>{(area || device) && <small>{[area?.label, device?.label].filter(Boolean).join(' / ')}</small>}</span>
    </button> : <span key={id} className="flow-reference unresolved"><span>{id}<small>Unavailable in this view</small></span></span>;
  })}{hidden > 0 && <small className="flow-hidden-count">{hidden} {hidden === 1 ? 'reference' : 'references'} hidden by visibility filters</small>}</div>;
}
function Conditions({ steps = [], context }) {
  return <div className="flow-conditions">{steps.map(step => <Step key={step.id} step={step} context={context}/>)}</div>;
}
function Sequence({ steps = [], context, empty = 'No steps in this branch; continue' }) {
  let stopped = false;
  return <ol className="flow-sequence">{steps.length ? steps.map((step, index) => {
    const unreachable = stopped;
    if (step.kind === 'stop' && !step.disabled && !step.dynamicEnabled) stopped = true;
    return <li key={step.id} className={`${index ? 'has-predecessor' : ''} ${unreachable ? 'flow-unreachable' : ''}`}>
      {index > 0 && !unreachable && <div className="flow-connector" aria-hidden="true"><ArrowDown size={18}/></div>}
      {unreachable && <small>Not reached after the stop above</small>}
      <Step step={step} index={index + 1} context={context}/>
    </li>;
  }) : <li className="flow-empty">{context.graph.flow?.truncated ? 'Steps may be omitted by the flow limit.' : empty}</li>}</ol>;
}
function ScriptCall({ step, context }) {
  const [open, setOpen] = useState(false), [result, setResult] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const recursive = context.ancestry.includes(step.scriptId), capped = context.ancestry.length >= 4;
  async function toggle() {
    setOpen(!open);
    if (open || result || recursive || capped || !context.loadFlow) return;
    setBusy(true); setError('');
    try { setResult(await context.loadFlow(step.scriptId)); } catch { setError('The script configuration could not be loaded.'); } finally { setBusy(false); }
  }
  return <div className="flow-script-call">
    <button className="flow-expand" aria-expanded={open} onClick={toggle}>{open ? <ChevronDown size={16}/> : <ChevronRight size={16}/>} {open ? 'Collapse script' : 'Expand script sequence'}</button>
    {open && <div className="flow-script-content">{recursive ? <p>Recursive script call. Expansion stops here.</p> : capped ? <p>Further nested calls are available by opening the script itself.</p> : busy ? <p role="status">Loading script sequence...</p> : error ? <p role="alert">{error}</p> : result?.flow ? <>
      {result.flow.warnings.map(message => <p className="flow-notice" key={message}>{message}</p>)}
      <Sequence steps={result.flow.steps} context={{ ...context, graph: result, ancestry: [...context.ancestry, step.scriptId] }}/>
    </> : <p>Script configuration is unavailable. Its execution order is not inferred.</p>}</div>}
  </div>;
}
function Step({ step, index, context }) {
  const Icon = icons[step.kind] || Play;
  return <article className={`flow-step flow-${step.kind} ${step.disabled ? 'flow-disabled' : ''}`}>
    <div className="flow-step-heading">{index && <span className="flow-step-number">{index}</span>}<Icon size={18}/><strong>{step.label}</strong>{step.disabled && <span className="flow-badge">Disabled / skipped</span>}{step.opaque && <span className="flow-badge">Dynamic / limited detail</span>}</div>
    {step.detail && <p className="flow-step-detail">{step.detail}</p>}
    {step.service && <code className="flow-service">{step.service}</code>}
    {step.gate && <p className="flow-outcome">Continue only if true; otherwise this sequence stops.</p>}
    {step.continueOnError && <p className="flow-outcome">Configured to continue on supported action errors.</p>}
    {step.dynamicEnabled && <p className="flow-outcome">Whether this step is enabled is evaluated by Home Assistant.</p>}
    {step.referencesTruncated && <p className="flow-outcome">Additional targets are omitted by the reference limit.</p>}
    {step.dynamicTargets && <p className="flow-outcome">Dynamic targets are resolved by Home Assistant.</p>}
    <References ids={step.references} context={context}/>
    {step.kind === 'repeat' && step.repeatType === 'until' ? <>
      <Sequence steps={step.steps} context={context}/><p className="flow-branch-rule">Check after each iteration</p><Conditions steps={step.conditions} context={context}/>
    </> : <>
      {!!step.conditions?.length && <><p className="flow-branch-rule">{step.kind === 'condition' ? step.conditionType === 'or' ? 'Any may match' : step.conditionType === 'not' ? 'None may match' : 'All must match' : 'All enabled conditions must match'}</p><Conditions steps={step.conditions} context={context}/></>}
      {step.steps && <Sequence steps={step.steps} context={context}/>}
    </>}
    {step.triggers && <div className="flow-alternatives">{step.triggers.map(trigger => <Step key={trigger.id} step={trigger} context={context}/>)}</div>}
    {step.timeout && <p className="flow-outcome">Timeout: {step.timeout}. {step.continueOnTimeout ? 'Continue on timeout.' : 'Stop the run on timeout.'}</p>}
    {step.branches && <>
      <div className={`flow-branches ${step.kind === 'parallel' ? 'is-parallel' : ''}`}>{step.branches.map((branch, i) => <section className="flow-branch" key={i}>
        <h4>{branch.label}</h4>{branch.conditions && <Conditions steps={branch.conditions} context={context}/>}
        <Sequence steps={branch.steps} context={context}/>
      </section>)}</div>
      <p className="flow-outcome">{step.kind === 'parallel' ? 'Branches run together; continuation follows when all finish successfully.' : 'Only the selected branch runs, then the sequence continues unless stopped.'}</p>
    </>}
    {step.scriptId && <ScriptCall step={step} context={context}/>}
  </article>;
}
export function AutomationFlow({ graph, focus, onExplore, loadFlow, hideDiagnostic, hiddenTypes, loading }) {
  const root = graph.flowFocus && graph.flowFocus !== focus ? null : graph.nodes.find(n => n.id === focus), flow = graph.flow;
  const context = { graph, onExplore, loadFlow, hideDiagnostic, hiddenTypes, ancestry: [focus] };
  if (loading) return <div className="automation-flow flow-picker" role="status"><Zap size={32}/><h2>Loading configured flow...</h2></div>;
  if (!root || !['automation','script'].includes(root.kind)) return <div className="automation-flow flow-picker"><Zap size={32}/><h2>Follow an automation or script</h2><p>Choose an automation or script from the sidebar to see its configured steps.</p></div>;
  const references = flow ? [...flowReferences(flow)] : referenceGroups(graph, focus).flatMap(g => g.references);
  const areas = [...new Map(references.map(id => referenceContext(graph, id).area).filter(Boolean).map(n => [n.id,n])).values()];
  return <div className="automation-flow"><div className="automation-flow-layout"><div className="automation-flow-main">
    <header className="flow-start"><NodeIcon node={root} size={28}/><div><small>{root.kind === 'script' ? 'SCRIPT' : 'AUTOMATION'} / START</small><h1>{root.label}</h1><p>{flow ? 'Configured flow / not a live execution trace' : 'References only / execution order unavailable'}</p></div>{flow && <span className="flow-badge">Run mode: {flow.mode}</span>}</header>
    {flow ? <>
      {graph.truncated && !flow.truncated && <p className="flow-notice">Home context is limited to 180 objects; some references are unavailable in this view.</p>}
      {flow.warnings.map(message => <p key={message} className="flow-notice" role="status">{message}</p>)}
      {root.kind === 'automation' && <>
        <div className="flow-connector" aria-hidden="true"><ArrowDown size={20}/></div>
        <section className="flow-stage"><h2><span className="flow-stage-dot trigger-dot"/>WHEN <small>Any enabled trigger can start a run</small></h2>
          <div className="flow-alternatives">{flow.triggers.length ? flow.triggers.map(step => <Step key={step.id} step={step} context={context}/>) : <p className="flow-empty">{flow.truncated ? 'Triggers may be omitted by the flow limit.' : 'No configured triggers; this automation can be started manually.'}</p>}</div>
        </section>
        {!!flow.conditions.length && <><div className="flow-connector" aria-hidden="true"><ArrowDown size={20}/></div><section className="flow-stage"><h2><span className="flow-stage-dot condition-dot"/>AND IF <small>All enabled conditions must match; otherwise the run stops</small></h2><Conditions steps={flow.conditions} context={context}/></section></>}
      </>}
      <div className="flow-connector" aria-hidden="true"><ArrowDown size={20}/></div>
      <section className="flow-stage"><h2><span className="flow-stage-dot action-dot"/>{root.kind === 'script' ? 'SEQUENCE' : 'THEN DO'} <small>Configured order / branches and parallel steps retain their structure</small></h2>
        <Sequence steps={flow.steps} context={context} empty={flow.truncated ? 'Further actions may be omitted by the flow limit.' : 'No actions configured'}/>
      </section>
    </> : <section className="flow-stage flow-fallback"><h2>Verified references</h2><p className="flow-notice">{loadFlow ? 'The YAML configuration could not be uniquely mapped or is unavailable. Blueprints and dynamic configuration are not expanded.' : 'Sandbox relationships describe references; they do not contain an ordered automation configuration.'} These groups do not imply a sequence.</p>
      {referenceGroups(graph, focus).map(group => <section key={group.label}><h3>{group.label}</h3><References ids={group.references} context={context}/></section>)}
      {!references.length && <p className="flow-empty">No verified references are available.</p>}
    </section>}
  </div><aside className="flow-context"><h2>Home context</h2><p>Areas and targets referenced by this flow. States in the Inspector come from the last snapshot.</p>
    {!!areas.length && <section><h3>Areas</h3><References ids={areas.map(n => n.id)} context={context}/></section>}
    <section><h3>Referenced objects</h3><References ids={[...new Set(references)]} context={context}/></section>
  </aside></div></div>;
}
