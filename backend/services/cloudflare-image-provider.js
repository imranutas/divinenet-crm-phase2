const sharp = require('sharp');
const { validatePng } = require('./png-validation');
const { validateImagePrompt, MAX_IMAGE_BYTES, GENERATION_TIMEOUT_MS } = require('./local-image-provider');

const DEFAULT_MODEL = '@cf/black-forest-labs/flux-1-schnell';
const MAX_RESPONSE_BYTES = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 65536;

function createCloudflareImageProvider(config, fetchImpl = fetch) {
  const accountId = String(config.accountId || '').trim();
  const apiToken = String(config.apiToken || '').trim();
  const model = String(config.model || DEFAULT_MODEL).trim();

  if (!/^[A-Za-z0-9]+$/.test(accountId)) {
    throw new Error('Cloudflare Account ID is missing or invalid');
  }
  if (!apiToken) {
    throw new Error('Cloudflare API token is missing');
  }
  if (!model.startsWith('@cf/') || model.length > 200) {
    throw new Error('Cloudflare image model is invalid');
  }

  const endpoint =
    'https://api.cloudflare.com/client/v4/accounts/' +
    accountId +
    '/ai/run/' +
    model;

  return {
    provider: 'cloudflare',
    model,

    async generate({ prompt, signal }) {
      const promptError = validateImagePrompt(prompt);
      if (promptError) throw new Error(promptError);

      const timeout = AbortSignal.timeout(GENERATION_TIMEOUT_MS);

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          steps: 4
        }),
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
        redirect: 'error'
      });

      if (!response.ok) {
        throw new Error('Cloudflare image generation request failed');
      }

      const text = await response.text();

      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new Error('Cloudflare image response is too large');
      }

      const json = JSON.parse(text);

      if (json.success !== true || typeof json.result?.image !== 'string') {
        throw new Error('Cloudflare returned no generated image');
      }

      const encoded = json.result.image;

      if (
        !encoded.length ||
        encoded.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
      ) {
        throw new Error('Cloudflare returned invalid image encoding');
      }

      const bytes = Buffer.from(encoded, 'base64');

      if (bytes.length > MAX_IMAGE_BYTES) {
        throw new Error('Generated image is too large');
      }

      if (bytes.toString('base64') !== encoded) {
        throw new Error('Cloudflare returned invalid image encoding');
      }

      let pngBytes;
      try {
        pngBytes = await sharp(bytes, { limitInputPixels: 4096 * 4096 }).png().toBuffer();
      } catch {
        throw new Error('Cloudflare returned an unsupported image');
      }

      if (pngBytes.length > MAX_IMAGE_BYTES) {
        throw new Error('Converted image is too large');
      }

      validatePng(pngBytes);

      return {
        bytes: pngBytes,
        provider: 'cloudflare',
        model
      };
    }
  };
}

module.exports = {
  createCloudflareImageProvider,
  DEFAULT_MODEL
};


