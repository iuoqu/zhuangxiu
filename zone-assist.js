/* Optional AI-guided layout intentions. The model never writes geometry or customer needs. */
let zoneAssistMode=window.ZONE_ASSIST_MODE==='api'||P.zoneAssist?.source==='api'?'api':'mock';
let zoneAssistBusy=false,zoneAssistPreview=null,zoneAssistNotice='';
$('#comparisonPanel').insertAdjacentHTML('afterend',`<section id="zoneAssist" class="zone-assist" aria-label="Layout change assistant" hidden><details id="zoneAssistDetails"><summary>Try a layout change · rule-based demo</summary><p>Describe one change to an existing area. The planner tests it against the full layout; nothing applies until you choose Use. To add, remove or resize the customer-area list, choose Customize areas above.</p><div id="zoneAssistHistory" class="zone-assist-history"></div><div class="zone-assist-form"><label for="zoneAssistText">What should change?<textarea id="zoneAssistText" maxlength="500" placeholder="e.g. 把茶水间缩小一点，多留工位 / Move reception closer to the entrance"></textarea></label><label>Suggestion source<select id="zoneAssistSource"><option value="mock">Rule-based demo · no AI</option><option value="api">AI service</option></select></label><label class="zone-assist-pin" hidden>Access code<input id="zoneAssistPin" type="password" autocomplete="off"></label><button type="button" class="btn primary" id="zoneAssistAsk">Test this idea</button></div><div id="zoneAssistStatus" class="zone-assist-status" role="status"></div><div id="zoneAssistResults" class="zone-assist-results"></div></details></section>`);
$('#zoneAssistSource').value=zoneAssistMode;

function zoneAssistTargets(base){
  const counts=new Map(),result=[];
  for(const space of base.objects.filter(item=>item.generated&&['room','zone'].includes(item.type)&&item.spaceKey)){
    const count=(counts.get(space.name||space.kind)||0)+1;counts.set(space.name||space.kind,count);
    const contract=spaceConstraint(P.broker,space.requirementId,space.kind,space.plannedSeats||space.capacity,space.door?.side);
    result.push({key:space.spaceKey,label:`${space.name||space.kind} ${count}`,type:space.type,kind:space.kind,adjustable:contract.mode==='suggest'});
  }
  for(const area of base.workAreas||[])if(!area.generic&&[area.x,area.y,area.x2,area.y2].every(Number.isFinite))result.push({key:`work-area:${area.id}`,label:area.name,type:'workArea',kind:'workArea',adjustable:false});
  return result.slice(0,40);
}
function zoneAssistTarget(draft,key){return key.startsWith('work-area:')?(draft.workAreas||[]).find(area=>area.id===key.slice(10)):draft.objects.find(item=>item.spaceKey===key&&['room','zone'].includes(item.type))}
function zoneAssistMarkers(){return {entrance:P.objects.some(item=>item.type==='door'),window:P.objects.some(item=>item.type==='window')}}
function zoneAssistAllowed(intent,targets,markers){const target=targets.find(item=>item.key===intent?.targetKey);if(!target||!['compact','near_entrance','near_window'].includes(intent.action))return false;if(intent.action==='compact')return target.type!=='workArea'&&target.adjustable;if(intent.action==='near_entrance')return markers.entrance;return markers.window}
function mockZoneIntent(text,targets,markers,previousTargetKey=null){
  const lower=text.toLowerCase(),chinese=/[\u4e00-\u9fff]/.test(text),compact=/缩小|压缩|紧凑|小一点|compact|shrink|smaller|reduce size/i.test(text),window=/靠窗|窗边|近窗|window/i.test(text),entrance=/靠门|靠近门|靠入口|近入口|入口附近|entrance|front door/i.test(text);
  const action=compact?'compact':window?'near_window':entrance?'near_entrance':null;
  const aliases={reception:/前台|接待|reception/i,office:/办公室|总经理室|总监室|office/i,meeting:/会议室|meeting/i,pantry:/茶水间|茶水|pantry/i,coffee:/吧台|咖啡|coffee/i,dining:/用餐|吃饭|餐区|dining/i,lounge:/休闲|沙发|lounge/i,workArea:/工作区|团队区|研发区|销售区|work area|team area/i};
  let target=targets.filter(item=>lower.includes(item.label.toLowerCase())).sort((a,b)=>b.label.length-a.label.length)[0];
  if(!target)target=targets.find(item=>aliases[item.kind]?.test(text));
  if(!target&&selected){const object=find(selected);target=targets.find(item=>item.key===(object?.type==='workArea'?`work-area:${object.id}`:object?.spaceKey))}
  if(!target&&previousTargetKey)target=targets.find(item=>item.key===previousTargetKey);
  if(!target&&targets.length===1)target=targets[0];
  const reply=!action?(chinese?'请说明想缩小哪个区，或要让它靠近入口／窗户。':'Say which area to make compact or move closer to the entrance/window.')
    :!target?(chinese?'请指出当前图上已有的功能区；不会凭空添加或猜测对象。':'Name or select an existing area on this plan.')
    :action==='near_window'&&!markers.window?(chinese?'场地还没有标记窗户，无法验证靠窗。':'Mark a window on the site before asking for a window preference.')
    :action==='near_entrance'&&!markers.entrance?(chinese?'场地还没有标记入口，无法验证靠入口。':'Mark an entrance before asking for an entrance preference.')
    :action==='compact'&&!target.adjustable?(chinese?'这个功能区尺寸已固定，不能尝试紧凑版。':'That area has a fixed size and cannot use a compact template.')
    :(chinese?'已理解这个调整方向，正在用完整排布检查。':'I found a layout direction to test with the complete planner.');
  const intent=target&&action?{targetKey:target.key,action,reason:text.slice(0,180)}:null;
  return {reply,intents:intent&&zoneAssistAllowed(intent,targets,markers)?[intent]:[]};
}
function zoneAssistRows(draft){return comparisonMeasures(draft.objects,draft.furniture,draft.meta,draft.workAreas||[])}
function zoneAssistSummary(draft){const rows=zoneAssistRows(draft),stations=rows.find(row=>row.name==='Workstations');return {requestedWorkstations:stations?.required||0,placedWorkstations:stations?.actual||0,shortfalls:rows.filter(row=>row.shortfall).slice(0,10).map(row=>({name:row.name,missing:row.shortfall}))}}
function zoneAssistCandidate(base,intent,shift){return conceptAtShift(base.layoutPattern,base.meta.requested,(+P.broker.meetingRooms||0)*(+P.broker.roomSeats||0),+P.broker.phones||0,base.stationStyle||'hybrid',shift,{compactSpaceKey:intent.action==='compact'?intent.targetKey:null,intent})}
function zoneAssistValid(base,candidate,intent){
  const beforeTarget=zoneAssistTarget(base,intent.targetKey),afterTarget=zoneAssistTarget(candidate,intent.targetKey);
  if(!beforeTarget||!afterTarget)return null;
  const before=zoneAssistRows(base),after=zoneAssistRows(candidate),beforeGap=before.reduce((n,row)=>n+row.shortfall,0),afterGap=after.reduce((n,row)=>n+row.shortfall,0);
  if(before.some(row=>(after.find(item=>(item.key||item.name)===(row.key||row.name))?.actual??0)<row.actual)||after.some(row=>row.minimum!=null&&row.actual<row.minimum))return null;
  const project={...P,objects:candidate.objects,furniture:candidate.furniture,workAreas:candidate.workAreas||[],drafts:[candidate]},original={...P,objects:base.objects,furniture:base.furniture,workAreas:base.workAreas||[],drafts:[base]};
  if(!candidate.objects.filter(item=>item.type==='room').every(item=>validRoomForAssessment(item,project))||!candidate.objects.filter(item=>item.type==='zone').every(item=>validSharedZone(item,candidate.objects,candidate.furniture)))return null;
  if(!candidate.furniture.every(item=>furnitureHasClearance(item,project)&&islandSpacingValid(item,project)))return null;
  const access=accessReview(project);if(access.status!=='checked'||!access.exitConnected||access.unreachableRooms.length||access.unreachableZones.length||access.unreachableIslands.length)return null;
  if(corridorBottlenecks(project).length>corridorBottlenecks(original).length)return null;
  if(evaluatePlacementRules(project,P.broker).filter(Boolean).some(rule=>rule.priority==='must'&&rule.status==='fail'))return null;
  const savedArea=intent.action==='compact'?rect(beforeTarget).w*rect(beforeTarget).h-rect(afterTarget).w*rect(afterTarget).h:0;
  const marker=intent.action==='near_window'?'window':'door',oldDistance=intent.action==='compact'?null:markerDistance(marker,beforeTarget),newDistance=intent.action==='compact'?null:markerDistance(marker,afterTarget);
  if(intent.action==='compact'&&(afterTarget.sizeVariant!=='compact'||savedArea<=0||afterGap>=beforeGap))return null;
  if(intent.action!=='compact'&&(oldDistance==null||newDistance==null||oldDistance-newDistance<150))return null;
  if(beforeTarget.plannedSeats!=null&&afterTarget.plannedSeats<beforeTarget.plannedSeats||beforeTarget.capacity!=null&&afterTarget.capacity<beforeTarget.capacity)return null;
  return {beforeGap,afterGap,savedArea,oldDistance,newDistance,workstationsBefore:before.find(row=>row.name==='Workstations')?.actual||0,workstationsAfter:after.find(row=>row.name==='Workstations')?.actual||0,remaining:after.filter(row=>row.shortfall).map(row=>`${row.name} ${row.shortfall}`)};
}
function buildZoneAssistCandidates(base,rawIntents,targets=zoneAssistTargets(base)){
  const markers=zoneAssistMarkers(),offsets=[base.corridorShift||{x:0,y:0},...corridorVariants(base.layoutPattern)],unique=new Set(),ideas=[];
  for(const intent of (Array.isArray(rawIntents)?rawIntents:[]).slice(0,3)){
    if(!zoneAssistAllowed(intent,targets,markers))continue;
    let best=null;
    for(const shift of offsets){const shiftKey=`${shift.x||0}:${shift.y||0}`;if(unique.has(`${intent.targetKey}:${intent.action}:${shiftKey}`))continue;unique.add(`${intent.targetKey}:${intent.action}:${shiftKey}`);
      const draft=zoneAssistCandidate(base,intent,shift),metrics=zoneAssistValid(base,draft,intent);if(!metrics)continue;
      const score=intent.action==='compact'?(metrics.beforeGap-metrics.afterGap)*1000+metrics.savedArea/1e6:(metrics.oldDistance-metrics.newDistance)/1000+(metrics.beforeGap-metrics.afterGap)*100;
      if(!best||score>best.score)best={id:id(),intent:{targetKey:intent.targetKey,action:intent.action,reason:String(intent.reason||'').slice(0,180)},label:targets.find(item=>item.key===intent.targetKey)?.label||'Area',draft,metrics,score};
    }
    if(best)ideas.push(best);
  }
  return ideas.sort((a,b)=>b.score-a.score).slice(0,3);
}
function zoneAssistFingerprint(){return JSON.stringify({activeDraft:P.activeDraft,width:P.w,height:P.h,site:P.site,rules:P.rules,objects:P.objects,furniture:P.furniture,workAreas:P.workAreas,broker:P.broker,stale:P.draftsStale})}
async function askZoneAssistant(){
  const input=$('#zoneAssistText'),text=input.value.trim(),base=P.drafts?.find(d=>d.id===P.activeDraft);
  if(readOnly||!base||P.draftsStale||currentPlanEdited())return;
  if(text.length<2||text.length>500){zoneAssistNotice='Describe one change in 2–500 characters.';renderZoneAssistant();return}
  const targets=zoneAssistTargets(base),markers=zoneAssistMarkers();if(!targets.length){zoneAssistNotice='This plan has no adjustable named area yet.';renderZoneAssistant();return}
  const previousTargetKey=(P.zoneAssistHistory||[]).at(-1)?.targetKey||null,projectRef=P,fingerprint=zoneAssistFingerprint();zoneAssistBusy=true;zoneAssistNotice=zoneAssistMode==='api'?'Asking AI for a planning direction…':'Interpreting the demo request…';renderZoneAssistant();
  try{
    let result;
    if(zoneAssistMode==='api'){
      const response=await fetch('/api/suggest-zone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,pin:$('#zoneAssistPin').value,targets,markers,previousTargetKey,summary:zoneAssistSummary(base)})});
      result=await response.json();if(!response.ok)throw Error(result.error||'Could not get a suggestion');
    }else result=mockZoneIntent(text,targets,markers,previousTargetKey);
    if(P!==projectRef||zoneAssistFingerprint()!==fingerprint){zoneAssistNotice='The plan changed while the suggestion was being prepared. Ask again on the current plan.';return}
    const ideas=buildZoneAssistCandidates(base,result.intents,targets);
    P.zoneAssist={sourceDraftId:base.id,sourceFingerprint:fingerprint,source:zoneAssistMode,request:text,reply:String(result.reply||'').slice(0,240),ideas,acceptedId:null};
    const targetKey=result.intents?.find(intent=>zoneAssistAllowed(intent,targets,markers))?.targetKey||previousTargetKey;
    P.zoneAssistHistory=[...(P.zoneAssistHistory||[]),{request:text,reply:P.zoneAssist.reply,targetKey,source:zoneAssistMode}].slice(-6);
    zoneAssistPreview=null;zoneAssistNotice=ideas.length?'':result.intents?.length?'No safe improvement was found for this request. The original plan is unchanged.':String(result.reply||'No supported area change was found.').slice(0,240);
    save();
  }catch(error){zoneAssistNotice=error.message||'Could not prepare a suggestion';$('#zoneAssistStatus').classList.add('error')}
  finally{zoneAssistBusy=false;renderZoneAssistant()}
}
function renderZoneAssistant(){
  const panel=$('#zoneAssist'),base=P.drafts?.find(d=>d.id===P.activeDraft),ready=!!P.broker&&!!base&&!P.draftsStale;panel.hidden=!ready;if(!ready)return;
  const state=P.zoneAssist?.sourceDraftId===base.id?P.zoneAssist:null,edited=currentPlanEdited(),status=$('#zoneAssistStatus'),results=$('#zoneAssistResults'),button=$('#zoneAssistAsk');
  $('#zoneAssistDetails > summary').textContent=zoneAssistMode==='api'?'Ask AI to adjust a functional area':'Try a layout change · rule-based demo';
  $('#zoneAssistSource').value=zoneAssistMode;$('#zoneAssistSource').disabled=readOnly||edited||zoneAssistBusy;$('#zoneAssistPin').closest('label').hidden=zoneAssistMode!=='api';
  $('#zoneAssistHistory').innerHTML=(P.zoneAssistHistory||[]).slice(-2).map(turn=>`<p><b>You:</b> ${esc(turn.request)}<br><b>${turn.source==='api'?'AI':'Demo'}:</b> ${esc(turn.reply)}</p>`).join('');
  button.disabled=readOnly||edited||zoneAssistBusy;$('#zoneAssistText').disabled=readOnly||edited||zoneAssistBusy;$('#zoneAssistPin').disabled=readOnly||edited||zoneAssistBusy;
  status.classList.toggle('error',/Could not|changed while|no safe|No safe|cannot|can't/i.test(zoneAssistNotice));
  status.textContent=edited&&!state?.acceptedId?'Current plan was edited. Reopen its A/B/C snapshot before testing another idea.':zoneAssistNotice||state?.reply||'';
  if(!state){results.innerHTML='';return}
  if(state.acceptedId){results.innerHTML='<div class="zone-assist-card"><b>Suggested layout applied to the current plan</b><p>The original A/B/C snapshot and customer requirements are unchanged.</p><button type="button" class="btn" id="zoneAssistRestore" '+(readOnly?'disabled':'')+'>Restore original A/B/C plan</button></div>';$('#zoneAssistRestore').onclick=()=>{if(readOnly||!confirm('Restore the original A/B/C snapshot? This replaces current manual edits.'))return;snapshot();P.objects=structuredClone(base.objects);P.furniture=structuredClone(base.furniture);P.workAreas=structuredClone(base.workAreas||[]);P.zoneAssist.acceptedId=null;selected=null;save()};return}
  if(edited){results.innerHTML='';return}
  results.innerHTML=(state.ideas||[]).map((idea,index)=>{const shown=zoneAssistPreview===idea.id,metric=idea.metrics,action=idea.intent.action==='compact'?`${(metric.savedArea/1e6).toFixed(1)} m² released · counted gap ${metric.beforeGap} → ${metric.afterGap}`:`${idea.intent.action==='near_window'?'Window':'Entrance'} distance ${(metric.oldDistance/1000).toFixed(1)} → ${(metric.newDistance/1000).toFixed(1)} m`,remaining=metric.remaining.length?`Still needed: ${metric.remaining.slice(0,2).join(' · ')}${metric.remaining.length>2?' · more':''}`:'Counted needs met';return `<article class="zone-assist-card"><b>${index===0?'Recommended · ':''}${esc(idea.label)} · ${esc(idea.intent.action.replaceAll('_',' '))}</b><p>${esc(action)} · workstations ${metric.workstationsBefore} → ${metric.workstationsAfter}</p><p>${esc(remaining)}</p><details><summary>Why and limits</summary><p>${esc(idea.intent.reason)}. This is a concept geometry and furniture screen, not code approval.</p></details><div class="actions"><button type="button" class="btn" data-zone-preview="${esc(idea.id)}">${shown?'Hide preview':'Preview'}</button><button type="button" class="btn" data-zone-manual="${esc(idea.id)}">Adjust myself</button><button type="button" class="btn primary" data-zone-apply="${esc(idea.id)}" ${readOnly?'disabled':''}>Use option</button></div>${shown?`<div class="zone-assist-preview"><div><small>Original</small>${comparisonThumbnail(base)}</div><div><small>Suggested</small>${comparisonThumbnail(idea.draft)}</div></div>`:''}</article>`}).join('');
  const cards=[...results.querySelectorAll(':scope > .zone-assist-card')];if(cards.length>1){const more=document.createElement('details');more.className='zone-assist-more';more.innerHTML=`<summary>${cards.length-1} other checked option${cards.length===2?'':'s'}</summary>`;cards.slice(1).forEach(card=>more.append(card));results.append(more)}
  results.querySelectorAll('[data-zone-preview]').forEach(control=>control.onclick=()=>{zoneAssistPreview=zoneAssistPreview===control.dataset.zonePreview?null:control.dataset.zonePreview;renderZoneAssistant()});
  results.querySelectorAll('[data-zone-manual]').forEach(control=>control.onclick=()=>{const idea=state.ideas.find(item=>item.id===control.dataset.zoneManual),target=idea&&zoneAssistTarget({objects:P.objects,workAreas:P.workAreas},idea.intent.targetKey);if(!target)return;zoneAssistNotice='Target highlighted. Move it or edit its size in the plan editor; nearby furniture is not automatically rearranged.';focusPlanTarget(target.id);renderZoneAssistant()});
  results.querySelectorAll('[data-zone-apply]').forEach(control=>control.onclick=()=>{if(readOnly||currentPlanEdited()||P.activeDraft!==state.sourceDraftId||zoneAssistFingerprint()!==state.sourceFingerprint){zoneAssistNotice='The plan changed. Ask again before using this option.';renderZoneAssistant();return}const idea=state.ideas.find(item=>item.id===control.dataset.zoneApply);if(!idea)return;snapshot();P.objects=structuredClone(idea.draft.objects);P.furniture=structuredClone(idea.draft.furniture);P.workAreas=structuredClone(idea.draft.workAreas||[]);P.zoneAssist.acceptedId=idea.id;selected=null;zoneAssistNotice='';save()});
}
$('#zoneAssistAsk').onclick=askZoneAssistant;
$('#zoneAssistSource').onchange=event=>{if(readOnly||currentPlanEdited())return;zoneAssistMode=event.target.value==='api'?'api':'mock';zoneAssistNotice='';P.zoneAssist=null;P.zoneAssistHistory=[];save()};
$('#zoneAssistText').addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();askZoneAssistant()}});
const renderBeforeZoneAssist=render;render=function(){renderBeforeZoneAssist();renderZoneAssistant()};render();
