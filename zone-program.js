/* Explicit functional-area customization. Draft form edits never mutate the current plan. */
const zoneProgramFields = [
  {key:'people',label:'Workstations',min:4,max:300},
  {key:'meetingRooms',label:'Meeting rooms',min:0,max:10},
  {key:'roomSeats',label:'Seats per meeting room',min:1,max:30},
  {key:'offices',label:'Private offices',min:0,max:30},
  {key:'phones',label:'Phone booths',min:0,max:20},
  {key:'diningSeats',label:'Dining seats',min:0,max:40},
  {key:'loungeSeats',label:'Lounge seats',min:0,max:30}
];
const zoneProgramBooleans=[['reception','Reception'],['pantry','Pantry'],['coffeeBar','Coffee bar']];
const zoneProgramSizeKinds=[['meeting','Meeting rooms'],['office','Private offices'],['pantry','Pantry'],['reception','Reception'],['coffee','Coffee bar'],['dining','Dining area'],['lounge','Lounge area']];
const zoneProgramRestoreKeys=['broker','drafts','activeDraft','objects','furniture','workAreas','site','draftsStale','spaceProposals','acceptedAdjustment','manualSpaceEdit','zoneAssist','zoneAssistHistory'];

$('#comparisonToggle').insertAdjacentHTML('beforebegin','<button class="btn" id="zoneProgramOpen" type="button">Customize areas</button>');
$('#comparisonPanel').insertAdjacentHTML('beforeend','<div id="zoneProgramRestoreBar" class="zone-program-restore" hidden><span>Functional areas were changed and A/B/C was regenerated.</span><button class="btn" id="zoneProgramRestore" type="button">Restore previous needs and plan</button></div>');
document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="zoneProgramModal" hidden><form class="dialog wide" id="zoneProgramForm"><div class="eyebrow">Customer needs · explicit change</div><h1>Customize functional areas</h1><p>Set the spaces to try in this rectangular-office MVP. The current plan and client needs stay unchanged until you save. Saving regenerates A/B/C; the previous needs and plan can be restored.</p><div class="zone-program-grid">${zoneProgramFields.map(field=>`<label>${field.label}<input data-program-field="${field.key}" type="number" min="${field.min}" max="${field.max}" step="1" required></label>`).join('')}</div><div class="zone-program-switches">${zoneProgramBooleans.map(([key,label])=>`<label><input data-program-bool="${key}" type="checkbox"> ${label}</label>`).join('')}</div><details class="zone-program-details"><summary>Additional rooms and team areas</summary><p>Add only supported types. Seat counts must fit their template; an unmet need remains visible after regeneration.</p><h2>Additional rooms</h2><div id="zoneProgramExtraRows"></div><button class="btn" id="zoneProgramAddExtra" type="button">Add room type</button><h2>Named work areas</h2><p>Up to three areas; desk targets divide the workstation total rather than add to it.</p><div id="zoneProgramWorkRows"></div><button class="btn" id="zoneProgramAddWork" type="button">Add team area</button></details><details class="zone-program-details"><summary>Placement and size rules</summary><p>Only reception near the entrance and private offices near windows receive a concept-distance screen. Other relationships remain in detailed needs.</p><div class="zone-program-grid"><label>Reception location<select id="zoneProgramReceptionRule"><option value="none">No rule</option><option value="preferred">Prefer near entrance</option><option value="must">Must be near entrance</option></select></label><label>Private-office location<select id="zoneProgramOfficeRule"><option value="none">No rule</option><option value="preferred">Prefer near windows</option><option value="must">Must be near windows</option></select></label></div><p>Fixed means use only the standard template. Flexible permits the planner to suggest a validated compact version; it does not set arbitrary dimensions.</p><div class="zone-program-grid">${zoneProgramSizeKinds.map(([key,label])=>`<label>${label} size<select data-program-size="base-${key}"><option value="suggest">Flexible suggestion</option><option value="fixed">Fixed standard template</option></select></label>`).join('')}</div></details><p class="zone-program-note">For role-specific offices, team relationships and other review-only requirements, use the full needs editor.</p><p id="zoneProgramChange" class="zone-program-change" role="status"></p><p id="zoneProgramError" class="zone-program-error" role="alert"></p><div class="actions"><button class="btn" id="zoneProgramCancel" type="button">Cancel</button><button class="btn" id="zoneProgramDetailed" type="button">Full needs editor</button><button class="btn primary" id="zoneProgramSave" type="submit">Save and regenerate A/B/C</button></div></form></div>`);

const zoneProgramStyle=document.createElement('style');
zoneProgramStyle.textContent='.comparison-head{flex-wrap:wrap}.comparison-head #zoneProgramOpen{margin-left:auto}.zone-program-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px;margin:14px 0}.zone-program-grid label{display:grid;gap:5px;font-size:13px;font-weight:600;color:#334155}.zone-program-grid input,.zone-program-grid select{width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:7px;font:inherit}.zone-program-switches{display:flex;flex-wrap:wrap;gap:8px 18px}.zone-program-switches label{font-size:13px}.zone-program-details{margin-top:13px;padding:10px;border:1px solid #dfe3e8;border-radius:9px}.zone-program-details summary{cursor:pointer;font-weight:700;color:#1e40af}.zone-program-details h2{font-size:14px;margin:12px 0 6px}.zone-program-details p,.zone-program-note{font-size:12px;color:#64748b}.zone-program-extra{display:grid;grid-template-columns:minmax(140px,2fr) 60px 60px minmax(110px,1fr) minmax(130px,1fr) auto;gap:6px;margin:6px 0}.zone-program-extra>*{min-width:0}.zone-program-extra input,.zone-program-extra select{width:100%;padding:7px;border:1px solid #cbd5e1;border-radius:6px}.zone-program-change{min-height:20px;color:#1e40af;font-size:13px}.zone-program-error{min-height:20px;color:#b91c1c;font-size:13px}.zone-program-restore{display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid #dfe3e8;padding:10px 0 0;margin-top:10px;font-size:13px}.zone-program-restore[hidden]{display:none}.zone-program-restore .btn{flex:none}@media(max-width:760px){.comparison-head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center}.comparison-head #zoneProgramOpen{margin:0;padding:3px 7px;font-size:11px;line-height:1.2;min-height:25px}.zone-program-grid{grid-template-columns:1fr}.zone-program-extra{grid-template-columns:1fr 1fr}.zone-program-extra>*:first-child{grid-column:1/-1}.zone-program-extra .btn{grid-column:2}.zone-program-restore{align-items:flex-start;flex-direction:column}}';
zoneProgramStyle.textContent+='@media(max-width:760px){.comparison-head>div{display:none}.comparison-head{display:flex;justify-content:flex-end;margin-bottom:0}}';
zoneProgramStyle.textContent+='#zoneProgramModal .dialog.wide{width:min(1080px,calc(100vw - 24px))}.zone-program-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.12fr);gap:18px;align-items:start}.zone-program-controls,.zone-program-preview{min-width:0}.zone-program-preview{position:sticky;top:0;padding:10px;border:1px solid #bfdbfe;border-radius:10px;background:#f8fbff}.zone-program-preview>h2{font-size:14px;margin:0 0 3px}.zone-program-preview>p{font-size:11px;margin:0 0 7px!important}.zone-program-pair{display:grid;gap:8px}.zone-program-map{min-width:0;padding:7px;border:1px solid #dfe3e8;border-radius:8px;background:#fff}.zone-program-map b{display:block;font-size:12px}.zone-program-map svg{display:block;width:100%;height:200px;margin:4px 0;background:#fff}.zone-program-map small{display:block;font-size:11px;color:#475569}.zone-program-map .short{color:#b42318;font-weight:600}.zone-program-map .empty{padding:20px 5px}.zone-program-legend{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:7px;color:#475569;font-size:10px}.zone-program-legend span:before{content:"";display:inline-block;width:9px;height:9px;margin-right:4px;border-radius:2px;background:var(--swatch)}#zoneProgramPreviewStatus{margin:6px 0 0!important;font-size:11px;color:#475569}@media(max-width:760px){.zone-program-layout{grid-template-columns:1fr}.zone-program-preview{position:static;order:-1}.zone-program-map svg{height:175px}}';
document.head.append(zoneProgramStyle);
$('#zoneProgramExtraRows').insertAdjacentHTML('beforebegin','<p class="zone-program-note">Each row: room type · quantity · seats per room (0 uses the template) · priority · size flexibility. Preferred targets still appear as gaps; the planner never quietly drops them.</p>');

const zoneProgramForm=$('#zoneProgramForm'),zoneProgramLayout=document.createElement('div'),zoneProgramControls=document.createElement('div'),zoneProgramPreview=document.createElement('section');
zoneProgramLayout.className='zone-program-layout';zoneProgramControls.className='zone-program-controls';zoneProgramPreview.className='zone-program-preview';
zoneProgramPreview.setAttribute('aria-label','Functional-area layout simulation');
zoneProgramPreview.innerHTML='<h2>Functional-area simulation</h2><p>Same site · zoning sketch, not an approved floor plan. Blue blocks = workstations; coloured blocks = rooms and shared areas.</p><div class="zone-program-pair"><div class="zone-program-map"><b>Current plan</b><div id="zoneProgramBeforeMap"></div><small id="zoneProgramBeforeSummary"></small></div><div class="zone-program-map"><b>With these changes</b><div id="zoneProgramAfterMap" class="empty">Change a field to see where the areas may fit.</div><small id="zoneProgramAfterSummary"></small></div></div><div class="zone-program-legend"><span style="--swatch:#bfdbfe">Work area</span><span style="--swatch:#bbf7d0">Meeting</span><span style="--swatch:#ddd6fe">Office</span><span style="--swatch:#fde68a">Shared area</span><span style="--swatch:#cbd5e1">Walkway</span></div><p id="zoneProgramPreviewStatus" role="status">The current plan will not change until you save.</p>';
for(const child of [...zoneProgramForm.children])if(child.classList.contains('zone-program-grid')||child.classList.contains('zone-program-switches')||child.classList.contains('zone-program-details')||child.classList.contains('zone-program-note'))zoneProgramControls.append(child);
zoneProgramLayout.append(zoneProgramControls,zoneProgramPreview);zoneProgramForm.insertBefore(zoneProgramLayout,$('#zoneProgramChange'));

let zoneProgramOriginal=null,zoneProgramBaseFingerprint='',zoneProgramPreviewTimer=null;
const zoneProgramCopy=value=>JSON.parse(JSON.stringify(value));
const zoneProgramFingerprint=()=>JSON.stringify({broker:P.broker,activeDraft:P.activeDraft,drafts:P.drafts?.map(draft=>draft.id),objects:P.objects,furniture:P.furniture,workAreas:P.workAreas,site:P.site});
const zoneProgramManagedRule=(rule,kind)=>{const target=placementTarget(rule);return kind==='reception'?rule.rule==='entrance'&&target?.kind==='reception':rule.rule==='window'&&target?.kind==='office'&&!target.role};
const zoneProgramRuleValue=(brief,kind)=>brief.relations?.find(rule=>zoneProgramManagedRule(rule,kind))?.priority||'none';
const zoneProgramNumber=(input,label,min,max)=>{const raw=input.value.trim();if(!/^\d+$/.test(raw)||Number(raw)<min||Number(raw)>max)throw Error(`${label} must be a whole number from ${min} to ${max}.`);return Number(raw)};

function zoneProgramExtraRow(item={},sizeMode='suggest'){
  const key=item.id||id(),options=Object.entries(extraSpaceKinds).map(([kind,label])=>`<option value="${kind}" ${item.kind===kind?'selected':''}>${esc(label)}</option>`).join('');
  return `<div class="zone-program-extra" data-program-extra-id="${esc(key)}"><select data-program-extra="kind" aria-label="Room type">${options}</select><input data-program-extra="count" type="number" min="1" max="30" step="1" value="${Number(item.count)||1}" aria-label="Quantity"><input data-program-extra="seats" type="number" min="0" max="100" step="1" value="${Number(item.seats)||0}" aria-label="Seats each"><select data-program-extra="priority" aria-label="Requirement priority"><option value="must" ${item.priority!=='preferred'?'selected':''}>Required</option><option value="preferred" ${item.priority==='preferred'?'selected':''}>Preferred target</option></select><select data-program-extra="size" aria-label="Size flexibility"><option value="suggest" ${sizeMode!=='fixed'?'selected':''}>Flexible size</option><option value="fixed" ${sizeMode==='fixed'?'selected':''}>Fixed size</option></select><button class="btn" type="button" data-program-remove="extra">Remove</button></div>`;
}
function openZoneProgram(){
  if(readOnly||!P.broker||!P.drafts?.length)return;
  zoneProgramOriginal=zoneProgramCopy(P.broker);
  zoneProgramBaseFingerprint=zoneProgramFingerprint();
  const form=$('#zoneProgramForm');
  for(const field of zoneProgramFields)form.querySelector(`[data-program-field="${field.key}"]`).value=zoneProgramOriginal[field.key];
  for(const [key] of zoneProgramBooleans)form.querySelector(`[data-program-bool="${key}"]`).checked=!!zoneProgramOriginal[key];
  $('#zoneProgramExtraRows').innerHTML=(zoneProgramOriginal.extraSpaces||[]).map((item,index)=>{const key=item.id||`extra-${index}`;return zoneProgramExtraRow({...item,id:key},zoneProgramOriginal.spaceSizing?.[key]?.mode)}).join('');
  $('#zoneProgramWorkRows').innerHTML=(zoneProgramOriginal.workAreas||[]).map(workAreaRow).join('');
  $('#zoneProgramReceptionRule').value=zoneProgramRuleValue(zoneProgramOriginal,'reception');
  $('#zoneProgramOfficeRule').value=zoneProgramRuleValue(zoneProgramOriginal,'office');
  for(const [key] of zoneProgramSizeKinds)form.querySelector(`[data-program-size="base-${key}"]`).value=zoneProgramOriginal.spaceSizing?.[`base-${key}`]?.mode==='fixed'?'fixed':'suggest';
  $('#zoneProgramError').textContent='';$('#zoneProgramChange').textContent='Changes remain a draft until you save.';
  zoneProgramRenderCurrent();
  $('#zoneProgramModal').hidden=false;
}
function closeZoneProgram(){clearTimeout(zoneProgramPreviewTimer);$('#zoneProgramModal').hidden=true;zoneProgramOriginal=null;zoneProgramBaseFingerprint=''}

function collectZoneProgram(){
  const form=$('#zoneProgramForm'),next=zoneProgramCopy(zoneProgramOriginal);
  for(const field of zoneProgramFields)next[field.key]=zoneProgramNumber(form.querySelector(`[data-program-field="${field.key}"]`),field.label,field.min,field.max);
  for(const [key] of zoneProgramBooleans)next[key]=form.querySelector(`[data-program-bool="${key}"]`).checked;
  if(next.offices<(Number(next.officeRoles?.executive)||0)+(Number(next.officeRoles?.director)||0))throw Error('Private-office total cannot be below executive plus director offices. Change their role breakdown in the full needs editor.');
  next.extraSpaces=[...$('#zoneProgramExtraRows').querySelectorAll('[data-program-extra-id]')].map(row=>{
    const kind=row.querySelector('[data-program-extra="kind"]').value,label=extraSpaceKinds[kind]||kind,count=zoneProgramNumber(row.querySelector('[data-program-extra="count"]'),`${label} quantity`,1,30),seats=zoneProgramNumber(row.querySelector('[data-program-extra="seats"]'),`${label} seats`,0,100),capacity=extraRoomSpecs[kind]?.capacity;
    if(!extraSpaceKinds[kind]||!extraRoomSpecs[kind])throw Error(`The ${label} template is not supported by the current planner.`);
    if(seats&&Number.isFinite(capacity)&&seats>capacity)throw Error(`${label} supports at most ${capacity} seats per room in this MVP.`);
    return {id:row.dataset.programExtraId,kind,count,seats,priority:row.querySelector('[data-program-extra="priority"]').value==='preferred'?'preferred':'must'};
  });
  if(new Set(next.extraSpaces.map(item=>item.id)).size!==next.extraSpaces.length)throw Error('Additional rooms need distinct IDs. Remove and recreate a duplicate row.');
  next.workAreas=[...$('#zoneProgramWorkRows').querySelectorAll('[data-work-area-id]')].map(row=>({id:row.dataset.workAreaId,name:row.querySelector('[data-work-area="name"]').value.trim(),activity:row.querySelector('[data-work-area="activity"]').value,targetDesks:Number(row.querySelector('[data-work-area="targetDesks"]').value),minimumDesks:row.querySelector('[data-work-area="minimumDesks"]').value===''?null:Number(row.querySelector('[data-work-area="minimumDesks"]').value),priority:row.querySelector('[data-work-area="priority"]').value}));
  const workIssue=workAreaIssue(next.workAreas,next.people);if(workIssue)throw Error(workIssue);
  const workIds=new Set(next.workAreas.map(area=>area.id));
  if((next.relations||[]).some(rule=>(rule.fromId&&!workIds.has(rule.fromId))||(rule.toId&&!workIds.has(rule.toId))))throw Error('A removed team area is still used by a relationship. Edit that relationship in the full needs editor first.');
  const managed=(next.relations||[]).filter(rule=>zoneProgramManagedRule(rule,'reception')||zoneProgramManagedRule(rule,'office'));
  next.relations=(next.relations||[]).filter(rule=>!managed.includes(rule));
  for(const [kind,selector,from,rule] of [['reception','#zoneProgramReceptionRule','Reception','entrance'],['office','#zoneProgramOfficeRule','Office','window']]){
    const priority=$(selector).value;if(priority==='none')continue;
    if(kind==='reception'&&!next.reception||kind==='office'&&!next.offices)throw Error(`Request ${kind==='reception'?'reception':'a private office'} before assigning its location preference.`);
    next.relations.push({id:managed.find(item=>zoneProgramManagedRule(item,kind))?.id||id(),from,rule,to:'',priority});
  }
  next.spaceSizing={...(next.spaceSizing||{})};
  for(const [key] of zoneProgramSizeKinds)next.spaceSizing[`base-${key}`]={mode:form.querySelector(`[data-program-size="base-${key}"]`).value==='fixed'?'fixed':'suggest'};
  for(const row of $('#zoneProgramExtraRows').querySelectorAll('[data-program-extra-id]'))next.spaceSizing[row.dataset.programExtraId]={mode:row.querySelector('[data-program-extra="size"]').value==='fixed'?'fixed':'suggest'};
  for(const item of zoneProgramOriginal.extraSpaces||[])if(!next.extraSpaces.some(space=>space.id===item.id))delete next.spaceSizing[item.id];
  for(const key of ['pantry','reception'])if(next[key]!==zoneProgramOriginal[key]&&next.suggestedZones?.[key])next.suggestedZones[key]=next[key]?'accepted':'removed';
  finalizeIntakeAnswers(next,zoneProgramOriginal);
  if(next.meetingRooms>0)next.intakeAnswers.roomSeats='requested';
  return normalizeBrokerBrief(next);
}
function zoneProgramSignature(brief){
  const extras=(brief.extraSpaces||[]).map((item,index)=>({id:item.id||`extra-${index}`,kind:item.kind,count:Number(item.count)||0,seats:Number(item.seats)||0,priority:item.priority==='preferred'?'preferred':'must'}));
  const sizeKeys=[...zoneProgramSizeKinds.map(([key])=>`base-${key}`),...extras.map(item=>item.id)];
  const sizing=Object.fromEntries(sizeKeys.map(key=>[key,brief.spaceSizing?.[key]?.mode==='fixed'?'fixed':'suggest']));
  const relations=(brief.relations||[]).map(item=>({id:item.id,from:item.from,fromId:item.fromId||'',rule:item.rule,to:item.to||'',toId:item.toId||'',priority:item.priority==='preferred'?'preferred':'must'})).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  return JSON.stringify({fields:Object.fromEntries(zoneProgramFields.map(field=>[field.key,brief[field.key]])),booleans:Object.fromEntries(zoneProgramBooleans.map(([key])=>[key,!!brief[key]])),extras,workAreas:brief.workAreas||[],sizing,relations});
}
function zoneProgramMeasuresSummary(rows){
  const desk=rows.find(row=>row.name==='Workstations'),short=rows.filter(row=>row.shortfall);
  const seated=desk?`Workstations ${desk.actual}/${desk.required}`:'Workstations not assessed';
  return `${seated}${short.length?` · Still short: ${short.slice(0,3).map(row=>`${row.name} ${row.shortfall}`).join(' · ')}${short.length>3?` · +${short.length-3} more`:''}`:' · Counted needs placed'}`;
}
function zoneProgramRenderCurrent(){
  const active=P.drafts.find(draft=>draft.id===P.activeDraft),current={objects:P.objects,furniture:P.furniture,workAreas:P.workAreas,layoutPattern:active?.layoutPattern,corridorShift:active?.corridorShift,meta:active?.meta||{requested:P.broker.people}};
  $('#zoneProgramBeforeMap').innerHTML=functionalZoneDiagram(current);
  $('#zoneProgramBeforeSummary').textContent=zoneProgramMeasuresSummary(comparisonMeasures(current.objects,current.furniture,current.meta,current.workAreas));
  $('#zoneProgramAfterMap').className='empty';$('#zoneProgramAfterMap').textContent='Change a field to see where the areas may fit.';
  $('#zoneProgramAfterSummary').textContent='';$('#zoneProgramPreviewStatus').textContent='The current plan will not change until you save.';
}
function zoneProgramRenderDraftPreview(){
  if(!zoneProgramOriginal||$('#zoneProgramModal').hidden)return;
  const map=$('#zoneProgramAfterMap'),summary=$('#zoneProgramAfterSummary'),status=$('#zoneProgramPreviewStatus');
  try{
    if(zoneProgramFingerprint()!==zoneProgramBaseFingerprint)throw Error('The current plan changed. Reopen this editor to preview the latest version.');
    const next=collectZoneProgram();
    if(zoneProgramSignature(next)===zoneProgramSignature(zoneProgramOriginal)){map.className='empty';map.textContent='No changes yet.';summary.textContent='';status.textContent='The current plan remains unchanged.';return}
    if(!siteReadiness().ready)throw Error('Confirm the entrance and exit before previewing a layout.');
    const original=P,mode=next.mode||'hybrid',patterns=['spine','core','perimeter','neighborhood'];
    let result;
    try{
      P={...original,broker:next};
      const candidates=patterns.map(pattern=>concept(pattern,next.people,next.meetingRooms*next.roomSeats,next.phones,mode==='private'?'private':'hybrid'));
      candidates.sort((a,b)=>draftScore(a,next,mode)-draftScore(b,next,mode)||patterns.indexOf(a.layoutPattern)-patterns.indexOf(b.layoutPattern));
      const best=candidates[0],rows=comparisonMeasures(best.objects,best.furniture,best.meta,best.workAreas||[]);
      result={diagram:functionalZoneDiagram(best),label:best.label,summary:zoneProgramMeasuresSummary(rows)};
    }finally{P=original}
    map.className='';map.innerHTML=result.diagram;summary.textContent=`${result.label} · ${result.summary}`;
    status.textContent='Preview only: the planner re-ran all areas and furniture on this site. Saving regenerates A/B/C; the final layout may be a different option.';
  }catch(error){map.className='empty';map.textContent='Preview unavailable until the needs are valid.';summary.textContent='';status.textContent=error.message||'Check the entered needs.'}
}
function zoneProgramSchedulePreview(){
  clearTimeout(zoneProgramPreviewTimer);$('#zoneProgramPreviewStatus').textContent='Updating simulation…';
  zoneProgramPreviewTimer=setTimeout(zoneProgramRenderDraftPreview,350);
}
function zoneProgramSnapshot(project){return Object.fromEntries(zoneProgramRestoreKeys.map(key=>[key,zoneProgramCopy(project[key]??null)]))}
function validZoneProgramRestore(previous){return !!previous?.broker&&Array.isArray(previous.drafts)&&Array.isArray(previous.objects)&&Array.isArray(previous.furniture)&&Array.isArray(previous.workAreas)&&previous.site&&typeof previous.site==='object'}
function renderZoneProgram(){
  const ready=!!P.broker&&!!P.drafts?.length&&!readOnly;
  $('#zoneProgramOpen').hidden=!ready;
  $('#zoneProgramRestoreBar').hidden=!ready||!validZoneProgramRestore(P.zoneProgramPrevious);
}

$('#zoneProgramOpen').onclick=openZoneProgram;
$('#zoneProgramCancel').onclick=closeZoneProgram;
$('#zoneProgramDetailed').onclick=()=>{closeZoneProgram();showBrokerIntake(true)};
$('#zoneProgramAddExtra').onclick=()=>{$('#zoneProgramExtraRows').insertAdjacentHTML('beforeend',zoneProgramExtraRow());$('#zoneProgramExtraRows').lastElementChild.querySelector('select').focus();zoneProgramSchedulePreview()};
$('#zoneProgramAddWork').onclick=()=>{if($('#zoneProgramWorkRows').children.length>=3)return;$('#zoneProgramWorkRows').insertAdjacentHTML('beforeend',workAreaRow());$('#zoneProgramWorkRows').lastElementChild.querySelector('input').focus();zoneProgramSchedulePreview()};
$('#zoneProgramForm').onclick=event=>{const button=event.target.closest('[data-program-remove]');if(button){button.parentElement.remove();zoneProgramSchedulePreview()}};
$('#zoneProgramForm').oninput=$('#zoneProgramForm').onchange=()=>{$('#zoneProgramError').textContent='';$('#zoneProgramChange').textContent='Changes are still a draft. Saving will replace the current A/B/C with newly generated plans.';zoneProgramSchedulePreview()};
$('#zoneProgramForm').onsubmit=event=>{
  event.preventDefault();if(readOnly||!zoneProgramOriginal)return;
  try{
    if(zoneProgramFingerprint()!==zoneProgramBaseFingerprint)throw Error('The current plan changed while this form was open. Close and reopen customization before saving.');
    const next=collectZoneProgram();if(zoneProgramSignature(next)===zoneProgramSignature(zoneProgramOriginal)){closeZoneProgram();return}
    if(!siteReadiness().ready)throw Error('Confirm an entrance and exit before regenerating layouts.');
    if(currentPlanEdited()&&!confirm('Regenerating replaces edits on the current plan. A restore snapshot will be kept. Continue?'))return;
    const previous=zoneProgramSnapshot(P),rollback=zoneProgramCopy(P);snapshot();
    try{
      P.broker=next;P.zoneProgramPrevious=previous;syncBrokerBrief();generateDrafts();history.pop();P.site=zoneProgramCopy(previous.site);save();
      if(P.draftsStale||!P.drafts?.length)throw Error('New A/B/C layouts were not generated.');
      closeZoneProgram();
    }catch(error){P=normalizeProject(rollback);syncBrokerBrief();save();throw error}
  }catch(error){$('#zoneProgramError').textContent=error.message||'Could not update functional areas.'}
};
$('#zoneProgramRestore').onclick=()=>{
  const previous=P.zoneProgramPrevious;if(readOnly||!validZoneProgramRestore(previous))return;
  if(!confirm('Restore the previous customer needs and plan? This replaces edits made after customization.'))return;
  snapshot();for(const key of zoneProgramRestoreKeys)P[key]=zoneProgramCopy(previous[key]??null);
  P.zoneProgramPrevious=null;selected=null;syncBrokerBrief();save();
};
const renderBeforeZoneProgram=render;render=function(){renderBeforeZoneProgram();renderZoneProgram()};render();
