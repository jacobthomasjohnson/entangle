// A bounded presentation model, never a copy of YAML or arbitrary action data.
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const dynamic = value => typeof value === 'string' && /[{}%]/.test(value);
const scalar = value => Array.isArray(value) ? value.slice(0, 8).map(v => ['string','number','boolean'].includes(typeof v) ? dynamic(v) ? 'Dynamic value' : String(v).slice(0,100) : 'Dynamic value').join(' or ') : ['string', 'number', 'boolean'].includes(typeof value) ? dynamic(value) ? 'Dynamic value' : String(value).slice(0, 100) : '';
const literalIds = value => list(value).flatMap(v => typeof v === 'string' && !dynamic(v) ? v.split(',').map(s => s.trim()) : []);
const named = (value, fallback) => typeof value === 'string' && !dynamic(value) ? value.slice(0, 160) : fallback;
const conditionNames = { state: 'Check state', numeric_state: 'Check numeric state', template: 'Evaluate template condition', time: 'Check time', sun: 'Check sun position', zone: 'Check zone', device: 'Check device', trigger: 'Check trigger ID', and: 'All conditions must match', or: 'Any condition may match', not: 'None of these conditions may match' };
const triggerNames = { state: 'State changes', numeric_state: 'Numeric threshold crossed', event: 'Event received', time: 'At a scheduled time', time_pattern: 'Time pattern matches', sun: 'Sun event', zone: 'Zone entered or left', device: 'Device trigger', template: 'Template becomes true', mqtt: 'MQTT message received', webhook: 'Webhook received', homeassistant: 'Home Assistant starts or stops', calendar: 'Calendar event', geo_location: 'Geolocation trigger', tag: 'Tag scanned', conversation: 'Conversation trigger', persistent_notification: 'Notification changes' };
export function normalizeFlow(config, kind = 'automation', { maxSteps = 160, maxDepth = 12 } = {}) {
  let count = 0, truncated = false;
  const warnings = new Set();
  function base(value, type, label, depth) {
    if (count >= maxSteps || depth > maxDepth) { truncated = true; return null; }
    const step = { id: `step-${++count}`, kind: type, label: named(value?.alias, label), references: [], disabled: value?.enabled === false };
    if (dynamic(value?.enabled)) step.dynamicEnabled = true;
    if (value?.continue_on_error === true) step.continueOnError = true;
    return step;
  }
  function references(value, step, includeService = false) {
    if (!object(value) || value.condition === 'template' || value.trigger === 'template' || value.platform === 'template') return;
    for (const target of [value, object(value.target) ? value.target : {}]) {
      for (const [key, prefix, pattern] of [['entity_id', '', /^[a-z_]+\.[a-z0-9_]+$/], ['device_id', 'device:', /^[a-zA-Z0-9_-]+$/], ['area_id', 'area:', /^[a-zA-Z0-9_-]+$/]]) {
        if (dynamic(target[key]) || list(target[key]).some(dynamic)) step.dynamicTargets = true;
        for (const id of literalIds(target[key])) if (pattern.test(id)) step.references.push(prefix + id);
      }
    }
    if (dynamic(value.target)) step.dynamicTargets = true;
    if (typeof value.scene === 'string' && /^scene\.[a-z0-9_]+$/.test(value.scene)) step.references.push(value.scene);
    const service = value.action || value.service;
    if (includeService && typeof service === 'string' && /^script\.[a-z0-9_]+$/.test(service) && !['script.turn_on','script.turn_off','script.toggle','script.reload'].includes(service)) {
      step.scriptId = service; step.references.push(service);
    }
    const unique = [...new Set(step.references)];
    if (unique.length > 32) { step.referencesTruncated = true; warnings.add('Some step targets are limited to 32 references.'); }
    step.references = unique.slice(0, 32);
  }
  function duration(value) {
    if (object(value)) {
      const parts = ['hours','minutes','seconds','milliseconds'].filter(k => typeof value[k] === 'number' && Number.isFinite(value[k])).map(k => `${value[k]} ${k}`);
      return parts.length ? parts.join(', ') : 'Dynamic duration';
    }
    return typeof value === 'number' ? `${value} seconds` : typeof value === 'string' && /^\d+(?::\d+){1,2}(?:\.\d+)?$/.test(value) ? value : 'Dynamic duration';
  }
  function condition(value, depth = 0) {
    const type = object(value) ? value.condition : typeof value === 'string' ? 'template' : null;
    const step = base(value, 'condition', conditionNames[type] || 'Condition', depth);
    if (!step) return null;
    if (!type || !conditionNames[type]) { step.opaque = true; warnings.add('Some conditions are represented without evaluating their logic.'); }
    step.conditionType = typeof type === 'string' && conditionNames[type] ? type : 'unknown';
    if (['and','or','not'].includes(type)) step.conditions = list(value.conditions).map(v => condition(v, depth + 1)).filter(Boolean);
    if (type === 'template') { step.opaque = true; step.detail = 'Evaluated by Home Assistant; template contents are omitted.'; }
    else if (type === 'state') step.detail = `State is ${scalar(value.state) || 'configured value'}`;
    else if (type === 'numeric_state') step.detail = [value.above != null && `Above ${scalar(value.above)}`, value.below != null && `Below ${scalar(value.below)}`].filter(Boolean).join(' · ');
    if (value?.for != null) step.detail = `${step.detail || ''}${step.detail ? ' · ' : ''}For ${duration(value.for)}`;
    references(value, step);
    return step;
  }
  function trigger(value, depth = 0) {
    const type = object(value) ? value.trigger || value.platform : null;
    const step = base(value, 'trigger', triggerNames[type] || 'Trigger', depth);
    if (!step) return null;
    if (!triggerNames[type]) { step.opaque = true; warnings.add('Some triggers have details that are unavailable in this view.'); }
    step.triggerType = triggerNames[type] ? type : 'unknown';
    if (type === 'state') step.detail = `${value.from == null ? 'Any state' : scalar(value.from)} → ${value.to == null ? 'Any changed state' : scalar(value.to)}`;
    if (type === 'numeric_state') step.detail = [value.above != null && `Above ${scalar(value.above)}`, value.below != null && `Below ${scalar(value.below)}`].filter(Boolean).join(' · ');
    if (type === 'event') step.detail = `Event: ${scalar(value.event_type) || 'configured event'}`;
    if (type === 'time') step.detail = `At ${scalar(value.at) || 'configured time'}`;
    if (value?.for != null) step.detail = `${step.detail || ''}${step.detail ? ' · ' : ''}For ${duration(value.for)}`;
    if (type === 'template') { step.opaque = true; step.detail = 'Dynamic trigger; template contents are omitted.'; }
    references(value, step);
    return step;
  }
  function sequence(value, depth = 0) {
    const steps = [];
    for (const entry of list(value)) {
      if (count >= maxSteps || depth > maxDepth) { truncated = true; break; }
      const step = action(entry, depth);
      if (step) steps.push(step);
    }
    return steps;
  }
  function action(value, depth) {
    let type = 'action', label = 'Action';
    if (!object(value)) { type = 'unknown'; label = 'Unrecognized step'; }
    else if ('if' in value) { type = 'if'; label = 'If / else'; }
    else if ('choose' in value) { type = 'choose'; label = 'Choose the first matching branch'; }
    else if ('parallel' in value) { type = 'parallel'; label = 'Run branches in parallel'; }
    else if ('repeat' in value) { type = 'repeat'; label = 'Repeat'; }
    else if ('sequence' in value) { type = 'sequence'; label = 'Run a sequence'; }
    else if ('condition' in value) return { ...condition(value, depth), gate: true };
    else if ('delay' in value) { type = 'delay'; label = 'Delay'; }
    else if ('wait_for_trigger' in value || 'wait_template' in value) { type = 'wait'; label = 'Wait'; }
    else if ('stop' in value) { type = 'stop'; label = value.error === true ? 'Stop with an error' : 'Stop this run'; }
    else if ('variables' in value) { type = 'variables'; label = 'Set variables'; }
    else if ('event' in value) { type = 'event'; label = 'Fire an event'; }
    else if ('scene' in value) { label = 'Activate scene'; }
    else if ('set_conversation_response' in value) { type = 'response'; label = 'Set conversation response'; }
    else if (!value.action && !value.service) { type = 'unknown'; label = 'Unrecognized step'; }
    const step = base(value, type, label, depth);
    if (!step) return null;
    references(value, step, true);
    if (type === 'if') {
      step.conditions = list(value.if).map(v => condition(v, depth + 1)).filter(Boolean);
      step.branches = [{ label: 'Yes: conditions match', steps: sequence(value.then, depth + 1) }, { label: 'No: conditions do not match', steps: sequence(value.else, depth + 1) }];
    } else if (type === 'choose') {
      step.branches = [];
      for (const branch of list(value.choose)) {
        if (count >= maxSteps) { truncated = true; break; }
        if (!object(branch)) { warnings.add('An unrecognized choice branch is omitted.'); truncated = true; continue; }
        count++;
        step.branches.push({ label: named(branch.alias, `Option ${step.branches.length + 1}`), conditions: list(branch.conditions).map(v => condition(v, depth + 1)).filter(Boolean), steps: sequence(branch.sequence, depth + 1) });
      }
      step.branches.push({ label: 'Otherwise: no option matches', steps: sequence(value.default, depth + 1) });
    } else if (type === 'parallel') {
      step.branches = [];
      for (const branch of list(value.parallel)) {
        if (count >= maxSteps) { truncated = true; break; }
        count++;
        step.branches.push({ label: `Branch ${step.branches.length + 1}`, steps: sequence(branch, depth + 1) });
      }
    } else if (type === 'repeat') {
      const repeat = object(value.repeat) ? value.repeat : {};
      step.repeatType = 'for_each' in repeat ? 'for_each' : 'while' in repeat ? 'while' : 'until' in repeat ? 'until' : 'count';
      step.detail = step.repeatType === 'count' ? `Repeat ${typeof repeat.count === 'number' ? repeat.count : 'a dynamic number of'} times` : step.repeatType === 'for_each' ? 'Repeat for each item' : step.repeatType === 'while' ? 'Check before each iteration; repeat while conditions match' : 'Run the sequence, then check; repeat until conditions match';
      step.conditions = list(repeat.while || repeat.until).map(v => condition(v, depth + 1)).filter(Boolean);
      step.steps = sequence(repeat.sequence, depth + 1);
    } else if (type === 'sequence') step.steps = sequence(value.sequence, depth + 1);
    else if (type === 'delay') step.detail = duration(value.delay);
    else if (type === 'wait') {
      step.detail = 'wait_template' in value ? 'Wait until a template is true; contents omitted' : 'Wait until any of these triggers fires';
      if ('wait_for_trigger' in value) step.triggers = list(value.wait_for_trigger).map(v => trigger(v, depth + 1)).filter(Boolean);
      if (value.timeout != null) { step.timeout = duration(value.timeout); step.continueOnTimeout = value.continue_on_timeout !== false; }
    } else if (type === 'action') {
      const service = value.action || value.service;
      if (typeof service === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(service)) {
        step.service = service;
        const verb = service.split('.')[1].replaceAll('_', ' ');
        step.label = named(value.alias, step.scriptId ? 'Call script' : service.startsWith('notify.') ? 'Send notification' : verb.charAt(0).toUpperCase() + verb.slice(1));
        if (step.scriptId) step.detail = 'Waits for the called script to finish';
        else if (service === 'script.turn_on') step.detail = 'Starts scripts without waiting for them to finish';
      } else if (!value.scene) { step.label = named(value.alias, 'Dynamic action'); step.opaque = true; }
    } else if (type === 'event') step.detail = `Event: ${scalar(value.event) || 'configured event'}`;
    else if (type === 'variables') step.detail = 'Variable values are omitted from this view.';
    else if (type === 'unknown') { step.opaque = true; warnings.add('Unrecognized steps remain in place; their behavior is not inferred.'); }
    return step;
  }
  const triggers = kind === 'automation' ? list(config.triggers ?? config.trigger).map(v => trigger(v)).filter(Boolean) : [];
  const conditions = kind === 'automation' ? list(config.conditions ?? config.condition).map(v => condition(v)).filter(Boolean) : [];
  const steps = sequence(kind === 'script' ? config.sequence : config.actions ?? config.action);
  if (truncated) warnings.add(`Flow is limited to ${maxSteps} steps and ${maxDepth} nested levels; some configured steps are omitted.`);
  return { kind, source: 'yaml', triggers, conditions, steps, mode: ['single','restart','queued','parallel'].includes(config.mode) ? config.mode : 'single', truncated, warnings: [...warnings] };
}

export function flowReferences(flow) {
  const ids = new Set();
  function walk(steps) {
    for (const step of steps || []) {
      for (const id of step.references || []) ids.add(id);
      walk(step.triggers); walk(step.conditions); walk(step.steps);
      for (const branch of step.branches || []) { walk(branch.conditions); walk(branch.steps); }
    }
  }
  if (flow) { walk(flow.triggers); walk(flow.conditions); walk(flow.steps); }
  return ids;
}
export function selectFlowGraph(graph, focus, limit = 180) {
  const byId = new Map(graph.nodes.map(n => [n.id, n])), flow = graph.flows?.[focus] || null;
  const references = [...flowReferences(flow)];
  if (!flow) for (const e of graph.edges) if (e.source === focus || e.target === focus) references.push(e.source === focus ? e.target : e.source);
  const selected = new Map();
  for (const id of [focus, ...references]) if (byId.has(id) && selected.size < limit) selected.set(id, byId.get(id));
  // Context comes only from proven registry ownership and area membership.
  for (let depth = 0; depth < 2; depth++) for (const e of graph.edges) {
    const child = ['owned by','assigned area','inherited area'].includes(e.relationship) ? e.source : ['contains','provides','assigned to'].includes(e.relationship) ? e.target : null;
    const parent = child === e.source ? e.target : e.source;
    if (selected.has(child) && byId.has(parent) && selected.size < limit) selected.set(parent, byId.get(parent));
  }
  return { flowFocus: focus, nodes: [...selected.values()], edges: graph.edges.filter(e => selected.has(e.source) && selected.has(e.target)), flow, truncated: (flow?.truncated || false) || [focus,...references].some(id => byId.has(id) && !selected.has(id)) };
}
