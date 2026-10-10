import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../../apps/portal/src/lib/actions/video-conversation.ts', import.meta.url), 'utf8');
function load(options = {}) {
  const calls = [];
  const provider = {async createConversation() {calls.push('dispatch'); if (options.providerFailure) throw Error('synthetic provider ambiguity'); return {conversationId:'remote-fixture',conversationUrl:'https://example.daily.co/fixture'};}, async endConversation() {calls.push('compensate'); if(options.compensationFailure) throw Error('synthetic compensation ambiguity');}};
  const reservation = options.reservation ?? {outcome:'acquired',reservationId:'reservation-fixture',state:'reserved',providerUrl:null,providerRef:null};
  const mocks = new Map([
    ['@axtro/provider-tavus', {createTavusVideoConversationPort:()=>provider,VideoProviderError:class extends Error {}}],
    ['@/lib/knowledge',{fakeProvidersEnabled:()=>options.fake === true}],
    ['@/lib/rate-limit',{isRateLimited:()=>false}],['@/lib/video-cap',{VIDEO_CAP_MESSAGE:'capped'}],
    ['@/lib/portal-data',{async fetchTenantOverview(){return {provisioned:true,tenant:{id:'tenant-a',legal_name:'Synthetic'}};}, async fetchAgents(){return [{id:'agent-a',name:'Synthetic Agent'}];}}],
    ['@/lib/supabase/server',{async createClient(){return {auth:{async getUser(){return {data:{user:{app_metadata:{actor_id:'actor-fixture'}}}};}}};}}],
    ['@/lib/telemetry',{logError(){}}],
    ['@/lib/video-config',{async resolveAgentVideoConfig(){return {ok:true,config:{configured:true,persona_id:'pfixture',replica_id:null,language:'portuguese',spoken_languages:null}};},async fetchKnowledgeDigest(){return null;},providerLanguageCodes(){return undefined;}}],
    ['@/lib/presentation/deck',{buildSalesDeck:()=>({slides:[]}),buildPlatformDeck:()=>({slides:[]}),buildDeckContext:()=>''}],
    ['@/lib/transcripts/register',{async prepareTavusWebhookCallback(){if(options.callbackFailure)throw Error('synthetic bind ambiguity');return {callbackUrl:'https://callback.invalid'};},async registerTranscriptPlaceholder(){return true;}}],
    ['@/lib/runtime/portal-channel-runtime-bridge',{async admitPortalChannel(){return options.admissionDenied ? {outcome:'rejected',code:'bridge_disabled'} : {outcome:'admitted',grant:{}};},async assertPortalProviderDispatchActive(){return options.dispatchDenied ? {outcome:'rejected',code:'bridge_disabled'} : {outcome:'consumed'};},async bindPortalProviderChannel(){return options.bindingFailure ? {outcome:'rejected',code:'bridge_disabled'} : {outcome:'bound'};}}],
    ['@/lib/paid-effects',{
      isPaidEffectCommandId:()=>true,paidEffectIntentKey:()=> 'fixture-key',providerCorrelationLabel:()=> 'fixture-label',
      async beginProviderEffect(){calls.push('reserve');return reservation;},async retryReleasedProviderEffect(_input,result){return result;},
      async commitProviderEffectOrCompensate(){calls.push('commit');},async releaseProviderEffect(){calls.push('release'); if(options.releaseFailure) throw Error('synthetic release refusal');},async fenceProviderFailure(){calls.push('unknown');},
      async compensateCommittedProviderEffect(input){return input.terminate();},async terminateProviderEffectForOperator(){return {outcome:'accepted'};},
    }],
  ]);
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};new vm.Script(compiled).runInNewContext({exports,require(name){if(!mocks.has(name))throw Error(`unmocked ${name}`);return mocks.get(name);},process:{env:{TAVUS_API_KEY: options.missingKey?'':'synthetic-only',TAVUS_REPLICA_ID:''}},Error,Date});
  return {calls,run:mode=>exports[mode==='video'?'startVideoConversation':'startPresentationConversation']('agent-a','synthetic-command',{})};
}
for(const mode of ['video','presentation']) for(const [label,options,expected] of [
  ['predispatch denial',{missingKey:true},'not_started'],
  ['admission denied',{admissionDenied:true},'not_started'],
  ['cap denied',{reservation:{outcome:'capped',reservationId:null}},'not_started'],
  ['prior unknown',{reservation:{outcome:'blocked_unknown',reservationId:null}},'possible'],
  ['dispatch claim denied and released',{dispatchDenied:true},'not_started'],
  ['dispatch claim denied but release refused',{dispatchDenied:true,releaseFailure:true},'possible'],
  ['callback ambiguity',{callbackFailure:true},'possible'],
  ['provider ambiguity',{providerFailure:true},'possible'],
  ['compensation ambiguity',{bindingFailure:true,compensationFailure:true},'possible'],
  ['committed room',{},'committed'],
]) test(`${mode} classifies ${label}`,async()=>{
  const h=load(options);const result=await h.run(mode);
  assert.equal(result.effect.schema_version,'2.0.0');assert.equal(result.effect.remoteEffect,expected);
  if(expected==='not_started')assert.equal(h.calls.includes('dispatch'),false);
  if(expected==='committed'){assert.ok(result.url);assert.deepEqual(h.calls,['reserve','dispatch','commit']);}
});
test('simulated presentation has no remote effect or paid reservation',async()=>{
  const h=load({fake:true,missingKey:true});const result=await h.run('presentation');
  assert.equal(result.simulated,true);assert.equal(result.effect.remoteEffect,'not_started');assert.deepEqual(h.calls,[]);
});
