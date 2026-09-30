'use strict';

const https = require('node:https');

function createCloudflareTextProvider({ accountId, apiToken, model = '@cf/meta/llama-3.1-8b-instruct', timeoutMs = 60000 } = {}) {
  if (!accountId || !apiToken) throw new Error('Cloudflare text AI credentials are not configured.');
  if (typeof model !== 'string' || !model.startsWith('@cf/')) throw new Error('Invalid Cloudflare text model.');

  function generate({ prompt, brand = '', channel = null }) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000 ||
        typeof brand !== 'string' || brand.length > 120 ||
        (channel !== null && (typeof channel !== 'string' || channel.length > 40))) {
      return Promise.reject(new Error('Invalid draft input.'));
    }

    const instruction =
      'Write one short professional marketing draft for human review. ' +
      'Return only the draft text. Do not include explanations, headings, notes, examples or analysis. ' +
      'Do not invent prices, endorsements or performance figures. Maximum 100 words.\n\n' +
      JSON.stringify({ brief: prompt.trim(), brand, channel });

    const body = JSON.stringify({ prompt: instruction });

    return new Promise((resolve, reject) => {
      const request = https.request({
        hostname: 'api.cloudflare.com',
        path: `/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, response => {
        const chunks = [];
        let length = 0;

        response.on('data', chunk => {
          length += chunk.length;
          if (length > 65536) {
            request.destroy();
            reject(new Error('Cloudflare text response is too large.'));
            return;
          }
          chunks.push(chunk);
        });

        response.on('end', () => {
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (response.statusCode !== 200 || result.success !== true ||
                typeof result.result?.response !== 'string' || !result.result.response.trim()) {
              throw new Error('Cloudflare text generation failed.');
            }

            resolve({
              content: result.result.response.trim(),
              provider: 'cloudflare',
              model
            });
          } catch (error) {
            reject(error);
          }
        });
      });

      request.on('error', () => reject(new Error('Cloudflare text connection failed.')));
      request.setTimeout(timeoutMs, () => request.destroy(new Error('Cloudflare text deadline exceeded.')));
      request.end(body);
    });
  }

  return { generate, model };
}

function cloudflareTextProviderFromEnvironment(env = process.env) {
  if (env.CRM_TEXT_PROVIDER !== 'cloudflare') return null;

  return createCloudflareTextProvider({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN,
    model: env.CLOUDFLARE_TEXT_MODEL || '@cf/meta/llama-3.1-8b-instruct'
  });
}

module.exports = { createCloudflareTextProvider, cloudflareTextProviderFromEnvironment };
