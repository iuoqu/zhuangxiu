const {test}=require('node:test');
const assert=require('node:assert/strict');
async function moduleUnderTest(){return import('./extract-brief.js')}
function response(){return {code:0,headers:{},setHeader(key,value){this.headers[key]=value},status(code){this.code=code;return this},json(body){this.body=body;return this}}}

test('cleaning preserves only bounded, known requirement values',async()=>{
  const {cleanExtraction}=await moduleUnderTest();
  const brief=cleanExtraction({people:40,meetingRooms:2,roomSeats:8,extraSpaces:[{kind:'it',count:1,seats:0,priority:'must'},{kind:'unknown',count:99}],departments:[{name:'Sales',assigned:8,peakOnsite:5,activity:'calls'}],relations:[],tradeoffs:[{target:'training',action:'substitute',minimum:0,alternative:'meeting'}],questions:['Confirm concurrent calls']});
  assert.equal(brief.people,40);assert.equal(brief.extraSpaces.length,1);assert.equal(brief.departments[0].activity,'calls');assert.equal(brief.tradeoffs[0].action,'substitute');assert.equal(brief.questions.length,1);
});
test('role offices stay inside the total and window preferences are retained',async()=>{const {cleanExtraction,extractionSchema}=await moduleUnderTest();const brief=cleanExtraction({people:24,offices:null,officeRoles:{executive:1,director:2},relations:[{from:'executive office',rule:'window',to:'',priority:'preferred'}]});assert.equal(brief.offices,3);assert.equal(brief.officeRoles.director,2);assert.equal(brief.relations[0].rule,'window');assert.ok(extractionSchema.properties.relations.items.properties.rule.enum.includes('window'))});
test('endpoint requires server access code and never calls provider without it',async()=>{
  const {default:handler}=await moduleUnderTest(),prior=process.env.BRIEF_PIN,priorKey=process.env.OPENAI_API_KEY,oldFetch=global.fetch;
  try{process.env.BRIEF_PIN='test-pin';process.env.OPENAI_API_KEY='test-key';global.fetch=()=>{throw Error('provider should not be called')};const res=response();await handler({method:'POST',body:{pin:'wrong',text:'Need 24 workstations and two meeting rooms.'}},res);assert.equal(res.code,401)}finally{if(prior===undefined)delete process.env.BRIEF_PIN;else process.env.BRIEF_PIN=prior;if(priorKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=priorKey;global.fetch=oldFetch}
});
test('endpoint requests strict structured output and returns a sanitized draft',async()=>{
  const {default:handler}=await moduleUnderTest(),prior=process.env.BRIEF_PIN,priorKey=process.env.OPENAI_API_KEY,oldFetch=global.fetch;let request;
  try{process.env.BRIEF_PIN='test-pin';process.env.OPENAI_API_KEY='test-key';global.fetch=async(url,options)=>{request={url,options};return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify({people:24,meetingRooms:2,roomSeats:6,questions:['Confirm peak attendance']})}]}]})}};const res=response();await handler({method:'POST',body:{pin:'test-pin',text:'We need 24 workstations and two six-person meeting rooms.'}},res);assert.equal(res.code,200);assert.equal(res.body.brief.people,24);assert.equal(res.body.brief.phones,null);assert.equal(request.url,'https://api.openai.com/v1/responses');const sent=JSON.parse(request.options.body);assert.equal(sent.text.format.strict,true);assert.equal(sent.store,false);assert.equal(sent.input[1].content,'We need 24 workstations and two six-person meeting rooms.')}
  finally{if(prior===undefined)delete process.env.BRIEF_PIN;else process.env.BRIEF_PIN=prior;if(priorKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=priorKey;global.fetch=oldFetch}
});
