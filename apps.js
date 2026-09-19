"use strict";
// Shared API-backed workspace. Legacy browser records are not silently imported.
const $ = id => document.getElementById(id);
const state = { campaigns:[], leads:[], clients:[], brands:[], analytics:null, ai:null, ready:false, route:"dashboard" };
const channels = ["Facebook","Instagram","LinkedIn","Website"];
const statuses = ["Draft","Active","Paused","Completed"];
const stages = ["New","Contacted","Qualified"];
let loadVersion=0, editing=null, saving=false, objectUrl=null;
let connectionError="";
const canWrite=()=>window.CRMAuth?.canWrite!==false;
function localDate(date=new Date()) {return [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");}
function plusDays(value,days){const date=new Date(value+"T12:00:00");date.setDate(date.getDate()+days);return Number.isFinite(date.getTime())?localDate(date):"";}
function exportCsv(name,headers,rows){
  const cell=value=>'"'+String(value??"").replace(/^([\s]*[=+@-])/u,"'$1").replace(/^[\t\r\n]/u,"'$&").replace(/"/g,'""')+'"';
  const csv=[headers,...rows].map(row=>row.map(cell).join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}));
  const a=link("",url);a.download=name+"-"+localDate()+".csv";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

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
function clearActionMessages() {
  message("notice", "");
  // Keep a connection failure visible until a successful data refresh.
  message("global-error", connectionError);
}
async function api(path, {method="GET",body,timeout=15000}={}) {
  let response;
  try {
    response=await fetch("/api"+path,{method,headers:body===undefined?{}:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout),cache:"no-store"});
  } catch {
    const error=new Error(method==="GET"?"Cannot reach the backend. Start the review server, then refresh.":"The request could not be confirmed. Check the saved records before repeating this action; no success is being assumed.");
    error.uncertain=method!=="GET";throw error;
  }
  let result;
  try {result=await response.json();} catch {const error=new Error("The server returned an unexpected response. No success has been confirmed.");error.uncertain=method!=="GET";throw error;}
  if(response.status===401)window.CRMAuth?.signIn();
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
    connectionError="";
    $("connection").textContent="● Database connected";$("connection").className="online";message("global-error","");
    render();
  } catch(error) {
    if(version!==loadVersion)return;
    state.ready=false;$("connection").textContent="Backend unavailable";$("connection").className="";
    connectionError=error.message;
message("notice", "");
    message("global-error",error.message);$("view").replaceChildren(empty("Connection needs attention","No sample data or browser-only saves are substituted. Select Refresh data after the server is available."));
    $("primary-action").disabled=true;
  } finally {if(version===loadVersion){$("refresh").disabled=false;$("view").setAttribute("aria-busy","false");}}
}
function render() {
  // Old bookmarks remain useful without replacing or submitting an open editor.
  if(location.hash==="#studio")history.replaceState(null,"",location.pathname+location.search+"#campaigns");
  if(!state.ready)return;
  const route=location.hash.slice(1);state.route=["campaigns","leads","model"].includes(route)?route:"dashboard";
  const headings={
    dashboard:["Overview","Your marketing, in focus.","Plan campaigns, organise responses and review creative in one place."],
    campaigns:["Campaigns","From a brief to a campaign.","Every record is saved to the shared backend. Search, review and manage your campaigns."],
    leads:["Leads & pipeline","Make every response count.","Capture campaign-linked leads and follow their recorded progress."],
    model:["Data model","See how your data connects.","A view of the implemented relationships and the boundaries still awaiting agreement."]
  };
  const [breadcrumb,title,description]=headings[state.route];
  $("breadcrumb").textContent=breadcrumb;$("page-title").textContent=title;$("page-description").textContent=description;
  document.title="Divinenet · "+breadcrumb;
  for(const a of document.querySelectorAll("[data-route]")) {if(a.dataset.route===state.route)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");}
  const primary=$("primary-action");primary.hidden=state.route==="model"||!canWrite();primary.disabled=false;
  primary.textContent=state.route==="leads"?"Add lead ＋":"Create campaign ＋";
  primary.onclick=()=>state.route==="leads"?openLead():openCampaign();
  $("view").replaceChildren();
  ({dashboard:renderDashboard,campaigns:renderCampaigns,leads:renderLeads,model:renderModel})[state.route]();
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
      buttons.append(button("View",()=>viewCampaign(c)));
      if(canWrite())buttons.append(button("Edit",()=>openCampaign(c)),button("Delete",event=>removeCampaign(c,event.currentTarget),"danger small-button"));
      actions.append(buttons);row.append(actions);
    }
    const labels=["Campaign","Channel","Status","Start","Budget",...(limited?[]:["Actions"])];
    [...row.children].forEach((cell,index)=>cell.setAttribute("data-label",labels[index]));
    body.append(row);
  }
  return wrap;
}
function renderDashboard() {
  const analytics = state.analytics || {};
  const totalCampaigns = analytics.totalCampaigns ?? 0;
  const activeCampaigns = analytics.activeCampaigns ?? 0;
  const totalLeads = analytics.totalLeads ?? 0;
  const qualifiedLeads = analytics.qualifiedLeads ?? 0;
  const leadsByStage = analytics.leadsByStage || {};
  const qualificationRate = analytics.qualificationRate;

  const metrics=node("section",null,"metrics");
  metrics.setAttribute("aria-label","Stored record summary");

  for(const [label,value,caption] of [
    ["Total campaigns",totalCampaigns,"All stored campaign records"],
    ["Active campaigns",activeCampaigns,"Records marked Active"],
    ["Captured leads",totalLeads,"Records, not unique customers"],
    ["Qualified leads",qualifiedLeads,"Development pipeline stage"]
  ]) {
    const card=node("article",null,"metric");
    card.append(node("span",label,"metric-label"),node("strong",value,"metric-value"),node("small",caption));
    metrics.append(card);
  }

  const grid=node("div",null,"overview-grid"),recent=panel("Recent campaigns");
  recent.firstChild.append(link("View all campaigns →","#campaigns"));
  recent.append(campaignTable(state.campaigns.slice(0,5),true));

  const stack=node("div",null,"stack"),pipeline=panel("Lead snapshot");
  for(const stage of stages) {
    const line=node("div",null,"summary-line");
    line.append(badge(stage),node("strong",leadsByStage[stage] ?? 0));
    pipeline.append(line);
  }

  const rate=node("div",null,"summary-line");
  rate.append(
    node("span","Qualification rate"),
    node("strong",qualificationRate === null || qualificationRate === undefined ? "N/A" : Number(qualificationRate).toFixed(2)+"%")
  );
  pipeline.append(rate);

  pipeline.append(node("p","Qualified lead records ÷ all lead records. An operational measure, not customer conversion. Counts reflect all currently stored records; performance targets are not yet configured.","muted"));

  const studio=panel("Your brief and banner, together");
  studio.append(
    node("p","Create or edit a campaign to generate, review and save its banner in the same form. "+state.ai.message,"muted"),
    link("Open campaigns →","#campaigns")
  );

  stack.append(pipeline,studio);
  grid.append(recent,stack);
  $("view").append(metrics,grid);
}
function renderCampaigns() {
  state.filters ??= {};
  const p=panel("Campaign library"),filters=node("div",null,"filters");
  const search=field("campaign-search","Search campaigns",{value:state.filters.campaignSearch||"",help:"Search by name, client, brand or ID."});
  const status=field("campaign-status","Status",{value:state.filters.campaignStatus||"All statuses",options:["All statuses",...statuses]});
  let filteredCampaigns=[];

  const download=button("Export filtered results",()=>exportCsv(
    "campaigns",
    ["ID","Campaign","Client","Brand","Channel","Status","Start date","End date","Budget AUD"],
    filteredCampaigns.map(c=>[c.id,c.campaignName,c.client,c.brand,c.channel,c.status,c.startDate,c.endDate,c.budget])
  ));
  download.id="export-campaigns";
  p.firstChild.append(download);

  filters.append(search.label,status.label);
  const results=node("div");

  function show() {
    state.filters.campaignSearch=search.input.value;
    state.filters.campaignStatus=status.input.value;

    const q=search.input.value.toLowerCase().trim();
    filteredCampaigns=state.campaigns.filter(c=>
      (status.input.value==="All statuses"||c.status===status.input.value)&&
      [c.campaignName,c.client,c.brand,c.id].some(x=>String(x||"").toLowerCase().includes(q))
    );

    download.disabled=!filteredCampaigns.length;

    if(!state.campaigns.length) {
      results.replaceChildren(node("p","No campaigns have been created yet.","muted"));
    } else if(!filteredCampaigns.length) {
      results.replaceChildren(node("p","No matching campaigns.","muted"));
    } else {
      results.replaceChildren(campaignTable(filteredCampaigns));
    }
  }

  search.input.addEventListener("input",show);
  status.input.addEventListener("change",show);
  p.append(filters,results);
  $("view").append(p);
  show();
}
async function removeCampaign(c,btn) {
  if(!confirm('Delete "'+c.campaignName+'"? Linked leads or assets prevent deletion.'))return;
 clearActionMessages();
 btn.disabled=true;
  try {await api("/campaigns/"+encodeURIComponent(c.id),{method:"DELETE"});message("notice","Campaign deleted.");await refresh();}
  catch(error){message("global-error",error.message);btn.disabled=false;}
}
function dialogSetup(title,intro) {
  clearActionMessages();
  if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
  editing=null;saving=false;$("editor").classList.remove("campaign-editor");$("record-form").reset();$("form-fields").replaceChildren();$("form-fields").inert=false;
  $("editor-title").textContent=title;$("form-intro").textContent=intro;message("form-error","");
  $("save-record").hidden=false;$("save-record").disabled=false;$("cancel-editor").textContent="Cancel";
  $("close-editor").disabled=false;$("cancel-editor").disabled=false;
  $("save-state").textContent="Changes are saved when you select Save.";
}
function presentDialog(){if(!$("editor").open)$("editor").showModal();}
function closeEditor(){
  if(saving||editing?.banner?.busy)return;
  if(editing?.banner?.draft)void api("/banner-drafts/"+encodeURIComponent(editing.banner.draft.id),{method:"DELETE"}).catch(()=>{});
  if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
  $("editor").close();editing=null;
}
function openCampaign(c=null) {
  if(!canWrite())return;
  dialogSetup(c?"Edit campaign":"Create campaign","Use a saved client or brand, or add a reusable name. An existing lead can supply its campaign brief without copying personal contact details.");
  editing={kind:"campaign",id:c?.id,requestId:crypto.randomUUID()};$("editor").classList.add("campaign-editor");
  const fields=node("section",null,"campaign-details");fields.id="campaign-details";fields.setAttribute("aria-labelledby","campaign-details-title");
  const detailsTitle=node("h3","Campaign details","full");detailsTitle.id="campaign-details-title";fields.append(detailsTitle);$("form-fields").append(fields);
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
      inputs.channel.dispatchEvent(new Event("change"));
      previousSource=source.input.value;
      previousContext=Object.fromEntries(names.map(name=>[name,inputs[name].value]));
      editing?.banner?.contextChanged();
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
  const today=localDate();
  add("startDate","Start date",{type:"date",required:true,value:c?.startDate||today});
  add("endDate","End date",{type:"date",required:true,value:c?.endDate||plusDays(today,7),help:"New campaigns default to 7 calendar days after the start date. Both dates are editable."});
  let manualEnd=Boolean(c);
  inputs.endDate.addEventListener("input",()=>{manualEnd=true;});
  inputs.startDate.addEventListener("change",()=>{if(!manualEnd&&inputs.startDate.value)inputs.endDate.value=plusDays(inputs.startDate.value,7);});
  const schedule=node("p","Select dates to check for overlapping active campaigns.","callout full");schedule.id="campaign-schedule-note";fields.append(schedule);
  function overlaps(){
    inputs.endDate.min=inputs.startDate.value;
    if(!inputs.startDate.value||!inputs.endDate.value){
      schedule.textContent="Select dates to check for overlapping active campaigns.";
      return;
    }
    const matches=state.campaigns.filter(x=>x.id!==c?.id&&x.status==="Active"&&x.channel===inputs.channel.value&&x.startDate<=inputs.endDate.value&&x.endDate>=inputs.startDate.value);
    schedule.textContent=(matches.length?matches.length+" active campaign(s) overlap these dates on "+inputs.channel.value+": "+matches.map(x=>x.campaignName).join(", ")+". Overlap is allowed; review your budget and audience.":"No other active campaigns overlap these dates on "+inputs.channel.value+".")+" Rule-based planning check, not AI or a performance prediction.";
  }
  inputs.startDate.addEventListener("change",overlaps);inputs.endDate.addEventListener("change",overlaps);inputs.channel.addEventListener("change",overlaps);overlaps();
  addCampaignBanner(c,inputs);
  $("save-record").textContent="Save campaign";presentDialog();
}

// Unsaved images stay separate from campaign records until an explicit reviewed save.
function addCampaignBanner(c,inputs) {
  const owner=editing,banner={draft:null,busy:false,revision:0,draftContext:null};owner.banner=banner;
  const section=node("section",null,"campaign-banner");section.id="banner-section";section.setAttribute("aria-labelledby","campaign-banner-title");
  const bannerTitle=node("h3","Campaign banner");bannerTitle.id="campaign-banner-title";
  section.append(node("p","OPTIONAL CAMPAIGN CREATIVE","eyebrow"),bannerTitle,node("p","Generate an image or choose your own file below. Review and approve the banner, then save the campaign to keep it.","muted"));
  const provider=node("p",state.ai.message,"callout "+(state.ai.configured?"":"warning"));
  const promptLabel=node("label","Image prompt"),prompt=node("textarea");prompt.id="banner-prompt";prompt.maxLength=4000;
  promptLabel.append(prompt,node("small","Describe the artwork and leave space for your message. Do not include personal lead or customer details. AI-generated lettering can be inaccurate."));
  const useBrief=button("Use campaign brief",()=>{prompt.value=inputs.prompt.value;invalidateDraft("Campaign brief copied. Review it before generating.");});
  const consent=node("label",null,"checkbox"),consentCheck=node("input");consentCheck.type="checkbox";consentCheck.id="banner-consent";
  consent.append(consentCheck,node("span","I have reviewed this prompt and have permission to process it with the configured image service."));
  const generate=button("Generate banner",generateDraft,"secondary");generate.id="generate-banner";generate.disabled=!state.ai.configured||state.ai.generationBlocked;
  const feedback=node("p",null,"callout");feedback.id="banner-message";feedback.setAttribute("role","status");feedback.setAttribute("aria-live","polite");feedback.hidden=true;
  const preview=node("img");preview.id="banner-preview";preview.alt="Unsaved campaign banner draft for review";preview.hidden=true;
  const review=node("label",null,"checkbox"),reviewCheck=node("input");reviewCheck.type="checkbox";reviewCheck.id="banner-review";
  review.append(reviewCheck,node("span","I checked the image, wording, rights and suitability for this campaign."));review.hidden=true;
  const approve=button("Approve banner",approveDraft);approve.id="approve-banner";approve.hidden=true;approve.disabled=true;
  const discard=button("Discard banner draft",()=>invalidateDraft("Banner removed from this unsaved campaign. You can save without a banner."),"quiet");discard.id="discard-banner";discard.hidden=true;
  const actions=node("div",null,"banner-actions");actions.append(useBrief,generate);
  const reviewActions=node("div",null,"banner-actions banner-review-actions");reviewActions.append(approve,discard);
  section.append(provider,promptLabel,consent,actions,feedback,preview,review,reviewActions,node("p","Unsaved banners expire after 30 minutes and are lost if the server restarts. Closing this form discards the unsaved banner. Saved campaign assets stay in the database. Nothing is published automatically.","muted"));
  const local=node("section",null,"local-file-preview");local.append(node("h3","Use your own banner"));
  const picker=field("local-file","Choose an image file",{type:"file",help:"PNG or JPEG, up to 5 MB and 4096 × 4096 pixels. Local preview only until you select Use this file as banner: it is not uploaded automatically. Review, approve and save to keep it as a campaign asset."});
  picker.input.removeAttribute("name");picker.input.accept="image/png,image/jpeg";
  const localPreview=node("img");localPreview.id="file-preview";localPreview.alt="Local file preview only — not a saved campaign banner";localPreview.hidden=true;
  const fileError=node("p",null,"callout warning");fileError.id="file-preview-error";fileError.setAttribute("role","alert");fileError.hidden=true;
  const upload=button("Use this file as banner",uploadFile);upload.id="upload-banner";upload.disabled=true;
  let fileRevision=0;
  picker.input.addEventListener("change",()=>{
    fileRevision++;upload.disabled=true;
    if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}localPreview.hidden=true;localPreview.removeAttribute("src");fileError.hidden=true;
    const file=picker.input.files[0];if(!file)return;
    if(!["image/png","image/jpeg"].includes(file.type)||file.size>5*1024*1024){fileError.textContent="Choose a PNG or JPEG no larger than 5 MB.";fileError.hidden=false;picker.input.value="";return;}
    objectUrl=URL.createObjectURL(file);localPreview.src=objectUrl;localPreview.hidden=false;
    const revision=fileRevision;
    localPreview.onload=()=>{if(revision!==fileRevision)return;if(localPreview.naturalWidth>4096||localPreview.naturalHeight>4096){fileError.textContent="Choose an image with width and height no larger than 4096 pixels.";fileError.hidden=false;localPreview.hidden=true;return;}upload.disabled=banner.busy;};
    localPreview.onerror=()=>{if(revision!==fileRevision)return;fileError.textContent="This file could not be decoded as an image. Choose a valid PNG or JPEG.";fileError.hidden=false;localPreview.hidden=true;upload.disabled=true;};
  });
  local.append(picker.label,fileError,localPreview,upload,node("small","Uploaded files are your artwork, not AI output. Only attach files you have permission to use."));section.append(local);
  $("form-fields").append(section);
  const contextKey=()=>JSON.stringify([prompt.value,inputs.prompt.value,inputs.targetAudience.value]);
  const discardRemote=draft=>{if(draft)void api("/banner-drafts/"+encodeURIComponent(draft.id),{method:"DELETE"}).catch(()=>{});};
  banner.isCurrent=()=>!banner.draft||banner.draftContext===contextKey();
  banner.contextChanged=()=>invalidateDraft("Campaign brief or audience changed. Generate and review a new banner before attaching it.");
  for(const input of [inputs.prompt,inputs.targetAudience])for(const event of ["input","change"])input.addEventListener(event,banner.contextChanged);
  function say(text,warning=false){feedback.textContent=text;feedback.className="callout"+(warning?" warning":"");feedback.hidden=!text;}
  function setBusy(value){
    banner.busy=value;section.setAttribute("aria-busy",String(value));
    prompt.disabled=value;consentCheck.disabled=value;useBrief.disabled=value;discard.disabled=value;reviewCheck.disabled=value;picker.input.disabled=value;upload.disabled=value||localPreview.hidden||!localPreview.naturalWidth;
    generate.disabled=value||!state.ai.configured||state.ai.generationBlocked;approve.disabled=value||!reviewCheck.checked||banner.draft?.status==="Approved";
    $("save-record").disabled=value;$("close-editor").disabled=value;$("cancel-editor").disabled=value;
  }
  function invalidateDraft(text){
    banner.revision++;discardRemote(banner.draft);banner.draftContext=null;
    banner.draft=null;reviewCheck.checked=false;review.hidden=true;approve.hidden=true;discard.hidden=true;preview.hidden=true;preview.removeAttribute("src");
    consentCheck.checked=false;say(text);
  }
  prompt.addEventListener("input",()=>invalidateDraft("Prompt changed. Generate and review a new banner before attaching it."));
  reviewCheck.addEventListener("change",()=>approve.disabled=!reviewCheck.checked||banner.busy||banner.draft?.status==="Approved");
  async function uploadFile(){
    if(banner.busy||localPreview.hidden||!localPreview.naturalWidth)return;
    const previousDraft=banner.draft,requestRevision=banner.revision,requestContext=contextKey(),selectedRevision=fileRevision;
    setBusy(true);say("Preparing your chosen file as an unsaved banner. Review and approve it before saving.");
    try{
      const canvas=document.createElement("canvas");canvas.width=localPreview.naturalWidth;canvas.height=localPreview.naturalHeight;
      if(!canvas.width||!canvas.height||canvas.width>4096||canvas.height>4096)throw new Error("Choose an image no larger than 4096 × 4096 pixels.");
      canvas.getContext("2d").drawImage(localPreview,0,0);
      const imageBase64=canvas.toDataURL("image/png").split(",")[1];
      if(imageBase64.length*3/4>5*1024*1024)throw new Error("This image becomes larger than 5 MB when safely converted to PNG. Choose a smaller image.");
      const draft=await api("/banner-drafts/upload",{method:"POST",body:{imageBase64,prompt:(prompt.value.trim()||"Uploaded campaign artwork").slice(0,2000)},timeout:30000});
      if(editing!==owner||banner.revision!==requestRevision||contextKey()!==requestContext||fileRevision!==selectedRevision){discardRemote(draft);if(editing===owner)say("Campaign context changed while uploading. The outdated draft was discarded. Select and review the file again.",true);return;}
      discardRemote(previousDraft);banner.draft=draft;banner.draftContext=requestContext;reviewCheck.checked=false;preview.src=draft.imageUrl;preview.hidden=false;review.hidden=false;approve.hidden=false;discard.hidden=false;
      say("Your uploaded banner is ready for review — this is not AI-generated. Approve it, then Save campaign to keep the image in the database.");
    }catch(error){if(editing===owner)say(error.message+(banner.draft?" Your previous banner remains selected.":" No banner has been attached."),true);}
    finally{if(editing===owner)setBusy(false);}
  }
  async function generateDraft(){
    if(banner.busy||!state.ai.configured||state.ai.generationBlocked)return;
    if(!prompt.value.trim()){say("Enter an image prompt first.",true);prompt.focus();return;}
    if(!consentCheck.checked){say("Review the prompt and select its permission checkbox first.",true);consentCheck.focus();return;}
    const previousDraft=banner.draft;
    const requestRevision=banner.revision,requestContext=contextKey();
    setBusy(true);generate.textContent="Generating banner…";say("Generating an unsaved image. Keep this form open; the campaign has not been created.");
    try{
      const draft=await api("/banner-drafts/generate",{method:"POST",body:{prompt:prompt.value.trim(),consentToSend:true},timeout:195000});
      if(editing!==owner||banner.revision!==requestRevision||contextKey()!==requestContext){
        discardRemote(draft);
        if(editing===owner)say("Campaign context changed while generating. The outdated response was discarded; review the current prompt and generate again.",true);
        return;
      }
      discardRemote(previousDraft);banner.draftContext=requestContext;
      banner.draft=draft;reviewCheck.checked=false;preview.src=draft.imageUrl;preview.hidden=false;review.hidden=false;approve.hidden=false;discard.hidden=false;
      say("Draft ready — "+draft.provider+" / "+draft.model+". Review and approve it, then save the campaign. This draft is not yet attached to a campaign.");
    }catch(error){
      try{state.ai=await api("/ai/status",{timeout:3000});provider.textContent=state.ai.message;}catch{}
      if(editing!==owner)return;
      say((error.uncertain?"Generation could not be confirmed. The local service may still be working; wait before trying again. Your campaign fields are retained.":error.message)+(state.ai.generationBlocked?" The image service needs an operator check before another generation.":"")+(banner.draft?" Your previous banner is still selected.":" No banner is selected."),true);
    }
    finally{if(editing===owner){setBusy(false);generate.textContent="Generate banner";}}
  }
  async function approveDraft(){
    if(banner.busy||!banner.draft||!reviewCheck.checked)return;
    if(!banner.isCurrent()){banner.contextChanged();return;}
    const requestDraft=banner.draft,requestRevision=banner.revision,requestContext=contextKey();
    setBusy(true);
    try{
      const approved=await api("/banner-drafts/"+encodeURIComponent(requestDraft.id)+"/approve",{method:"POST",body:{reviewed:true}});
      if(editing!==owner||banner.revision!==requestRevision||contextKey()!==requestContext||banner.draft?.id!==requestDraft.id){
        discardRemote(approved);
        if(editing===owner)say("Campaign context changed during approval. The outdated approval was discarded; generate and review a new banner.",true);
        return;
      }
      banner.draft=approved;
      say("Banner approved. Select Save campaign to store the campaign and banner together.");
    }catch(error){if(editing===owner)say(banner.revision!==requestRevision?"Campaign context changed during approval. Generate and review a new banner.":error.message,true);}
    finally{if(editing===owner)setBusy(false);}
  }
  if(c){
    const existing=node("div",null,"section-gap");existing.id="saved-campaign-banners";section.append(node("h3","Saved campaign banners"),existing);
    existing.append(node("p","Loading saved banners…","muted"));
    api("/campaigns/"+encodeURIComponent(c.id)+"/assets").then(assets=>{
      if(editing!==owner)return;
      existing.replaceChildren();
      if(!assets.length){existing.append(node("p","No saved banner yet. Generate one above without leaving this campaign.","muted"));return;}
      for(const asset of assets){
        const card=node("article",null,"asset-card"),image=node("img");image.src=asset.imageUrl;image.alt="Saved banner for "+c.campaignName;image.loading="lazy";
        card.append(image,badge(asset.status),node("p",asset.prompt),node("p",asset.provider+" · "+asset.model,"muted"));
        if(asset.status==="Approved")card.append(link("Download approved banner",asset.downloadUrl));
        else{
          const label=node("label",null,"checkbox"),check=node("input");check.type="checkbox";label.append(check,node("span","I reviewed this saved image, wording, rights and suitability."));
          const approval=button("Approve saved banner",async()=>{
            if(!check.checked)return;approval.disabled=true;
            try{await api("/assets/"+encodeURIComponent(asset.id)+"/approve",{method:"POST",body:{reviewed:true}});label.remove();approval.replaceWith(link("Download approved banner","/api/assets/"+encodeURIComponent(asset.id)+"/download"));card.querySelector(".badge").replaceWith(badge("Approved"));}
            catch(error){say(error.message,true);approval.disabled=false;}
          });approval.disabled=true;check.addEventListener("change",()=>approval.disabled=!check.checked);card.append(label,approval);
        }
        existing.append(card);
      }
    }).catch(error=>{if(editing===owner)existing.replaceChildren(node("p",error.message,"callout warning"));});
  }
}
function viewCampaign(c) {
  dialogSetup(c.campaignName,"Campaign record · "+c.id);$("save-record").hidden=true;$("cancel-editor").textContent="Close";$("save-state").textContent="Read-only view.";
  const details=node("dl",null,"detail-grid full");
  for(const [title,value] of [["Client",c.client||"Not selected"],["Brand",c.brand||"Not selected"],["Brief",c.prompt],["Objective",c.objective||"Not set"],["Audience",c.targetAudience||"Not set"],["Channel",c.channel],["Dates",displayDate(c.startDate)+" – "+displayDate(c.endDate)],["Budget",money(c.budget)],["Status",c.status],["Linked leads",state.leads.filter(l=>l.campaignId===c.id).length]]) {
    const part=node("div");part.append(node("dt",title),node("dd",value));details.append(part);
  }
  $("form-fields").append(details);
  const savedAssets=node("section",null,"saved-view-assets full");savedAssets.append(node("h3","Saved campaign banners"),node("p","Loading saved banners…","muted"));$("form-fields").append(savedAssets);
  api("/campaigns/"+encodeURIComponent(c.id)+"/assets").then(assets=>{
    if(!savedAssets.isConnected)return;savedAssets.replaceChildren(node("h3","Saved campaign banners"));
    if(!assets.length){savedAssets.append(node("p","No banner has been saved for this campaign.","muted"));return;}
    for(const asset of assets){const card=node("article",null,"asset-card"),image=node("img");image.src=asset.imageUrl;image.alt="Saved campaign banner for "+c.campaignName;image.loading="lazy";card.append(image,badge(asset.status),node("p",asset.provider==="uploaded"?"Uploaded artwork":"Generated artwork","muted"));if(asset.status==="Approved")card.append(link("Download approved banner",asset.downloadUrl));savedAssets.append(card);}
  }).catch(error=>{if(savedAssets.isConnected)savedAssets.append(node("p",error.message,"callout warning"));});
  if(canWrite()){
    $("form-fields").append(button("Edit campaign and banner",()=>openCampaign(c)));
    const intake=node("section",null,"intake-panel full"),intro=node("p","Capture responses directly into this campaign's lead queue. This address works on this computer only; it is not a public website link.","muted");
    const open=button("Open lead form",async()=>{
      open.disabled=true;
      try{
        const data=await api("/campaigns/"+encodeURIComponent(c.id)+"/intake-link",{method:"POST",body:{}});
        if(!intake.isConnected)return;
        const url=new URL(data.url,location.origin);if(url.origin!==location.origin||!url.pathname.startsWith("/capture/"))throw new Error("The server returned an invalid form address.");
        const input=field("intake-url","Local lead form address",{value:url.href});input.input.readOnly=true;
        const go=link("Open form in a new tab",url.href);go.target="_blank";go.rel="noopener";
        const status=node("p","Campaign status must be Active to accept new responses.","muted");
        const copy=button("Copy form link",async()=>{try{await navigator.clipboard.writeText(url.href);status.textContent="Form link copied.";}catch{input.input.focus();input.input.select();status.textContent="Select and copy the address above.";}});
        intake.replaceChildren(intro,input.label,go,copy,status);
      }catch(error){message("form-error",error.message);open.disabled=false;}
    });intake.append(intro,open);$("form-fields").append(intake);
  }presentDialog();
}
function openLead(lead=null) {
  if(!canWrite())return;
  clearActionMessages();
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
  event.preventDefault();if(!editing||saving||editing.banner?.busy)return;
  clearActionMessages();
  const data=Object.fromEntries(new FormData(event.currentTarget));const current={...editing};
  if(current.kind==="campaign"){
    data.budget=parseBudget(data.budget);
    if(Number.isNaN(data.budget)){message("form-error","Enter a valid budget, such as 10000 or 10k.");return;}
    for(const kind of ["client","brand"]) {
      if(data[kind+"Id"]==="__new__") delete data[kind+"Id"];
      else {data[kind+"Id"]=data[kind+"Id"]||null;delete data[kind];}
    }
    delete data.sourceLead;
    if(current.banner&&!current.banner.isCurrent()){current.banner.contextChanged();message("form-error","Campaign context changed. Generate and review a new banner, or save without a banner.");return;}
    if(current.banner?.draft){
      if(current.banner.draft.status!=="Approved"){message("form-error","Review and approve the banner before saving, or discard it to save the campaign without a banner.");return;}
      data.bannerDraftId=current.banner.draft.id;
    }
    const payload=JSON.stringify(data);
    if(editing.uncertain&&editing.lastPayload!==payload){message("form-error","The previous save is unconfirmed. Restore the previous values and retry that same save, or check the campaign list before starting a new record. Do not create a duplicate.");return;}
    if(editing.lastPayload&&editing.lastPayload!==payload)editing.requestId=crypto.randomUUID();
    editing.lastPayload=payload;data.clientRequestId=editing.requestId;
  }
  saving=true;$("save-record").disabled=true;$("form-fields").inert=true;$("save-state").textContent="Saving to the database…";message("form-error","");
  try {
    const path=(current.kind==="campaign"?"/campaigns":"/leads")+(current.id?"/"+encodeURIComponent(current.id):"");
    const saved=await api(path,{method:current.id?"PUT":"POST",body:data});
    saving=false;$("form-fields").inert=false;if(editing?.banner)editing.banner.draft=null;closeEditor();
    message("notice",(current.kind==="campaign"?"Campaign ":"Lead ")+saved.id+" saved to the database.");await refresh();
  } catch(error){
    if(editing)editing.uncertain=current.kind==="campaign"&&Boolean(error.uncertain);
    const recoverable=Boolean(editing?.uncertain);
    message("form-error",recoverable?"The campaign save could not be confirmed. Values are temporarily locked. Select Retry campaign save to recover the same request without creating a duplicate, or close and check the campaign list.":error.message);
    $("save-state").textContent="Save not confirmed. Your input is retained.";
    if(recoverable)$("save-record").textContent="Retry campaign save";
  }
  finally{saving=false;$("form-fields").inert=Boolean(editing?.uncertain);$("save-record").disabled=false;}
});
function renderLeads() {
  state.filters ??= {};

  const note=node("div","Development pipeline: New → Contacted → Qualified. Stage transitions are recorded. Scoring policy and Phase 1 conversion are not approved or connected; no lead is marked Converted.","callout warning");
  $("view").append(note);

  const filters=node("div",null,"filters section-gap");
  const search=field("lead-search","Search leads",{value:state.filters.leadSearch||""});
  const campaign=field("lead-campaign","Campaign",{
    value:state.filters.leadCampaign||"",
    options:[{value:"",label:"All campaigns"},...state.campaigns.map(c=>({value:c.id,label:c.campaignName}))]
  });

  let filteredLeads=[];

  const download=button("Export filtered results",()=>exportCsv(
    "leads",
    ["ID","Campaign ID","Name","Email","Phone","Source","Consent","Stage"],
    filteredLeads.map(l=>[l.id,l.campaignId,l.name,l.email,l.phone,l.sourcePlatform,l.consentStatus,l.stage])
  ));
  download.id="export-leads";

  filters.append(search.label,campaign.label,download);
  const results=node("div");

  function show() {
    state.filters.leadSearch=search.input.value;
    state.filters.leadCampaign=campaign.input.value;

    const q=search.input.value.toLowerCase().trim();
    filteredLeads=state.leads.filter(l=>
      (!campaign.input.value||l.campaignId===campaign.input.value)&&
      [l.id,l.name,l.email].some(x=>String(x||"").toLowerCase().includes(q))
    );

    download.disabled=!filteredLeads.length;

    if(!state.leads.length) {
      results.replaceChildren(node("p","No leads have been captured yet.","muted"));
      return;
    }

    if(!filteredLeads.length) {
      results.replaceChildren(node("p","No matching leads.","muted"));
      return;
    }

    const pipeline=node("div",null,"pipeline");

    for(const stage of stages){
      const column=node("section",null,"pipeline-column");
      const rows=filteredLeads.filter(l=>l.stage===stage);
      const heading=node("h2",stage);
      heading.append(node("span",rows.length));
      column.append(heading);

      if(!rows.length) column.append(node("p","No leads in this stage.","muted"));

      for(const lead of rows) {
        const card=node("article",null,"lead-card");
        card.append(
          node("h3",lead.name),
          node("p",lead.email),
          node("p",lead.id+" · "+campaignName(lead.campaignId)),
          badge(lead.sourcePlatform),
          node("p","Consent: "+lead.consentStatus)
        );

        if(canWrite()) card.append(button("Edit",()=>openLead(lead)));
        card.append(button("History",()=>viewHistory(lead)));

        const next=stages[stages.indexOf(stage)+1];
        if(next&&canWrite()) card.append(button("Move to "+next,event=>advanceLead(lead,next,event.currentTarget)));

        column.append(card);
      }

      pipeline.append(column);
    }

    results.replaceChildren(pipeline);
  }

  search.input.addEventListener("input",show);
  campaign.input.addEventListener("change",show);
  $("view").append(filters,results);
  show();
}
async function advanceLead(lead,stage,btn){
  if(!confirm("Move "+lead.name+" to "+stage+"? This development transition is recorded in history."))return;
  clearActionMessages();
  btn.disabled=true;
  try{await api("/leads/"+encodeURIComponent(lead.id)+"/stage",{method:"PATCH",body:{stage}});message("notice","Lead stage updated and recorded.");await refresh();}
  catch(error){message("global-error",error.message);btn.disabled=false;}
}
async function viewHistory(lead){
  clearActionMessages();
  try{
    const history=await api("/leads/"+encodeURIComponent(lead.id)+"/history");
    dialogSetup("Stage history","Recorded transitions for "+lead.id);$("save-record").hidden=true;$("cancel-editor").textContent="Close";$("save-state").textContent="Read-only history.";
    const list=node("div",null,"full");
    if(!history.length)list.append(node("p","No stage changes recorded.","muted"));
    for(const entry of history)list.append(node("p",entry.from_stage+" → "+entry.to_stage+" · "+new Date(entry.changed_at).toLocaleString("en-AU")));
    $("form-fields").append(list);presentDialog();
  }catch(error){message("global-error",error.message);}
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
    ["Campaign assets","id (PK), campaign_id (FK)","Generated or uploaded PNG, reviewed description, source and approval status are stored together."]
  ];
  for(const [title,keys,description] of entities){const card=node("article");card.append(node("h3",title),node("code",keys),node("p",description));grid.append(card);}
  p.append(grid,node("p","PK = primary key; FK = foreign key. This is the local implemented model, not a client-approved ownership agreement. Phase 1 remains a separate service; no customer database is duplicated here.","muted section-gap"));
  const support=node("details",null,"section-gap");support.append(node("summary","Local capture, access and reliability tables"));
  support.append(node("p","campaign_intake_links links a form to its campaign. campaign_intake_receipts records a form token and lead reference so the same submission can be retried without creating another lead; a deleted lead can leave a receipt tombstone. campaign_intake_limits links request limits to the form token.","muted"));
  support.append(node("p","local_users stores local account records. local_sessions references its user. campaign_save_requests keeps campaign-save retry records. app_sequences, schema_migrations and ai_generation_attempts support identifiers, database updates and generation limits. ai_runtime_guard is created when the local AI runtime is used.","muted"));
  support.append(node("p","These support tables do not create a Phase 1 customer or appointment database. External customer, appointment and social-publishing connections remain separate.","muted"));p.append(support);
  const definitions=panel("What the overview measures");definitions.classList.add("section-gap");
  definitions.append(node("p","Total campaigns = count of stored campaigns. Active campaigns = count with status Active. Captured leads = count of stored lead responses. Qualified leads = count at stage Qualified. All are current, all-time counts; no target threshold is implied. There is no conversion-rate claim without Phase 1 acknowledgement or advertising-performance data.","muted"));
  $("view").append(p,definitions);
}
$("close-editor").addEventListener("click",closeEditor);$("cancel-editor").addEventListener("click",closeEditor);
$("editor").addEventListener("cancel",event=>{event.preventDefault();closeEditor();});
$("refresh").addEventListener("click",()=>{
  clearActionMessages();
  refresh();
});

window.addEventListener("hashchange",()=>{
  if(location.hash==="#main")return;
  clearActionMessages();
  if(state.ready&&!$("editor").open)refresh();else render();
});
// Responses can arrive from the separate lead-form tab. Re-read saved data when returning.
window.addEventListener("focus",()=>{if(state.ready&&!$("editor").open&&!saving&&!document.hidden)refresh();});
Promise.resolve(window.CRMAuth?.ready).then(access=>{if(!access||access.enabled===false||access.authenticated)refresh();else if(access.error)message("global-error",access.error);});



