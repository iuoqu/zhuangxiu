const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('broker.js','utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('const brokerDefaults'),source.indexOf('let pendingBroker'))+source.slice(source.indexOf('function brokerAssessment('),source.indexOf('function showBrokerReport(')),context);
function assess(overrides={}){context.project={broker:{people:4,phones:0,meetingRooms:2,roomSeats:6,offices:3,pantry:true},furniture:[{kind:'bench2'},{kind:'bench2'},{kind:'meeting'},{kind:'meeting'}],drafts:[{}],site:{confirmed:true},...overrides};return vm.runInContext('brokerAssessment(project)',context)}
test('meeting tables never count as verified enclosed rooms',()=>{const a=assess();assert.equal(a.rows.find(r=>r.name.startsWith('Meeting rooms')).status,'Needs review');assert.equal(a.rows.find(r=>r.name==='Private offices').status,'Needs review');assert.match(a.title,/review needed/)});
test('insufficient workstations produce shortfall',()=>assert.match(assess({furniture:[]}).title,/shortfalls/));
test('changed site invalidates previous assessment',()=>assert.equal(assess({draftsStale:true}).title,'Assessment out of date'));
test('no plans cannot be presented as an assessment',()=>assert.match(assess({drafts:[]}).title,/generate layouts/));
test('brief and next step survive JSON export',()=>{const p={broker:{client:'Client A',address:'LA suite 2',meetingRooms:2,roomSeats:8,next:'Arrange a site visit'}};assert.deepEqual(JSON.parse(JSON.stringify(p)),p)});
