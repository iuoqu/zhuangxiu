const { test }=require('node:test');
const assert=require('node:assert/strict');

const response=()=>({code:0,body:null,setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}});
const targets=[{key:'base-office:0',label:'Private office 1',type:'room',kind:'office',adjustable:true},{key:'work-area:research',label:'Research',type:'workArea',kind:'workArea',adjustable:false}];
const body={pin:'test-pin',text:'把办公室缩小一点，多留工位',targets,markers:{entrance:true,window:true}};

test('layout intent endpoint requires access and does not call provider with a wrong code',async()=>{
  const {default:handler}=await import('./suggest-zone.js'),oldPin=process.env.BRIEF_PIN,oldKey=process.env.OPENAI_API_KEY,oldFetch=global.fetch;
  try{process.env.BRIEF_PIN='test-pin';process.env.OPENAI_API_KEY='test-key';global.fetch=()=>{throw Error('provider should not be called')};const res=response();await handler({method:'POST',body:{...body,pin:'wrong'}},res);assert.equal(res.code,401)}
  finally{if(oldPin===undefined)delete process.env.BRIEF_PIN;else process.env.BRIEF_PIN=oldPin;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;global.fetch=oldFetch}
});

test('layout intent endpoint requests strict structured output and sanitizes targets and actions',async()=>{
  const {default:handler}=await import('./suggest-zone.js'),oldPin=process.env.BRIEF_PIN,oldKey=process.env.OPENAI_API_KEY,oldFetch=global.fetch;let sent;
  try{process.env.BRIEF_PIN='test-pin';process.env.OPENAI_API_KEY='test-key';global.fetch=async(url,options)=>{sent={url,request:JSON.parse(options.body)};return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify({reply:'Try these',intents:[{targetKey:'base-office:0',action:'compact',reason:'Space for desks'},{targetKey:'work-area:research',action:'compact',reason:'Invalid'},{targetKey:'unknown',action:'near_window',reason:'Invented'},{targetKey:'base-office:0',action:'near_window',reason:'Use a nonexistent window'}]})}]}]})}};
    const res=response();await handler({method:'POST',body:{...body,markers:{entrance:true,window:false},previousTargetKey:'base-office:0',address:'do not send this address'}},res);
    assert.equal(res.code,200);assert.deepEqual(res.body.intents,[{targetKey:'base-office:0',action:'compact',reason:'Space for desks'}]);assert.equal(sent.url,'https://api.openai.com/v1/responses');assert.equal(sent.request.text.format.strict,true);assert.equal(sent.request.store,false);assert.deepEqual(sent.request.text.format.schema.properties.intents.items.properties.targetKey.enum,targets.map(item=>item.key));assert.equal(JSON.parse(sent.request.input[1].content).previousTargetKey,'base-office:0');assert.equal(JSON.stringify(sent.request.input).includes('do not send this address'),false);
  }finally{if(oldPin===undefined)delete process.env.BRIEF_PIN;else process.env.BRIEF_PIN=oldPin;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;global.fetch=oldFetch}
});

test('layout intent cleaner rejects invented ids, unavailable markers and fixed-size compact requests',async()=>{
  const {cleanZoneIntents}=await import('./suggest-zone.js'),raw={reply:'Okay',intents:[{targetKey:'base-office:0',action:'compact',reason:'One'},{targetKey:'base-office:0',action:'compact',reason:'Duplicate'},{targetKey:'base-office:0',action:'near_window',reason:'No marker'},{targetKey:'work-area:research',action:'compact',reason:'Not a room'},{targetKey:'unknown',action:'near_entrance',reason:'Invented'}]};
  assert.equal(cleanZoneIntents(raw,targets,{entrance:true,window:false}).intents.length,1);
  assert.equal(cleanZoneIntents(raw,[{...targets[0],adjustable:false}],{entrance:true,window:true}).intents.length,1);
  assert.equal(cleanZoneIntents({intents:[{targetKey:'base-office:0',action:'compact'}]},[{...targets[0],adjustable:false}],{entrance:false,window:false}).intents.length,0);
});
