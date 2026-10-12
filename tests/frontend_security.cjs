// [Codex] Exercise real renderers and shared pipeline transport using synthetic data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {innerHTML:'', value:'', style:{}, listeners:new Map(), classList:{add(){},remove(){},toggle(){}},
    addEventListener(event,handler){if(!this.listeners.has(event))this.listeners.set(event,[]);this.listeners.get(event).push(handler);},
    async dispatch(event){for(const handler of this.listeners.get(event)||[])await handler({target:this});},
    querySelectorAll(){return []}});
  return elements.get(id);
}
const ctx = vm.createContext({console, URL, Set, Map, Date, Number, JSON, Math, encodeURIComponent,HTMLElement:class {},
  document:{getElementById:element, querySelector:element, querySelectorAll(){return []},addEventListener(){}},
  loadCourseList(){ctx.courseListRefreshes=(ctx.courseListRefreshes || 0)+1;},openPreviewModal(){},openFileInSystem(){},window:{}, localStorage:{getItem(){return null},setItem(){}}, Icons:new Proxy({}, {get(){return ''}}),
  setTimeout,clearTimeout, fetch: async()=>({ok:false,status:403})});
const run = code => vm.runInContext(code,ctx);
for(const file of ['00_core.js','05_assignments.js','08_timeline.js','11_settings.js','14_launcher.js','15_rescan.js']) {
  run(fs.readFileSync(path.join(__dirname,'../canvas_app/static/js/src',file),'utf8'));
}
run(`state.courseData={assignments:[{title:'Test',due:'<img src=x onerror=alert(1)>',points:'<img src=x onerror=alert(1)>'}]}; renderAssignmentsTab();`);
assert(!element('view-canvas-container').innerHTML.includes('<img'));
assert(element('view-canvas-container').innerHTML.includes('&lt;img'));
for (const bad of ['javascript:alert(1)','data:text/html,test','file:///tmp/test']) {
  assert.equal(run(`safeExternalUrl(${JSON.stringify(bad)})`),'#');
}
run(`renderLauncherView=()=>{};renderRescanView=()=>{};appendTerminalLog=()=>{};appendRescanTerminalLog=()=>{};
handlePipelineEvent({type:'done',success:true,files_count:0});handleRescanEvent({type:'done',success:true,files_count:0});`);
assert.equal(ctx.courseListRefreshes,1);
assert.equal(run('launcherState.finishedCourse.files_count'),0);
assert.equal(run('rescanState.finishedCourse.files_count'),0);
run(`handlePipelineEvent({type:'done',success:false});handleRescanEvent({type:'done',success:false})`);
assert.equal(run('launcherState.finishedCourse'),null);
assert.equal(run('rescanState.finishedCourse'),null);
(async()=>{
  await assert.rejects(run(`startArchiveJob({aiProvider:'rules'}, {course_name:'Test'})`),/403/);
  ctx.fetch=async()=>{throw new Error('network unavailable')};
  await assert.rejects(run(`startArchiveJob({aiProvider:'rules'}, {course_name:'Test'})`),/network/);
  const requests=[];
  ctx.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({job_id:'fixture'})}};
  run(`const job={aiProvider:'gemini',geminiApiKey:'test-mock-key'};`); // pragma: allowlist secret -- dummy fixture
  await run(`startArchiveJob(job,{course_name:'Test'})`);
  assert.equal(requests.length,2);
  assert.equal(requests[0].url,'/api/settings/gemini-key');
  assert(!JSON.stringify(requests[1]).includes('test-mock-key'));
  assert.equal(run('job.geminiApiKey'),'');
  // [Codex] Dispatch the real bound click: calling saveGeminiKey directly would
  // miss a disconnected Settings button. All credentials here are dummy data.
  const storageWrites=[];
  ctx.localStorage.setItem=(...args)=>storageWrites.push(args);
  run('initExtendedSettings()');
  const save=element('settings-key-save'), input=element('settings-gemini-key'), status=element('settings-key-status');
  assert.equal(save.listeners.get('click').length,1);
  requests.length=0;
  input.value='synthetic-only-test-key'; // pragma: allowlist secret -- dummy fixture
  ctx.fetch=async(url,options)=>{requests.push({url,method:options.method,body:JSON.parse(options.body)});return {ok:true}};
  await save.dispatch('click');
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'/api/settings/gemini-key');
  assert.equal(requests[0].method,'PUT');
  assert.equal(requests[0].body.api_key,'synthetic-only-test-key');
  assert.equal(input.value,'');
  assert.match(status.textContent,/Key saved locally/);
  assert.equal(input.disabled,false);
  assert.equal(save.disabled,false);
  assert.equal(storageWrites.length,0);
  requests.length=0;
  input.value='synthetic-failed-save-key'; // pragma: allowlist secret -- dummy fixture
  ctx.fetch=async(url,options)=>{requests.push({url,method:options.method});return {ok:false,status:500}};
  await save.dispatch('click');
  assert.equal(requests.length,1);
  assert.equal(input.value,'synthetic-failed-save-key');
  assert.match(status.textContent,/Could not save the key/);
  assert(!status.textContent.includes(input.value));
  assert.equal(input.disabled,false);
  assert.equal(save.disabled,false);
  assert.equal(storageWrites.length,0);
  console.log('Frontend security regressions passed');
})().catch(error=>{console.error(error);process.exitCode=1});
