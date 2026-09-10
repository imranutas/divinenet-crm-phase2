"use strict";
// Shared API-backed workspace. Legacy browser records are not silently imported.
const $ = id => document.getElementById(id);
const state = { campaigns:[], leads:[], clients:[], brands:[], analytics:null, ai:null, ready:false, route:"dashboard", studioCampaign:"", studioPrompt:"" };
const channels = ["Facebook","Instagram","LinkedIn","Website"];
const statuses = ["Draft","Active","Paused","Completed"];
const stages = ["New","Contacted","Qualified"];
let loadVersion=0, editing=null, saving=false, objectUrl=null;

function node(tag, text, className) {
  const element=document.createElement(tag);
  if(text!==undefined && text!==null) element.textContent=String(text);
  if(className) element.className=className;
  return element;
}
function button(text, handler, className="secondary small-button") {
  const element=node("button",text,className); element.type="button";
  element.addEventListener("click",handler); return element;
}
function link(text, href) {const element=node("a",text);element.href=href;return element;}
function badge(value) {
  const cls=["Active","Qualified","Approved","Draft","New","Contacted","Paused"].includes(value)?value.toLowerCase():"";
  return node("span",value,"badge "+cls);
}
function message(id,text) {$(id).textContent=text||"";$(id).hidden=!text;}
async function api(path, {method="GET",body,timeout=15000}={}) {
  let response;
  try {
    response=await fetch("/api"+path,{method,headers:body===undefined?{}:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout),cache:"no-store"});
  } catch {
    throw new Error(method==="GET"?"Cannot reach the backend. Start the review server, then refresh.":"The save could not be confirmed. Your input is retained. Refresh the records before retrying to avoid duplicates.");
  }
  let result;
  try {result=await response.json();} catch {throw new Error("The server returned an unexpected response. No success has been confirmed.");}
  if(!response.ok || result.success===false) throw new Error(result.message||"The request could not be completed.");
  return result.data;
}
const money=value=>value===null||value===undefined?"Not set":new Intl.NumberFormat("en-AU",{style:"currency",currency:"AUD",maximumFractionDigits:2}).format(value);
function parseBudget(value) {
  const text=String(value??"").trim();
  if(!text) return null;
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?[kK]?$/.test(text)) return NaN;
  const result=Number(text.replace(/,/g,"").replace(/[kK]$/,""))*(/[kK]$/.test(text)?1000:1);
  return Number.isFinite(result)&&result<=1e12?Math.round(result*100)/100:NaN;
}
function displayDate(value) {
  if(!value) return "Not set";
  const date=new Date(value+"T00:00:00");
  return Number.isFinite(date.getTime())?date.toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric"}):value;
}
function panel(title) {
  const element=node("section",null,"panel"),head=node("div",null,"panel-head");
  head.append(node("h2",title));element.append(head);return element;
}
function empty(title,description) {
  const element=node("div",null,"empty");element.append(node("h3",title),node("p",description));return element;
}
function field(name,title,{value="",type="text",required=false,options=null,full=false,help="",maxLength=4000}={}) {
  const label=node("label",title+(required?" *":""),full?"full":"");
  const input=node(options?"select":type==="textarea"?"textarea":"input");
  input.id="field-"+name;input.name=name;input.required=required;
  if(options) for(const item of options) {
    const option=node("option",typeof item==="string"?item:item.label);
    option.value=typeof item==="string"?item:item.value;input.append(option);
  } else if(type!=="textarea") input.type=type;
  if(!options && !["date","file","checkbox"].includes(type)) input.maxLength=maxLength;
  input.value=value??"";label.append(input);
  if(help)label.append(node("small",help));return {label,input};
}
function table(headers) {
  const wrap=node("div",null,"table-wrap"),tableElement=node("table"),head=node("thead"),row=node("tr"),body=node("tbody");
  for(const label of headers){const th=node("th",label);th.scope="col";row.append(th);}
  head.append(row);tableElement.append(head,body);wrap.append(tableElement);return {wrap,body};
}
function campaignName(id){return state.campaigns.find(c=>c.id===id)?.campaignName||id;}
async function refresh() {
  const version=++loadVersion;$("refresh").disabled=true;$("connection").textContent="Connecting…";$("view").setAttribute("aria-busy","true");
  try {
    const [campaigns,leads,clients,brands,analytics,ai]=await Promise.all(["/campaigns","/leads","/clients","/brands","/analytics/summary","/ai/status"].map(path=>api(path)));
    if(version!==loadVersion)return;
    Object.assign(state,{campaigns,leads,clients,brands,analytics,ai,ready:true});
    $("connection").textContent="● Database connected";$("connection").className="online";message("global-error","");
    render();
  } catch(error) {
    if(version!==loadVersion)return;
    state.ready=false;$("connection").textContent="Backend unavailable";$("connection").className="";
    message("global-error",error.message);$("view").replaceChildren(empty("Connection needs attention","No sample data or browser-only saves are substituted. Select Refresh data after the server is available."));
    $("primary-action").disabled=true;
  } finally {if(version===loadVersion){$("refresh").disabled=false;$("view").setAttribute("aria-busy","false");}}
}
function render() {
  if(!state.ready)return;
  if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
  const route=location.hash.slice(1);state.route=["campaigns","leads","studio","model"].includes(route)?route:"dashboard";
  const headings={
    dashboard:["Overview","Your marketing, in focus.","Plan campaigns, organise responses and review creative in one place."],
    campaigns:["Campaigns","From a brief to a campaign.","Every record is saved to the shared backend. Search, review and manage your campaigns."],
    leads:["Leads & pipeline","Make every response count.","Capture campaign-linked leads and follow their recorded progress."],
    studio:["Creative studio","Make space for your next idea.","Generate campaign imagery, review each draft and export approved assets."],
    model:["Data model","See how your data connects.","A view of the implemented relationships and the boundaries still awaiting agreement."]
  };
  const [breadcrumb,title,description]=headings[state.route];
  $("breadcrumb").textContent=breadcrumb;$("page-title").textContent=title;$("page-description").textContent=description;
  document.title="Divinenet · "+breadcrumb;
  for(const a of document.querySelectorAll("[data-route]")) {if(a.dataset.route===state.route)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");}
  const primary=$("primary-action");primary.hidden=["studio","model"].includes(state.route);primary.disabled=false;
  primary.textContent=state.route==="leads"?"Add lead ＋":"Create campaign ＋";
  primary.onclick=()=>state.route==="leads"?openLead():openCampaign();
  $("view").replaceChildren();
  ({dashboard:renderDashboard,campaigns:renderCampaigns,leads:renderLeads,studio:renderStudio,model:renderModel})[state.route]();
}
function campaignTable(records,limited=false) {
  if(!records.length)return empty("No campaigns here yet","Create a campaign to start planning. Empty records stay empty.");
  const {wrap,body}=table(["Campaign","Channel","Status","Start","Budget",...(limited?[]:["Actions"])]);
  for(const c of records) {
    const row=node("tr"),title=node("td");title.append(node("strong",c.campaignName),node("small",c.id+(c.client?" · "+c.client:"")));
    const status=node("td");status.append(badge(c.status));
    row.append(title,node("td",c.channel),status,node("td",displayDate(c.startDate)),node("td",money(c.budget)));
    if(!limited) {
      const actions=node("td"),buttons=node("div",null,"row-actions");
      buttons.append(button("View",()=>viewCampaign(c)),button("Edit",()=>openCampaign(c)),button("Delete",event=>removeCampaign(c,event.currentTarget),"danger small-button"));
      actions.append(buttons);row.append(actions);
    }
    const labels=["Campaign","Channel","Status","Start","Budget",...(limited?[]:["Actions"])];
    [...row.children].forEach((cell,index)=>cell.setAttribute("data-label",labels[index]));
    body.append(row);
  }
  return wrap;
}
function renderDashboard() {
  const metrics=node("section",null,"metrics");metrics.setAttribute("aria-label","Stored record summary");
  const active=state.campaigns.filter(c=>c.status==="Active").length,qualified=state.leads.filter(l=>l.stage==="Qualified").length;
  for(const [label,value,caption] of [["Total campaigns",state.campaigns.length,"All stored campaign records"],["Active campaigns",active,"Records marked Active"],["Captured leads",state.leads.length,"Records, not unique customers"],["Qualified leads",qualified,"Development pipeline stage"]]) {
    const card=node("article",null,"metric");card.append(node("span",label,"metric-label"),node("strong",value,"metric-value"),node("small",caption));metrics.append(card);
  }
  const grid=node("div",null,"overview-grid"),recent=panel("Recent campaigns");
  recent.firstChild.append(link("View all campaigns →","#campaigns"));recent.append(campaignTable(state.campaigns.slice(0,5),true));
  const stack=node("div",null,"stack"),pipeline=panel("Lead snapshot");
  for(const stage of stages) {const line=node("div",null,"summary-line");line.append(badge(stage),node("strong",state.leads.filter(l=>l.stage===stage).length));pipeline.append(line);}
  pipeline.append(node("p","Counts reflect all currently stored records. Customer conversion and performance targets are not yet configured.","muted"));
  const studio=panel("Creative, with a review step");studio.append(node("p",state.ai.message,"muted"),link("Open creative studio →","#studio"));
  stack.append(pipeline,studio);grid.append(recent,stack);$("view").append(metrics,grid);
}
function renderCampaigns() {
  const p=panel("Campaign library"),filters=node("div",null,"filters");
  const search=field("campaign-search","Search campaigns",{help:"Search by name, client, brand or ID."});
  const status=field("campaign-status","Status",{value:"All statuses",options:["All statuses",...statuses]});
  filters.append(search.label,status.label);const results=node("div");
  function show() {
    const q=search.input.value.toLowerCase().trim();
    const rows=state.campaigns.filter(c=>(status.input.value==="All statuses"||c.status===status.input.value)&&[c.campaignName,c.client,c.brand,c.id].some(x=>String(x||"").toLowerCase().includes(q)));
    results.replaceChildren(campaignTable(rows));
  }
  search.input.addEventListener("input",show);status.input.addEventListener("change",show);p.append(filters,results);$("view").append(p);show();
}
async function removeCampaign(c,btn) {
  if(!confirm('Delete "'+c.campaignName+'"? Linked leads or assets prevent deletion.'))return;
  btn.disabled=true;
  try {await api("/campaigns/"+encodeURIComponent(c.id),{method:"DELETE"});message("notice","Campaign deleted.");await refresh();}
  catch(error){message("global-error",error.message);btn.disabled=false;}
}
function dialogSetup(title,intro) {
  editing=null;saving=false;$("record-form").reset();$("form-fields").replaceChildren();
  $("editor-title").textContent=title;$("form-intro").textContent=intro;message("form-error","");
  $("save-record").hidden=false;$("save-record").disabled=false;$("cancel-editor").textContent="Cancel";
  $("save-state").textContent="Changes are saved when you select Save.";
}
function presentDialog(){if(!$("editor").open)$("editor").showModal();}
function closeEditor(){
  if(saving)return;
  $("editor").close();editing=null;
}
function openCampaign(c=null) {
  dialogSetup(c?"Edit campaign":"Create campaign","Use a saved client or brand, or add a reusable name. An existing lead can supply its campaign brief without copying personal contact details.");
  editing={kind:"campaign",id:c?.id};const fields=$("form-fields");
  const inputs={};
  function add(name,label,options={}) {const item=field(name,label,{value:c?.[name]??"",...options});fields.append(item.label);inputs[name]=item.input;return item;}
  if(!c) {
    const source=add("sourceLead","Use campaign context from a saved lead",{options:[{value:"",label:"Start with a blank brief"},...state.leads.map(l=>({value:l.id,label:l.id+" · "+campaignName(l.campaignId)}))],full:true,help:"Copies campaign context only. This does not convert, move or merge a lead."});
    let previousSource="", previousContext=null;
    source.input.addEventListener("change",()=>{
      const names=["clientId","brandId","prompt","objective","targetAudience","channel","budget","client","brand"];
      const defaultValue=name=>name==="channel"?"Website":"";
      const edited=names.some(name=>inputs[name].value!==(previousContext?.[name]??defaultValue(name)));
      if(edited&&!confirm("Replace the current campaign context? The campaign name, dates and status will stay unchanged.")){
        source.input.value=previousSource;
        return;
      }
      const lead=state.leads.find(l=>l.id===source.input.value);
      const origin=state.campaigns.find(x=>x.id===lead?.campaignId);
      for(const name of names){
        inputs[name].value=["client","brand"].includes(name)?"":origin?.[name]??defaultValue(name);
        inputs[name].setCustomValidity("");
      }
      for(const kind of ["client","brand"])inputs[kind+"Id"].dispatchEvent(new Event("change"));
      previousSource=source.input.value;
      previousContext=Object.fromEntries(names.map(name=>[name,inputs[name].value]));
    });
  }
  add("campaignName","Campaign name",{required:true,full:true,maxLength:200});
  for(const [kind,label,list] of [["client","Client",state.clients],["brand","Brand",state.brands]]) {
    const selected=add(kind+"Id",label,{options:[{value:"",label:"Not selected"},...list.map(x=>({value:x.id,label:x.name})),{value:"__new__",label:"＋ Add a new "+kind+" name"}]});
    const custom=add(kind,label+" name",{value:"",maxLength:200});
    custom.label.hidden=true;
    selected.input.addEventListener("change",()=>{custom.label.hidden=selected.input.value!=="__new__";custom.input.required=!custom.label.hidden;if(!custom.label.hidden)custom.input.focus();});
  }
  add("prompt","Campaign brief",{type:"textarea",required:true,full:true,help:"Describe the campaign. Nothing here is sent to an AI provider automatically."});
  add("objective","Objective",{type:"textarea"});add("targetAudience","Target audience",{type:"textarea",help:"Use a general description, not a list of personal contact details."});
  add("channel","Channel",{required:true,value:c?.channel||"Website",options:channels});
  add("status","Status",{value:c?.status||"Draft",options:statuses});
  const budget=add("budget","Budget (AUD)",{help:"Examples: 10000, 10,000 or 10k. Blank means not set."});
  budget.input.addEventListener("blur",()=>{
    const value=parseBudget(budget.input.value);budget.input.setCustomValidity(Number.isNaN(value)?"Enter a non-negative amount, such as 10000 or 10k.":"");
    if(value!==null&&!Number.isNaN(value))budget.input.value=String(value);
  });
  budget.input.addEventListener("input",()=>budget.input.setCustomValidity(""));
  add("startDate","Start date",{type:"date",required:true});add("endDate","End date",{type:"date",required:true});
  const schedule=node("p","Select dates to check for overlapping active campaigns.","callout full");fields.append(schedule);
  function overlaps(){
    inputs.endDate.min=inputs.startDate.value;
    if(!inputs.startDate.value||!inputs.endDate.value){
      schedule.textContent="Select dates to check for overlapping active campaigns.";
      return;
    }
    const matches=state.campaigns.filter(x=>x.id!==c?.id&&x.status==="Active"&&x.startDate<=inputs.endDate.value&&x.endDate>=inputs.startDate.value);
    schedule.textContent=matches.length?matches.length+" active campaign(s) overlap these dates: "+matches.map(x=>x.campaignName).join(", ")+". This is a date check, not an AI scheduling recommendation.":"No other active campaigns overlap these dates. This check does not predict campaign performance.";
  }
  inputs.startDate.addEventListener("change",overlaps);inputs.endDate.addEventListener("change",overlaps);overlaps();
  $("save-record").textContent="Save campaign";presentDialog();
}
function viewCampaign(c) {
  dialogSetup(c.campaignName,"Campaign record · "+c.id);$("save-record").hidden=true;$("cancel-editor").textContent="Close";$("save-state").textContent="Read-only view.";
  const details=node("dl",null,"detail-grid full");
  for(const [title,value] of [["Client",c.client||"Not selected"],["Brand",c.brand||"Not selected"],["Brief",c.prompt],["Objective",c.objective||"Not set"],["Audience",c.targetAudience||"Not set"],["Channel",c.channel],["Dates",displayDate(c.startDate)+" – "+displayDate(c.endDate)],["Budget",money(c.budget)],["Status",c.status],["Linked leads",state.leads.filter(l=>l.campaignId===c.id).length]]) {
    const part=node("div");part.append(node("dt",title),node("dd",value));details.append(part);
  }
  const studio=button("Review campaign creative",()=>{state.studioCampaign=c.id;closeEditor();location.hash="studio";});
  $("form-fields").append(details,studio);presentDialog();
}
function openLead(lead=null) {
  if(!state.campaigns.length){message("global-error","Create a campaign before adding a linked lead.");return;}
  dialogSetup(lead?"Edit lead":"Add lead","Use synthetic records for this review. Consent is recorded as supplied; it is not inferred from entering an email.");
  editing={kind:"lead",id:lead?.id};
  const specs=[
    ["campaignId","Campaign",{options:state.campaigns.map(c=>({value:c.id,label:c.id+" · "+c.campaignName})),required:true,full:true}],
    ["name","Name",{required:true,maxLength:200}],["email","Email",{type:"email",required:true,maxLength:254}],
    ["phone","Phone",{type:"tel",maxLength:50}],
    ["sourcePlatform","Source platform",{options:channels,required:true,value:lead?.sourcePlatform||"Website"}],
    ["consentStatus","Consent status",{options:[{value:"",label:"Select recorded consent status"},"Recorded","Not Recorded","Unknown"],required:true,help:"Recorded must reflect a genuine consent record; use synthetic examples here."}]
  ];
  for(const [name,label,options] of specs) $("form-fields").append(field(name,label,{value:lead?.[name]??"",...options}).label);
  $("save-record").textContent="Save lead";presentDialog();
}
$("record-form").addEventListener("submit",async event=>{
  event.preventDefault();if(!editing||saving)return;
  const data=Object.fromEntries(new FormData(event.currentTarget));const current={...editing};
  if(current.kind==="campaign"){
    data.budget=parseBudget(data.budget);
    if(Number.isNaN(data.budget)){message("form-error","Enter a valid budget, such as 10000 or 10k.");return;}
    for(const kind of ["client","brand"]) {
      if(data[kind+"Id"]==="__new__") delete data[kind+"Id"];
      else {data[kind+"Id"]=data[kind+"Id"]||null;delete data[kind];}
    }
    delete data.sourceLead;
  }
  saving=true;$("save-record").disabled=true;$("form-fields").inert=true;$("save-state").textContent="Saving to the database…";message("form-error","");
  try {
    const path=(current.kind==="campaign"?"/campaigns":"/leads")+(current.id?"/"+encodeURIComponent(current.id):"");
    const saved=await api(path,{method:current.id?"PUT":"POST",body:data});
    saving=false;$("form-fields").inert=false;closeEditor();
    message("notice",(current.kind==="campaign"?"Campaign ":"Lead ")+saved.id+" saved to the database.");await refresh();
  } catch(error){message("form-error",error.message);$("save-state").textContent="Save not confirmed. Your input is retained.";}
  finally{saving=false;$("form-fields").inert=false;$("save-record").disabled=false;}
});
function renderLeads() {
  const note=node("div","Development pipeline: New → Contacted → Qualified. Stage transitions are recorded. Scoring policy and Phase 1 conversion are not approved or connected; no lead is marked Converted.","callout warning");$("view").append(note);
  const filters=node("div",null,"filters section-gap"),search=field("lead-search","Search leads"),campaign=field("lead-campaign","Campaign",{options:[{value:"",label:"All campaigns"},...state.campaigns.map(c=>({value:c.id,label:c.campaignName}))]});
  filters.append(search.label,campaign.label);const results=node("div");
  function show() {
    const q=search.input.value.toLowerCase().trim();
    const leads=state.leads.filter(l=>(!campaign.input.value||l.campaignId===campaign.input.value)&&[l.id,l.name,l.email].some(x=>String(x).toLowerCase().includes(q)));
    const pipeline=node("div",null,"pipeline");
    for(const stage of stages){
      const column=node("section",null,"pipeline-column"),rows=leads.filter(l=>l.stage===stage),heading=node("h2",stage);heading.append(node("span",rows.length));column.append(heading);
      if(!rows.length)column.append(node("p","No leads in this stage.","muted"));
      for(const lead of rows) {
        const card=node("article",null,"lead-card");card.append(node("h3",lead.name),node("p",lead.email),node("p",lead.id+" · "+campaignName(lead.campaignId)),badge(lead.sourcePlatform),node("p","Consent: "+lead.consentStatus),button("Edit",()=>openLead(lead)),button("History",()=>viewHistory(lead)));
        const next=stages[stages.indexOf(stage)+1];
        if(next)card.append(button("Move to "+next,event=>advanceLead(lead,next,event.currentTarget)));
        column.append(card);
      }pipeline.append(column);
    }
    results.replaceChildren(pipeline);
  }
  search.input.addEventListener("input",show);campaign.input.addEventListener("change",show);$("view").append(filters,results);show();
}
async function advanceLead(lead,stage,btn){
  if(!confirm("Move "+lead.name+" to "+stage+"? This development transition is recorded in history."))return;
  btn.disabled=true;
  try{await api("/leads/"+encodeURIComponent(lead.id)+"/stage",{method:"PATCH",body:{stage}});message("notice","Lead stage updated and recorded.");await refresh();}
  catch(error){message("global-error",error.message);btn.disabled=false;}
}
async function viewHistory(lead){
  try{
    const history=await api("/leads/"+encodeURIComponent(lead.id)+"/history");
    dialogSetup("Stage history","Recorded transitions for "+lead.id);$("save-record").hidden=true;$("cancel-editor").textContent="Close";$("save-state").textContent="Read-only history.";
    const list=node("div",null,"full");
    if(!history.length)list.append(node("p","No stage changes recorded.","muted"));
    for(const entry of history)list.append(node("p",entry.from_stage+" → "+entry.to_stage+" · "+new Date(entry.changed_at).toLocaleString("en-AU")));
    $("form-fields").append(list);presentDialog();
  }catch(error){message("global-error",error.message);}
}
function renderStudio(){
  const grid=node("div",null,"studio-grid"),brief=panel("Creative brief"),form=node("form",null,"studio-form"),assets=panel("Campaign assets");
  const campaign=field("asset-campaign","Campaign",{required:true,value:state.studioCampaign,options:[{value:"",label:"Select a campaign"},...state.campaigns.map(c=>({value:c.id,label:c.campaignName}))]});
  const prompt=field("asset-prompt","Image prompt",{value:state.studioPrompt,type:"textarea",required:true,help:"Describe the image, style and message. Do not include personal lead or customer information."});
  const provider=node("div",state.ai.message,"callout "+(state.ai.configured?"":"warning"));
  const consent=node("label",null,"checkbox"),check=node("input");check.type="checkbox";check.required=true;check.id="send-consent";
  consent.append(check,node("span","I reviewed this brief and have permission to send it to the configured AI provider. Generation may incur a charge."));
  const generate=node("button","Generate image","primary");generate.type="submit";generate.disabled=!state.ai.configured;
  const error=node("p",null,"callout warning");error.hidden=true;error.setAttribute("role","alert");
  const result=node("div");assets.append(result);let assetVersion=0;
  async function loadAssets(){
    const version=++assetVersion;state.studioCampaign=campaign.input.value;
    result.replaceChildren(empty("Choose a campaign","Its saved image drafts and approved exports will appear here."));
    if(!campaign.input.value)return;
    try{
      const rows=await api("/campaigns/"+encodeURIComponent(campaign.input.value)+"/assets");
      if(version!==assetVersion||!result.isConnected)return;
      if(!rows.length){result.replaceChildren(empty("No saved creative yet","Generate a draft when an approved provider is configured."));return;}
      const cards=node("div",null,"assets-grid");
      for(const asset of rows){
        const card=node("article",null,"asset-card"),image=node("img");image.src=asset.imageUrl;image.alt="Generated draft for "+campaignName(asset.campaignId);image.loading="lazy";
        card.append(image,badge(asset.status),node("p",asset.prompt),node("p",asset.provider+" · "+asset.model,"muted"));
        if(asset.status==="Approved")card.append(link("Download approved image",asset.downloadUrl));
        else{
          const review=node("label",null,"checkbox"),reviewCheck=node("input");reviewCheck.type="checkbox";
          review.append(reviewCheck,node("span","I reviewed the image, text, rights and suitability."));
          const approve=button("Approve for export",async()=>{
            if(!reviewCheck.checked)return;approve.disabled=true;
            try{await api("/assets/"+encodeURIComponent(asset.id)+"/approve",{method:"POST",body:{reviewed:true}});await loadAssets();}
            catch(e){error.textContent=e.message;error.hidden=false;approve.disabled=false;}
          });
          approve.disabled=true;reviewCheck.addEventListener("change",()=>approve.disabled=!reviewCheck.checked);
          card.append(review,approve);
        }
        cards.append(card);
      }
      result.replaceChildren(cards);
    }catch(e){if(version===assetVersion)result.replaceChildren(node("p",e.message,"callout warning"));}
  }
  campaign.input.addEventListener("change",loadAssets);
  prompt.input.addEventListener("input",()=>state.studioPrompt=prompt.input.value);
  form.addEventListener("submit",async event=>{
    event.preventDefault();generate.disabled=true;campaign.input.disabled=true;prompt.input.disabled=true;generate.textContent="Generating…";error.hidden=true;
    const id=campaign.input.value;
    try{
      await api("/campaigns/"+encodeURIComponent(id)+"/assets/generate",{method:"POST",timeout:135000,body:{prompt:prompt.input.value,consentToSend:check.checked}});
      message("notice","Image draft saved. Review it before approval and export.");await loadAssets();
    }catch(e){error.textContent=e.message;error.hidden=false;}
    finally{generate.disabled=!state.ai.configured;campaign.input.disabled=false;prompt.input.disabled=false;generate.textContent="Generate image";}
  });
  form.append(provider,campaign.label,prompt.label,consent,generate,error);brief.append(form);
  const picker=field("local-file","Choose an image file",{type:"file",help:"PNG or JPEG, up to 5 MB. Local preview only: this file is not uploaded, generated by AI or saved as a campaign asset."});
  picker.input.accept="image/png,image/jpeg";
  const preview=node("img");preview.id="file-preview";preview.alt="Local file preview";preview.hidden=true;
  picker.input.addEventListener("change",()=>{
    if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}preview.hidden=true;preview.removeAttribute("src");
    const file=picker.input.files[0];if(!file)return;
    if(!["image/png","image/jpeg"].includes(file.type)||file.size>5*1024*1024){error.textContent="Choose a PNG or JPEG no larger than 5 MB.";error.hidden=false;picker.input.value="";return;}
    objectUrl=URL.createObjectURL(file);preview.src=objectUrl;preview.hidden=false;error.hidden=true;
  });
  const local=panel("Preview an existing file");local.classList.add("section-gap");local.append(picker.label,preview);
  const left=node("div");left.append(brief,local);grid.append(left,assets);$("view").append(grid);
  loadAssets();
}
function renderModel(){
  const p=panel("Implemented relationships");
  p.append(node("p","Client / Brand → Campaign → Lead → Stage history. Campaign → Image assets. Foreign keys keep these links valid.","callout"));
  const grid=node("div",null,"model-grid section-gap");
  const entities=[
    ["Clients","id (PK), name (unique)","Reusable client name directory. A campaign may reference one client."],
    ["Brands","id (PK), name (unique)","Reusable brand name directory. Brand-to-client ownership is not inferred."],
    ["Campaigns","id (PK), client_id (FK), brand_id (FK)","Brief, objective, audience, dates, budget, channel and status belong to the campaign."],
    ["Leads","id (PK), campaign_id (FK)","Each lead response belongs to one campaign. Contact and consent values belong to that response."],
    ["Stage history","id (PK), lead_id (FK)","Each transition stores its previous stage, next stage and recorded time."],
    ["Campaign assets","id (PK), campaign_id (FK)","Generated PNG, reviewed prompt, provider/model and approval status are stored together."]
  ];
  for(const [title,keys,description] of entities){const card=node("article");card.append(node("h3",title),node("code",keys),node("p",description));grid.append(card);}
  p.append(grid,node("p","PK = primary key; FK = foreign key. This is the local implemented model, not a client-approved ownership agreement. Phase 1 remains a separate service; no customer database is duplicated here.","muted section-gap"));
  const definitions=panel("What the overview measures");definitions.classList.add("section-gap");
  definitions.append(node("p","Total campaigns = count of stored campaigns. Active campaigns = count with status Active. Captured leads = count of stored lead responses. Qualified leads = count at stage Qualified. All are current, all-time counts; no target threshold is implied. There is no conversion-rate claim without Phase 1 acknowledgement or advertising-performance data.","muted"));
  $("view").append(p,definitions);
}
$("close-editor").addEventListener("click",closeEditor);$("cancel-editor").addEventListener("click",closeEditor);
$("editor").addEventListener("cancel",event=>{if(saving)event.preventDefault();});
$("refresh").addEventListener("click",refresh);
window.addEventListener("hashchange",()=>{if(location.hash==="#main")return;message("notice","");render();});
refresh();
