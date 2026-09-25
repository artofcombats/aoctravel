/* 曼谷拳旅手冊 — 推播發送端 (Cloudflare Worker)
   用途：手機訂閱推播、發公告時把通知送到所有裝置。
   綁定：KV namespace "SUBS"；機密 VAPID_PUBLIC / VAPID_PRIVATE / VAPID_SUBJECT / NOTIFY_TOKEN */

import { buildPushPayload } from '@block65/webcrypto-web-push';

const ALLOW_ORIGIN = 'https://artofcombats.github.io';

function cors(extra) {
  return Object.assign({
    'access-control-allow-origin': ALLOW_ORIGIN,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  }, extra || {});
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: cors({ 'content-type': 'application/json; charset=utf-8' }),
  });
}

async function keyFor(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return 'sub:' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function listSubs(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.SUBS.list({ prefix: 'sub:', cursor });
    for (const k of page.keys) {
      const v = await env.SUBS.get(k.name, 'json');
      if (v && v.endpoint) out.push({ name: k.name, sub: v });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (url.pathname === '/' ) return json({ ok: true, service: 'aoc-push' });

    if (url.pathname === '/subscribe' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      const sub = body && body.subscription;
      if (!sub || !sub.endpoint || !sub.keys || !sub.keys.auth || !sub.keys.p256dh) {
        return json({ ok: false, error: 'bad subscription' }, 400);
      }
      const name = await keyFor(sub.endpoint);
      await env.SUBS.put(name, JSON.stringify({
        endpoint: sub.endpoint,
        expirationTime: sub.expirationTime ?? null,
        keys: { auth: sub.keys.auth, p256dh: sub.keys.p256dh },
        label: String(body.label || '').slice(0, 40),
        createdAt: Date.now(),
      }), { expirationTtl: 60 * 60 * 24 * 120 });   /* 120 天後自動消失，行程結束不用手動清 */
      return json({ ok: true });
    }

    if (url.pathname === '/unsubscribe' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body || !body.endpoint) return json({ ok: false, error: 'bad request' }, 400);
      await env.SUBS.delete(await keyFor(body.endpoint));
      return json({ ok: true });
    }

    if (url.pathname === '/notify' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body || body.token !== env.NOTIFY_TOKEN) return json({ ok: false, error: 'unauthorized' }, 401);

      const payload = {
        title: String(body.title || '曼谷拳旅手冊').slice(0, 80),
        body: String(body.body || '').slice(0, 120),
        url: String(body.url || ALLOW_ORIGIN + '/aoctravel/#home'),
        tag: 'bkk-post',
      };
      const vapid = {
        subject: env.VAPID_SUBJECT,
        publicKey: env.VAPID_PUBLIC,
        privateKey: env.VAPID_PRIVATE,
      };

      const subs = await listSubs(env);
      const skip = await (body.excludeEndpoint ? keyFor(body.excludeEndpoint) : Promise.resolve(null));
      let sent = 0, pruned = 0, failed = 0;

      await Promise.all(subs.map(async ({ name, sub }) => {
        if (skip && name === skip) return;
        try {
          const req = await buildPushPayload({ data: payload, options: { ttl: 3600, urgency: 'high' } }, sub, vapid);
          const res = await fetch(sub.endpoint, { method: req.method, headers: req.headers, body: req.body });
          if (res.status === 404 || res.status === 410) { await env.SUBS.delete(name); pruned++; return; }
          if (res.ok || res.status === 201) { sent++; return; }
          failed++;
        } catch (e) {
          failed++;
        }
      }));

      return json({ ok: true, sent, pruned, failed, total: subs.length });
    }

    return json({ ok: false, error: 'not found' }, 404);
  },
};
