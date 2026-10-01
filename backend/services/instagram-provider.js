'use strict';

async function publishInstagram({ userId, accessToken, imageUrl, caption }) {
  if (!userId || !accessToken) throw new Error('Instagram connector is not configured.');

  const createBody = new URLSearchParams({
    image_url: imageUrl,
    caption,
    access_token: accessToken
  });

  const created = await fetch(`https://graph.instagram.com/v24.0/${encodeURIComponent(userId)}/media`, {
    method: 'POST',
    body: createBody
  });
  const createData = await created.json();
  if (!created.ok || !createData.id) {
    throw new Error(createData?.error?.message || 'Instagram media creation failed.');
  }

  await new Promise(resolve => setTimeout(resolve, 5000));

  const publishBody = new URLSearchParams({
    creation_id: createData.id,
    access_token: accessToken
  });

  const published = await fetch(`https://graph.instagram.com/v24.0/${encodeURIComponent(userId)}/media_publish`, {
    method: 'POST',
    body: publishBody
  });
  const publishData = await published.json();
  if (!published.ok || !publishData.id) {
    throw new Error(publishData?.error?.message || 'Instagram publishing failed.');
  }

  return { containerId: createData.id, mediaId: publishData.id };
}

module.exports = { publishInstagram };
