import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { normalizeFlow, flowReferences, selectFlowGraph } from '../server/automation-flow.js';
import { buildGraph } from '../server/graph.js';
import { createApp } from '../server/index.js';
import { referenceContext, referenceGroups, hiddenReference } from '../src/automation-ui.js';
import { starterSandbox } from '../src/sandbox.js';
const data = { states: [
  { entity_id:'automation.crying', state:'on', attributes:{id:'crying',friendly_name:'Archer Crying'} },
  { entity_id:'binary_sensor.crying', state:'off', attributes:{friendly_name:'Baby crying'} },
  { entity_id:'light.studio', state:'on', attributes:{friendly_name:'Studio Lights'} },
  { entity_id:'script.alert', state:'off', attributes:{friendly_name:'Alert family'} }
], entities:[{entity_id:'binary_sensor.crying',device_id:'camera'},{entity_id:'light.studio',device_id:'lamp'}],
 devices:[{id:'camera',name:'Nursery Camera',area_id:'nursery'},{id:'lamp',name:'Lamp',area_id:'studio'}],
 areas:[{area_id:'nursery',name:'Nursery'},{area_id:'studio',name:'Studio'}],warnings:[] };
const configuration = { automations:[{id:'crying', triggers:[{trigger:'state',entity_id:'binary_sensor.crying',to:'on'},{trigger:'time',at:'20:00:00'}],
 conditions:[{condition:'or',conditions:[{condition:'state',entity_id:'light.studio',state:'off'},{condition:'template',value_template:'PRIVATE_TEMPLATE'}]}],
 actions:[{alias:'Set the studio lights',action:'light.turn_on',target:{entity_id:'light.studio'},data:{password:'PRIVATE_DATA',message:'PRIVATE_MESSAGE'}},
  {delay:{seconds:5}}, {action:'script.alert'}] }],
 scripts:{alert:{sequence:[{action:'notify.mobile_app_phone',data:{message:'PRIVATE_NOTIFICATION'}}]}},warnings:[] };
function allSteps(flow) {
 const result=[];
 function walk(steps) { for(const s of steps||[]) { result.push(s);walk(s.triggers);walk(s.conditions);walk(s.steps);for(const b of s.branches||[]) {walk(b.conditions);walk(b.steps);} } }
 walk(flow.triggers);walk(flow.conditions);walk(flow.steps);return result;
}

test('configuration order is preserved, triggers are alternatives, and only normalized metadata leaves the parser',()=>{
 const original=structuredClone(configuration), flow=normalizeFlow(configuration.automations[0]);
 assert.deepEqual(flow.steps.map(s=>s.kind),['action','delay','action']);
 assert.equal(flow.triggers.length,2);
 assert.equal(flow.triggers[0].detail,'Any state → on');
 assert.equal(flow.conditions[0].conditionType,'or');
 assert.equal(flow.conditions[0].conditions[1].opaque,true);
 assert.equal(flow.steps[1].detail,'5 seconds');
 assert.equal(flow.steps[2].scriptId,'script.alert');
 assert.match(flow.steps[2].detail,/Waits/);
 assert.deepEqual([...flowReferences(flow)].sort(),['binary_sensor.crying','light.studio','script.alert']);
 assert.equal(JSON.stringify(flow).includes('PRIVATE_'),false);
 assert.deepEqual(configuration,original);
 assert.deepEqual(normalizeFlow({trigger:configuration.automations[0].triggers,condition:configuration.automations[0].conditions,action:configuration.automations[0].actions}),flow);
});

test('if, first-match choices, parallel branches and repeat check timing remain structurally distinct',()=>{
 const flow=normalizeFlow({actions:[
  {if:[{condition:'state',entity_id:'light.studio',state:'on'}],then:[{delay:1}],else:[{stop:'PRIVATE_REASON'}]},
  {choose:[{conditions:[{condition:'numeric_state',entity_id:'sensor.number',above:2}],sequence:[{action:'light.turn_on'}]},{conditions:'{{ true }}',sequence:[{action:'light.turn_off'}]}],default:[{delay:'00:00:10'}]},
  {parallel:[{sequence:[{delay:2},{delay:3}]},{action:'light.toggle'}]},
  {repeat:{until:[{condition:'state',entity_id:'light.studio',state:'off'}],sequence:[{delay:1}]}},
  {repeat:{while:[{condition:'state',entity_id:'light.studio',state:'on'}],sequence:[{delay:2}]}},
  {repeat:{count:3,sequence:[{action:'light.turn_on'}]}},
  {repeat:{for_each:['PRIVATE_ITEM'],sequence:[{variables:{private:'PRIVATE_VALUE'}}]}}
 ]});
 assert.deepEqual(flow.steps.map(s=>s.kind),['if','choose','parallel','repeat','repeat','repeat','repeat']);
 assert.equal(flow.steps[0].branches[0].steps[0].kind,'delay');
 assert.equal(flow.steps[0].branches[1].steps[0].kind,'stop');
 assert.equal(flow.steps[1].branches.length,3);
 assert.match(flow.steps[1].branches[2].label,/Otherwise/);
 assert.deepEqual(flow.steps[2].branches.map(b=>b.steps.length),[1,1]);
 assert.equal(flow.steps[2].branches[0].steps[0].kind,'sequence');
 assert.equal(flow.steps[2].branches[0].steps[0].steps.length,2);
 assert.equal(flow.steps[3].repeatType,'until'); assert.match(flow.steps[3].detail,/then check/);
 assert.equal(flow.steps[4].repeatType,'while'); assert.match(flow.steps[4].detail,/before/);
 assert.equal(flow.steps[5].detail,'Repeat 3 times');
 assert.equal(flow.steps[6].repeatType,'for_each');
 assert.equal(JSON.stringify(flow).includes('PRIVATE_'),false);
});

test('waits, disabled steps, dynamic targets, condition gates and unknown steps cannot silently change the sequence',()=>{
 const flow=normalizeFlow({actions:[
  {wait_for_trigger:[{platform:'state',entity_id:'light.studio',to:'on'},{trigger:'event',event_type:'some_event'}],timeout:15,continue_on_timeout:false},
  {wait_template:'PRIVATE_TEMPLATE',timeout:'00:01:00'},
  {condition:'state',entity_id:'light.studio',state:'on'},
  {action:'light.turn_on',enabled:false,target:{entity_id:'{{ PRIVATE_TARGET }}'}},
  {unknown:'PRIVATE_CONTENT'},
  {action:'script.turn_on',target:{entity_id:'script.alert'}},
  {stop:'PRIVATE_REASON'},
  {action:'light.turn_off',enabled:'{{ PRIVATE_ENABLED }}'}
 ]});
 assert.deepEqual(flow.steps.map(s=>s.kind),['wait','wait','condition','action','unknown','action','stop','action']);
 assert.equal(flow.steps[0].triggers.length,2);assert.equal(flow.steps[0].continueOnTimeout,false);
 assert.equal(flow.steps[1].continueOnTimeout,true);
 assert.equal(flow.steps[2].gate,true);
 assert.equal(flow.steps[3].disabled,true);assert.equal(flow.steps[3].dynamicTargets,true);assert.deepEqual(flow.steps[3].references,[]);
 assert.equal(flow.steps[4].opaque,true);assert.ok(flow.warnings.length);
 assert.match(flow.steps[5].detail,/without waiting/);assert.equal(flow.steps[5].scriptId,undefined);
 assert.equal(flow.steps[7].dynamicEnabled,true);
 assert.equal(JSON.stringify(flow).includes('PRIVATE_'),false);
});

test('flow expansion is bounded by both total step count and nesting, with a visible truncation notice',()=>{
 const wide=normalizeFlow({actions:Array.from({length:1000},()=>({parallel:Array.from({length:200},()=>({delay:1}))}))});
 assert.ok(allSteps(wide).length<=160);assert.equal(wide.truncated,true);assert.match(wide.warnings.join(' '),/limited/);
 let nested={delay:1};for(let i=0;i<40;i++) nested={sequence:[nested]};
 const deep=normalizeFlow({actions:[nested]});assert.equal(deep.truncated,true);assert.ok(allSteps(deep).length<=13);
 const empty=normalizeFlow({actions:[]});assert.equal(empty.truncated,false);assert.deepEqual(empty.steps,[]);
 const ids=allSteps(wide).map(s=>s.id);assert.equal(new Set(ids).size,ids.length);
 const targets=normalizeFlow({actions:[{action:'light.turn_on',target:{entity_id:Array.from({length:100},(_,i)=>`light.item_${i}`)}}]});
 assert.equal(targets.steps[0].references.length,32);assert.equal(targets.steps[0].referencesTruncated,true);assert.match(targets.warnings.join(' '),/32 references/);
});

test('flow graph and API attach the correct sequence and ownership context without exposing all configurations',async()=>{
 const graph=buildGraph(data,configuration),selected=selectFlowGraph(graph,'automation.crying');
 assert.ok(selected.nodes.some(n=>n.id==='device:camera'));assert.ok(selected.nodes.some(n=>n.id==='area:nursery'));
 assert.equal(referenceContext(selected,'light.studio').area.label,'Studio');
 assert.equal(referenceContext(selected,'light.studio').device.label,'Lamp');
 assert.ok(selected.flow);assert.equal(selected.flows,undefined);
 assert.equal(selectFlowGraph(graph,'automation.crying',2).truncated,true);
 const app=await createApp({read:async()=>data,config:async()=>configuration,logger:false,ingressOnly:false});
 try {
  const snapshot=(await app.inject('/api/snapshot')).json();assert.equal(snapshot.flows,undefined);
  const result=await app.inject('/api/graph?view=flow&focus=automation.crying');assert.equal(result.statusCode,200);
  assert.equal(result.json().flow.steps[0].label,'Set the studio lights');assert.equal(result.body.includes('PRIVATE_'),false);
  const script=(await app.inject('/api/graph?view=flow&focus=script.alert')).json();assert.equal(script.flow.kind,'script');assert.deepEqual(script.flow.triggers,[]);
  assert.equal((await app.inject('/api/graph?view=flow&focus=light.studio')).statusCode,400);
 } finally {await app.close();}
});

test('missing, ambiguous, blueprint and Sandbox configurations provide references without inventing order',()=>{
 for(const config of [{...configuration,automations:[]},{...configuration,automations:[{...configuration.automations[0],use_blueprint:{path:'PRIVATE_PATH'}}]},
  {...configuration,automations:[configuration.automations[0],configuration.automations[0]]}]) {
  const flow=selectFlowGraph(buildGraph(data,config),'automation.crying');assert.equal(flow.flow,null);
 }
 const sandbox=starterSandbox(),fallback=selectFlowGraph(sandbox,'arrival');assert.equal(fallback.flow,null);
 assert.ok(referenceGroups(fallback,'arrival').some(g=>g.label==='Trigger references'));
 assert.equal(referenceContext(selectFlowGraph(sandbox,'evening'),'lamp').area.label,'Studio');
 const diagnostic={nodes:[{id:'sensor.battery',entityId:'sensor.battery',kind:'entity',deviceClass:'battery',entity_category:'diagnostic'}],edges:[]};
 assert.equal(hiddenReference(diagnostic,'sensor.battery',false,['sensor:battery']),true);
 assert.equal(hiddenReference(diagnostic,'sensor.battery',true,[]),true);
 assert.equal(hiddenReference(diagnostic,'device:unknown',true,['sensor']),false);
});

test('rendered flow presents ordered actions, alternatives, context and explicit fallback without false sequence lines',async()=>{
 const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
 try {
  const {AutomationFlow}=await vite.ssrLoadModule('/src/automation-flow.jsx');
  const graph=selectFlowGraph(buildGraph(data,configuration),'automation.crying');
  const props={graph,focus:'automation.crying',onExplore:()=>{},loadFlow:async()=>{},hideDiagnostic:false,hiddenTypes:[]};
  const html=renderToStaticMarkup(React.createElement(AutomationFlow,props));
  assert.ok(html.indexOf('WHEN')<html.indexOf('AND IF'));assert.ok(html.indexOf('AND IF')<html.indexOf('THEN DO'));
  assert.ok(html.indexOf('Set the studio lights')<html.indexOf('5 seconds'));assert.ok(html.indexOf('5 seconds')<html.indexOf('Call script'));
  assert.match(html,/Any enabled trigger can start a run/);assert.match(html,/Nursery/);assert.match(html,/Studio/);assert.match(html,/not a live execution trace/);
  const hidden=renderToStaticMarkup(React.createElement(AutomationFlow,{...props,hiddenTypes:['light']}));
  assert.match(hidden,/Set the studio lights/);assert.match(hidden,/reference hidden/);
  const fallback=renderToStaticMarkup(React.createElement(AutomationFlow,{...props,graph:selectFlowGraph(starterSandbox(),'arrival'),focus:'arrival',loadFlow:null}));
  assert.match(fallback,/These groups do not imply a sequence/);assert.doesNotMatch(fallback,/flow-step-number|flow-connector/);
  const blocked=renderToStaticMarkup(React.createElement(AutomationFlow,{...props,graph:{...graph,flow:normalizeFlow({actions:[{stop:'done'},{action:'light.turn_on'}]})}}));
  assert.match(blocked,/Not reached after the stop above/);
  const dynamicStop=renderToStaticMarkup(React.createElement(AutomationFlow,{...props,graph:{...graph,flow:normalizeFlow({actions:[{stop:'done',enabled:'{{ false }}'},{action:'light.turn_on'}]})}}));
  assert.doesNotMatch(dynamicStop,/Not reached after the stop above/);
  const stale=renderToStaticMarkup(React.createElement(AutomationFlow,{...props,focus:'script.alert'}));
  assert.doesNotMatch(stale,/Set the studio lights/);

 } finally {await vite.close();}
});
