const axios = require('axios');

function getClient(session) {
  const headers = { 'Content-Type': 'application/json' };
  if (session.api_key) headers['X-Api-Key'] = session.api_key;
  return axios.create({ baseURL: session.api_url, headers, timeout: 15000 });
}

async function startSession(session) {
  const client = getClient(session);
  try {
    const res = await client.post('/api/sessions', {
      name: session.session_name,
      config: { webhooks: [] }
    });
    return res.data;
  } catch (e) {
    if (e.response?.status === 422 || e.response?.data?.message?.includes('exist')) {
      // Session already exists, try to start it
      const res2 = await client.post(`/api/sessions/${session.session_name}/start`);
      return res2.data;
    }
    throw new Error(e.response?.data?.message || e.message);
  }
}

async function stopSession(session) {
  const client = getClient(session);
  try {
    await client.post(`/api/sessions/${session.session_name}/stop`);
  } catch (e) {
    throw new Error(e.response?.data?.message || e.message);
  }
}

async function getSessionStatus(session) {
  const client = getClient(session);
  try {
    const res = await client.get(`/api/sessions/${session.session_name}`);
    return res.data;
  } catch (e) {
    if (e.response?.status === 404) return { status: 'not_found' };
    return { status: 'error', error: e.message };
  }
}

async function sendText(session, chatId, text, mentions = []) {
  const client = getClient(session);
  const payload = {
    chatId,
    text,
    session: session.session_name,
  };
  if (mentions.length > 0) payload.mentions = mentions;

  try {
    const res = await client.post('/api/sendText', payload);
    return res.data;
  } catch (e) {
    throw new Error(e.response?.data?.message || e.message);
  }
}

async function getGroupParticipants(session, groupId) {
  const client = getClient(session);
  try {
    // Try WAHA groups endpoint
    const res = await client.get(`/api/${session.session_name}/groups/${encodeURIComponent(groupId)}/participants`);
    return res.data || [];
  } catch (e) {
    // Try alternative endpoint format
    try {
      const res2 = await client.get(`/api/groups/${encodeURIComponent(groupId)}/participants`, {
        params: { session: session.session_name }
      });
      return res2.data || [];
    } catch {
      console.warn(`[waha] Could not fetch group participants for ${groupId}:`, e.response?.data?.message || e.message);
      return [];
    }
  }
}

async function listChats(session) {
  const client = getClient(session);
  try {
    const res = await client.get(`/api/${session.session_name}/chats`);
    return res.data || [];
  } catch (e) {
    throw new Error(e.response?.data?.message || e.message);
  }
}

module.exports = { startSession, stopSession, getSessionStatus, sendText, getGroupParticipants, listChats };
