import { decryptSecret, encryptSecret, randomHex } from './crypto.mjs';

const COOKIE = 'om_subtitle_guest';
const TTL = 30 * 24 * 60 * 60;

// An authenticated opaque browser credential; never use client-provided owner IDs.
export async function subtitleIdentity(context, visitor, create = false) {
  if (visitor?.email) return { owner: visitor.email, guest: false };
  const token = String(context.request.headers.get('cookie') || '').split(';')
    .map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  let id;
  if (token && token.length < 1024) {
    try {
      const value = JSON.parse(await decryptSecret(token, context.env.APP_ENCRYPTION_KEY));
      if (value.purpose === 'subtitle-browser-v1' && /^[a-f0-9]{64}$/.test(value.id) &&
        Number.isSafeInteger(value.expires) && value.expires > Date.now()) id = value.id;
    } catch { /* Invalid/expired browser credentials do not authorize any recording. */ }
  }
  if (!id && !create) return null;
  id ||= randomHex(32);
  const identity = { owner: 'subtitle-guest:' + id, guest: true };
  if (create) {
    const value = await encryptSecret(JSON.stringify({ purpose: 'subtitle-browser-v1', id, expires: Date.now() + TTL * 1000 }), context.env.APP_ENCRYPTION_KEY);
    identity.cookie = `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${TTL}`;
  }
  return identity;
}
