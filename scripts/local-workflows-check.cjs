'use strict';
// Local synthetic engineering checks. Not a live integration or independent human acceptance.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const {createApp}=require('../backend/app');

async function main(){
  const root=path.resolve(__dirname,'..');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'divinenet-local-workflows-'));
  const output=path.join(root,'test-evidence','local-workflows-'+new Date().toISOString().replace(/[:.]/g,'-'));
  fs.mkdirSync(output,{recursive:true});

  const report={
    executor:process.env.CRM_TEST_EXECUTOR||'Unspecified executor',
    recordedAt:new Date().toISOString(),
    scope:'Synthetic local dates, uploads, intake, retries, exports and layout; no external service',
    checks:[],
    sourceHashes:{}
  };

  for(const name of [
    'apps.js',
    'index.html',
    'style.css',
    'capture.html',
    'capture.js',
    'capture.css',
    'scripts/local-workflows-check.cjs'
  ]){
    report.sourceHashes[name]=crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(root,name)))
      .digest('hex');
  }

  let instance,server,browser,context,page,capture,base,campaign,intakeUrl;

  const check=async(name,fn)=>{
    try{
      await fn();
      report.checks.push({name,status:'passed'});
      console.log('PASS '+name);
    }catch(error){
      report.checks.push({name,status:'failed',error:error.stack});
      throw error;
    }
  };

  async function request(route,body,method){
    const response=await fetch(base+'/api'+route,{
      method:method||(body?'POST':'GET'),
      headers:body?{'Content-Type':'application/json'}:{},
      body:body?JSON.stringify(body):undefined
    });
    const json=await response.json();
    assert.ok(response.ok,route+': '+JSON.stringify(json));
    return json.data;
  }

  async function openNew(name){
    await page.goto(base+'/#campaigns');
    await page.locator('#connection.online').waitFor();
    await page.locator('#primary-action').click();
    await page.locator('#field-campaignName').fill(name);
    await page.locator('#field-prompt').fill(
      'Synthetic campaign for local workflow verification.'
    );
  }

  async function save(){
    const responsePromise=page.waitForResponse(
      r=>r.url().endsWith('/api/campaigns')&&r.request().method()==='POST'
    );
    await page.locator('#save-record').click();
    const response=await responsePromise;
    assert.equal(response.status(),201,await response.text());
    await page.locator('#editor').waitFor({state:'hidden'});
    return (await response.json()).data;
  }

  try{
    instance=createApp({
      databasePath:path.join(temp,'isolated.sqlite'),
      imageConfig:{},
      campaignNow:()=>new Date('2026-09-19T02:00:00Z')
    });

    server=await new Promise((resolve,reject)=>{
      const s=instance.app.listen(0,'127.0.0.1',()=>resolve(s));
      s.on('error',reject);
    });

    base='http://127.0.0.1:'+server.address().port;

    browser=await chromium.launch({
      headless:true,
      ...(process.env.CRM_BROWSER_CHANNEL
        ? {channel:process.env.CRM_BROWSER_CHANNEL}
        : {})
    });

    context=await browser.newContext({viewport:{width:1440,height:1000}});
    page=await context.newPage();
    await page.clock.setFixedTime(new Date('2026-09-19T02:00:00Z'));

    await check(
      'New campaign starts today and ends seven local calendar days later',
      async()=>{
        await openNew('Synthetic local workflow campaign');

        const expected=await page.evaluate(()=>{
          const d=new Date();
          const iso=d=>[
            d.getFullYear(),
            String(d.getMonth()+1).padStart(2,'0'),
            String(d.getDate()).padStart(2,'0')
          ].join('-');

          const today=iso(d);
          d.setDate(d.getDate()+7);
          return {today,end:iso(d)};
        });

        assert.equal(
          await page.locator('#field-startDate').inputValue(),
          expected.today
        );

        assert.equal(
          await page.locator('#field-endDate').inputValue(),
          expected.end
        );
      }
    );

    await check(
      'Start date tracks plus seven until the end date is manually edited, and rejects reverse dates',
      async()=>{
        await page.locator('#field-startDate').fill('2026-10-01');
        await page.locator('#field-startDate').dispatchEvent('change');

        assert.equal(
          await page.locator('#field-endDate').inputValue(),
          '2026-10-08'
        );

        await page.locator('#field-endDate').fill('2026-10-15');

        await page.locator('#field-startDate').fill('2026-10-03');
        await page.locator('#field-startDate').dispatchEvent('change');

        assert.equal(
          await page.locator('#field-endDate').inputValue(),
          '2026-10-15'
        );

        await page.locator('#field-endDate').fill('2026-10-02');

        assert.equal(
          await page.locator('#field-endDate').evaluate(e=>e.checkValidity()),
          false
        );

        await page.locator('#field-endDate').fill('2026-10-15');
      }
    );

    await check(
      'JPEG selection is local until explicit upload, then approval is required before saving',
      async()=>{
        const jpeg=Buffer.from(
          await page.evaluate(()=>{
            const c=document.createElement('canvas');
            c.width=180;
            c.height=100;
            c.getContext('2d').fillRect(0,0,180,100);
            return c.toDataURL('image/jpeg').split(',')[1];
          }),
          'base64'
        );

        const mutations=[];
        const listener=r=>{
          if(r.method()!=='GET'&&r.url().includes('/api/')){
            mutations.push(r.url());
          }
        };

        page.on('request',listener);

        await page.locator('#field-local-file').setInputFiles({
          name:'synthetic-artwork.jpg',
          mimeType:'image/jpeg',
          buffer:jpeg
        });

        await page.locator('#upload-banner').waitFor();
        await page.waitForFunction(
          ()=>!document.getElementById('upload-banner').disabled
        );

        assert.deepEqual(mutations,[]);
        page.off('request',listener);

        const responsePromise=page.waitForResponse(
          r=>r.url().endsWith('/api/banner-drafts/upload')
        );

        await page.locator('#upload-banner').click();

        const response=await responsePromise;
        assert.equal(response.status(),201,await response.text());

        const draft=(await response.json()).data;
        assert.equal(draft.provider,'uploaded');
        assert.equal(draft.model,'user-file');

        await page.locator('#save-record').click();

        assert.match(
          await page.locator('#form-error').innerText(),
          /Review and approve/
        );

        assert.equal((await request('/campaigns')).length,0);

        await page.locator('#banner-review').check();
        await page.locator('#approve-banner').click();

        await page.waitForFunction(
          ()=>document
            .getElementById('banner-message')
            .textContent
            .includes('Banner approved')
        );

        // Reproduce the independent-QA flow: invalidate an approved draft,
        // select replacement artwork, approve again and persist only the replacement.
        await page.locator('#field-prompt').fill('Changed synthetic campaign brief');
        assert.equal(await page.locator('#approve-banner').isVisible(),false);
        await page.locator('#field-local-file').setInputFiles({
          name:'replacement-artwork.jpg',mimeType:'image/jpeg',buffer:jpeg
        });
        await page.waitForFunction(()=>!document.getElementById('upload-banner').disabled);
        const replacementResponse=page.waitForResponse(r=>r.url().endsWith('/api/banner-drafts/upload'));
        await page.locator('#upload-banner').click();
        const replacement=await replacementResponse;
        assert.equal(replacement.status(),201);
        const replacementDraft=(await replacement.json()).data;
        assert.notEqual(replacementDraft.id,draft.id);
        const replacementImage=Buffer.from(await (await fetch(base+replacementDraft.imageUrl)).arrayBuffer());
        await page.waitForFunction(()=>!document.getElementById('banner-review').disabled);
        await page.locator('#banner-review').check();
        await page.locator('#approve-banner').click();
        await page.waitForFunction(()=>document.getElementById('banner-message').textContent.includes('Banner approved'));
        await page.locator('#field-status').selectOption('Active');
        campaign=await save();

        const assets=await request('/campaigns/'+campaign.id+'/assets');

        assert.equal(assets.length,1);
        assert.equal(assets[0].provider,'uploaded');
        assert.equal(assets[0].status,'Approved');
        assert.ok((await fetch(base+assets[0].downloadUrl)).ok);
        assert.deepEqual(Buffer.from(await (await fetch(base+assets[0].downloadUrl)).arrayBuffer()),replacementImage);
      }
    );

    await check(
      'Editing an existing campaign preserves its custom end date and exposes its persisted uploaded banner',
      async()=>{
        await page.getByRole('button',{name:'Edit',exact:true}).first().click();

        assert.equal(
          await page.locator('#field-startDate').inputValue(),
          '2026-10-03'
        );

        assert.equal(
          await page.locator('#field-endDate').inputValue(),
          '2026-10-15'
        );

        await page.locator('#field-startDate').fill('2026-10-04');
        await page.locator('#field-startDate').dispatchEvent('change');

        assert.equal(
          await page.locator('#field-endDate').inputValue(),
          '2026-10-15'
        );

        await page.locator('#saved-campaign-banners .asset-card').waitFor();

        assert.match(
          await page.locator('#saved-campaign-banners').innerText(),
          /uploaded/
        );

        await page.locator('#cancel-editor').click();
      }
    );

    await check(
      'Campaign view creates a local-only lead form link with copy and open actions',
      async()=>{
        await page.getByRole('button',{name:'View',exact:true}).first().click();
        await page.getByRole('button',{name:'Open lead form',exact:true}).click();
        await page.locator('#field-intake-url').waitFor();

        intakeUrl=await page.locator('#field-intake-url').inputValue();

        assert.equal(new URL(intakeUrl).origin,base);
        assert.match(intakeUrl,/\/capture\/[^/]+$/);

        assert.match(
          await page.locator('.intake-panel').innerText(),
          /this computer only/
        );

        await page.locator('#cancel-editor').click();
      }
    );

    await check(
      'Consented lead form submission is automatically linked to the campaign and safe response omits PII',
      async()=>{
        capture=await context.newPage();
        await capture.goto(intakeUrl);
        await capture.locator('#capture-form').waitFor();

        assert.equal(
          await capture.locator('#campaign-name').innerText(),
          campaign.campaignName
        );

        await capture.locator('#capture-name').fill('Synthetic Respondent');
        await capture.locator('#capture-email').fill('respondent@example.test');

        assert.equal(
          await capture.locator('#capture-consent').evaluate(e=>e.checkValidity()),
          false
        );

        await capture.locator('#capture-consent').check();

        const reply=capture.waitForResponse(
          r=>r.url().includes('/api/capture/')&&r.request().method()==='POST'
        );

        await capture.locator('#capture-submit').click();

        const response=await reply;
        assert.equal(response.status(),201);

        const data=(await response.json()).data;

        assert.deepEqual(
          Object.keys(data).sort(),
          ['receiptId','received']
        );

        await capture.locator('#capture-form').waitFor({state:'hidden'});

        const leads=await request('/leads');

        assert.equal(leads.length,1);
        assert.equal(leads[0].campaignId,campaign.id);
        assert.equal(leads[0].sourcePlatform,'Website');
        assert.equal(leads[0].consentStatus,'Recorded');
        assert.equal(leads[0].stage,'New');
      }
    );

    await check(
      'Lost response retry retains the same request and creates only one lead',
      async()=>{
        await capture.goto(intakeUrl);
        await capture.locator('#capture-form').waitFor();

        await capture.locator('#capture-name').fill('Synthetic Retry');
        await capture.locator('#capture-email').fill('retry@example.test');
        await capture.locator('#capture-consent').check();

        let dropped=false;
        const bodies=[];

        await capture.route('**/api/capture/*',async route=>{
          if(route.request().method()==='POST'){
            bodies.push(route.request().postData());

            if(!dropped){
              dropped=true;
              await route.fetch();
              await route.abort('failed');
              return;
            }
          }

          await route.continue();
        });

        await capture.locator('#capture-submit').click();

        await capture
          .getByRole('button',{name:'Retry same response',exact:true})
          .waitFor();

        assert.equal(
          await capture.locator('#capture-name').isDisabled(),
          true
        );

        assert.equal((await request('/leads')).length,2);

        await capture.locator('#capture-submit').click();
        await capture.locator('#capture-form').waitFor({state:'hidden'});

        assert.equal(bodies.length,2);
        assert.equal(bodies[0],bodies[1]);
        assert.equal((await request('/leads')).length,2);

        await capture.unroute('**/api/capture/*');
      }
    );

    await check(
      'Inactive campaigns show a non-submittable form rather than claiming capture',
      async()=>{
        await request(
          '/campaigns/'+campaign.id,
          {...campaign,status:'Paused'},
          'PUT'
        );

        await capture.goto(intakeUrl);
        await capture.locator('#capture-message').waitFor();

        assert.equal(
          await capture.locator('#capture-form').isVisible(),
          false
        );

        assert.match(
          await capture.locator('#capture-message').innerText(),
          /not currently accepting/
        );
      }
    );

    await check(
      'Lead counts refresh from saved intake and CSV escapes spreadsheet formulas',
      async()=>{
        await request('/campaigns',{
          campaignName:'=HYPERLINK("unsafe")',
          prompt:'Synthetic CSV escaping',
          channel:'Website',
          startDate:'2026-10-01',
          endDate:'2026-10-08',
          status:'Draft'
        });

        await page.goto(base+'/#dashboard');

        await page.waitForFunction(
          ()=>Array
            .from(document.querySelectorAll('.metric'))
            .find(e=>e.textContent.includes('Captured leads'))
            ?.querySelector('.metric-value')
            ?.textContent==='2'
        );

        assert.equal(
          await page
            .locator('.metric')
            .filter({hasText:'Captured leads'})
            .locator('.metric-value')
            .innerText(),
          '2'
        );

        await page.goto(base+'/#campaigns');
        await page.locator('#export-campaigns').waitFor();

        const waiting=page.waitForEvent('download');
        await page.locator('#export-campaigns').click();

        const download=await waiting;
        const file=path.join(output,'synthetic-campaigns.csv');

        await download.saveAs(file);

        assert.match(
          fs.readFileSync(file,'utf8'),
          /"'=HYPERLINK/
        );

        await page.goto(base+'/#leads');
        await page.locator('#export-leads').waitFor();

        const leadWaiting=page.waitForEvent('download');
        await page.locator('#export-leads').click();

        await (await leadWaiting).saveAs(
          path.join(output,'synthetic-leads.csv')
        );

        assert.match(
          fs.readFileSync(
            path.join(output,'synthetic-leads.csv'),
            'utf8'
          ),
          /Synthetic Respondent/
        );
      }
    );

    await check(
      'Campaign editor and capture form fit narrow and desktop displays',
      async()=>{
        for(const width of [390,768,1440]){
          await page.setViewportSize({width,height:950});
          await openNew('Synthetic responsive check');

          assert.ok(
            await page.evaluate(
              ()=>document.documentElement.scrollWidth<=innerWidth+1
            )
          );

          assert.ok(
            await page
              .locator('#editor')
              .evaluate(e=>e.scrollWidth<=e.clientWidth+1)
          );

          await page.locator('#cancel-editor').click();

          await capture.setViewportSize({width,height:950});
          await capture.goto(intakeUrl);

          assert.ok(
            await capture.evaluate(
              ()=>document.documentElement.scrollWidth<=innerWidth+1
            )
          );
        }
      }
    );

    report.passed=report.checks.length;
    report.failed=0;

  }catch(error){
    report.failed=report.checks.filter(c=>c.status==='failed').length||1;
    report.error=error.stack;
    process.exitCode=1;
    console.error(error.stack);

  }finally{
    if(browser)await browser.close();
    if(server)await new Promise(resolve=>server.close(resolve));
    if(instance)instance.db.close();

    report.finishedAt=new Date().toISOString();

    fs.writeFileSync(
      path.join(output,'results.json'),
      JSON.stringify(report,null,2)
    );

    console.log('Evidence: '+output);
  }
}

main().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
