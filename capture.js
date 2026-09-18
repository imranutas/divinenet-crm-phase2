"use strict";
(() => {
  const form=document.getElementById("capture-form"),message=document.getElementById("capture-message"),submit=document.getElementById("capture-submit");
  const token=location.pathname.split("/").filter(Boolean)[1];
  let pending=null,busy=false,uncertain=false;
  const say=(text,error=false)=>{message.textContent=text;message.className=error?"error":"";message.hidden=false;};
  const inputs=()=>[...form.querySelectorAll("input")];
  const endpoint="/api/capture/"+encodeURIComponent(token||"");
  async function request(options={}){
    let response,result;
    try{response=await fetch(endpoint,{cache:"no-store",signal:AbortSignal.timeout(15000),...options});}
    catch{const error=new Error("The response could not be confirmed. Your details are retained; retry this same submission when the server is available.");error.uncertain=true;throw error;}
    try{result=await response.json();}catch{const error=new Error("The server's reply could not be confirmed. Retry the same submission.");error.uncertain=true;throw error;}
    if(!response.ok||result.success===false){const error=new Error(result.message||"The response could not be saved.");error.uncertain=options.method==="POST"&&response.status>=500;throw error;}
    return result.data;
  }
  async function load(){
    try{
      if(!token)throw new Error("This campaign form address is incomplete.");
      const campaign=await request();document.getElementById("campaign-name").textContent=campaign.campaignName;
      if(campaign.status!=="Active"){say("This campaign is not currently accepting new responses. Please contact the campaign team.");return;}
      form.hidden=false;
    }catch(error){document.getElementById("campaign-name").textContent="Campaign form unavailable";say(error.message,true);}
  }
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(busy)return;
    if(!uncertain){
      if(!form.reportValidity())return;
      pending={name:form.elements.name.value.trim(),email:form.elements.email.value.trim(),phone:form.elements.phone.value.trim(),consent:form.elements.consent.checked,clientRequestId:crypto.randomUUID()};
    }
    busy=true;submit.disabled=true;inputs().forEach(input=>input.disabled=true);say("Saving your response…");
    try{
      const result=await request({method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(pending)});
      if(result.received!==true||!result.receiptId){const error=new Error("The server did not confirm receipt. Retry the same response.");error.uncertain=true;throw error;}
      form.hidden=true;say("Thank you. Your response has been saved for this campaign. Receipt: "+result.receiptId);pending=null;uncertain=false;
    }catch(error){
      uncertain=Boolean(error.uncertain);say(error.message+(uncertain?" The fields remain locked to prevent a duplicate or mismatched retry.":" Your details have been kept so you can correct them."),true);
      inputs().forEach(input=>input.disabled=uncertain);submit.textContent=uncertain?"Retry same response":"Send response";
    }finally{busy=false;submit.disabled=false;}
  });
  load();
})();
