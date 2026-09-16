const { validatePng } = require('./png-validation');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_RESPONSE_BYTES = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 65536;
const GENERATION_TIMEOUT_MS = 120000;

function localImageEndpoint(baseUrl = 'http://127.0.0.1:1234') {
  const url = new URL(baseUrl);
  // IP literals avoid DNS rebinding. No credentials, proxy path or redirects.
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Image runtime must use a loopback HTTP origin');
  }
  return new URL('/v1/images/generations', url).href;
}

function validateImagePrompt(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) {
    return 'Image prompt must contain 1 to 4000 characters';
  }
  // sd-server interprets these tags as JSON controls, not ordinary image text.
  if (/sd_cpp_extra_args/i.test(prompt)) return 'Image prompt must not contain runtime control tags';
  return null;
}

async function decodeImageResponse(response) {
  if (!response.ok) throw new Error('Local image runtime rejected generation');
  const lengthHeader = response.headers?.get('content-length');
  if (lengthHeader && Number(lengthHeader) > MAX_RESPONSE_BYTES) throw new Error('Image response is too large');
  let length = 0;
  const chunks = [];
  if (!response.body) throw new Error('Local image runtime returned no response');
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > MAX_RESPONSE_BYTES) throw new Error('Image response is too large');
    chunks.push(Buffer.from(chunk));
  }
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!Array.isArray(result.data) || result.data.length !== 1) throw new Error('Expected one generated image');
  const encoded = result.data[0]?.b64_json;
  if (typeof encoded !== 'string' || !encoded.length || encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Local runtime returned no encoded image');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new Error('Invalid image encoding');
  validatePng(bytes);
  return bytes;
}

function createLocalImageProvider(config, fetchImpl = fetch) {
  const endpoint = localImageEndpoint(config.baseUrl);
  if (typeof config.model !== 'string' || !config.model.trim() || config.model.length > 200) {
    throw new Error('Record the reviewed local model and version');
  }
  return {
    provider: 'sd-cpp', model: config.model.trim(),
    async generate({ prompt, signal }) {
      const error = validateImagePrompt(prompt);
      if (error) throw new Error(error);
      const timeout = AbortSignal.timeout(GENERATION_TIMEOUT_MS);
      const response = await fetchImpl(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // The model label records provenance. sd-server loads the actual model weights.
        body: JSON.stringify({ prompt: prompt.trim(), n: 1, size: '768x512', output_format: 'png' }),
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout, redirect: 'error'
      });
      return { bytes: await decodeImageResponse(response), provider: 'sd-cpp', model: config.model.trim() };
    }
  };
}

module.exports = { createLocalImageProvider, localImageEndpoint, validateImagePrompt,
  decodeImageResponse, MAX_IMAGE_BYTES, MAX_RESPONSE_BYTES, GENERATION_TIMEOUT_MS };
