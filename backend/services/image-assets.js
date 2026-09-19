const { randomUUID } = require('node:crypto');
const { validatePng } = require('./png-validation');
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function readImageConfig(env = process.env) {
  return { provider: env.AI_IMAGE_PROVIDER || '', model: env.AI_IMAGE_MODEL || '',
    apiKey: env.OPENAI_API_KEY || '', approved: env.AI_LIVE_APPROVED === 'true' };
}
function createOpenAIImageProvider(config, fetchImpl = fetch) {
  return {
    provider: 'openai', model: config.model,
    async generate({ prompt }) {
      const response = await fetchImpl('https://api.openai.com/v1/images/generations', {
        method: 'POST', headers: { 'Content-Type':'application/json', Authorization:'Bearer ' + config.apiKey },
        body: JSON.stringify({ model:config.model, prompt, n:1, size:'1024x1024', quality:'low', output_format:'png' }),
        signal: AbortSignal.timeout(120000), redirect:'error'
      });
      if (!response.ok) throw new Error('Provider rejected generation');
      // Bound the encoded response before decoding or storing it.
      let length=0; const chunks=[];
      for await (const chunk of response.body) {
        length += chunk.length;
        if(length > MAX_IMAGE_BYTES * 1.5) throw new Error('Provider image is too large');
        chunks.push(chunk);
      }
      const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const encoded=result.data?.[0]?.b64_json;
      if(typeof encoded!=='string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Provider returned no image');
      return { bytes:Buffer.from(encoded,'base64'), provider:'openai', model:config.model };
    }
  };
}
function attachAssetRoutes(app, { db, campaigns, imageProvider, imageConfig }) {
  const config=imageConfig || readImageConfig();
  const configured = (imageProvider && typeof imageProvider.generate === 'function') || (config.approved && config.provider==='openai' && !!config.apiKey && !!config.model);
  const provider=imageProvider || (configured ? createOpenAIImageProvider(config) : null);
  const mode=imageProvider ? 'test-double' : (configured ? 'live-configured' : 'unavailable');
  db.exec('CREATE TABLE IF NOT EXISTS ai_generation_attempts(id TEXT PRIMARY KEY,created_at TEXT NOT NULL)');
  const fail=(res,status,message)=>res.status(status).json({success:false,message});
  const get=id=>db.prepare('SELECT * FROM campaign_assets WHERE id=?').get(id);
  const metadata=row=>({id:row.id,campaignId:row.campaign_id,prompt:row.prompt,provider:row.provider,model:row.model,status:row.status,createdAt:row.created_at,approvedAt:row.approved_at,imageUrl:'/api/assets/'+row.id+'/image',downloadUrl:'/api/assets/'+row.id+'/download'});
  app.get('/api/ai/status',(_req,res)=>res.json({success:true,data:{configured:!!configured,mode,provider:imageProvider?'test-double':(provider?.provider||config.provider||null),model:provider?.model||config.model||null,message:mode==='test-double'?'A controlled test provider is configured. This is not live AI.':(configured?'Image generation is configured. Review the prompt before sending.':'Live AI is unavailable until a provider, model, approved account and server-side key are configured.')}}));
  app.get('/api/campaigns/:id/assets',(req,res)=>{
    if(!campaigns.getById(req.params.id)) return fail(res,404,'Campaign not found');
    res.json({success:true,data:db.prepare('SELECT * FROM campaign_assets WHERE campaign_id=? ORDER BY created_at DESC').all(req.params.id).map(metadata)});
  });
  let generating=false;
  app.post('/api/campaigns/:id/assets/generate',async(req,res)=>{
    const campaign=campaigns.getById(req.params.id);
    if(!campaign) return fail(res,404,'Campaign not found');
    if(typeof req.body.prompt!=='string'||!req.body.prompt.trim()||req.body.prompt.length>4000) return fail(res,400,'Image prompt must contain 1 to 4000 characters');
    if(!configured) return fail(res,503,'AI image provider is not configured or approved');
    if(req.body.consentToSend!==true) return fail(res,400,'Confirm that the prompt may be sent to the configured provider');
    if(generating) return fail(res,429,'Another image is generating. Please wait.');
    const since=new Date(Date.now()-86400000).toISOString();
    const attempts=db.prepare('SELECT COUNT(*) AS total FROM ai_generation_attempts WHERE created_at>=?').get(since).total;
    if(attempts>=10) return fail(res,429,'Local review limit of 10 image attempts per 24 hours reached');
    db.prepare('INSERT INTO ai_generation_attempts VALUES (?,?)').run(randomUUID(),new Date().toISOString());
    generating=true;
    try {
      // Only the user-reviewed image brief is sent; lead contact data stays local.
      const prompt=req.body.prompt.trim();
      const result=await provider.generate({prompt});
      const bytes=result.bytes;
      validatePng(bytes);
      const id=randomUUID(),now=new Date().toISOString();
      db.prepare('INSERT INTO campaign_assets(id,campaign_id,prompt,provider,model,image_data,mime_type,status,created_at,approved_at) VALUES (?,?,?,?,?,?,?,\'Draft\',?,NULL)').run(id,campaign.id,prompt,imageProvider?'test-double':provider.provider,provider.model||'test-fixture',bytes,'image/png',now);
      res.status(201).json({success:true,data:metadata(get(id))});
    } catch(error) {
      fail(res,error.name==='TimeoutError'?504:502,'Image generation failed. No approved asset was created.');
    } finally { generating=false; }
  });
  app.post('/api/assets/:id/approve',(req,res)=>{
    const asset=get(req.params.id);
    if(!asset) return fail(res,404,'Asset not found');
    if(req.body.reviewed!==true) return fail(res,400,'Confirm that you reviewed the image before approval');
    db.prepare('UPDATE campaign_assets SET status=\'Approved\',approved_at=? WHERE id=?').run(new Date().toISOString(),asset.id);
    res.json({success:true,data:metadata(get(asset.id))});
  });
  app.get('/api/assets/:id/image',(req,res)=>{
    const asset=get(req.params.id);
    if(!asset) return fail(res,404,'Asset not found');
    res.type('png').send(asset.image_data);
  });
  app.get('/api/assets/:id/download',(req,res)=>{
    const asset=get(req.params.id);
    if(!asset) return fail(res,404,'Asset not found');
    if(asset.status!=='Approved') return fail(res,409,'Review and approve this image before export');
    res.type('png').attachment('campaign-'+asset.id+'.png').send(asset.image_data);
  });
}
module.exports={readImageConfig,createOpenAIImageProvider,attachAssetRoutes};
