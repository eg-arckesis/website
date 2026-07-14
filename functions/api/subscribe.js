// ARCKESIS / Cloudflare Pages Function
// Lives at: functions/api/subscribe.js
// Becomes the live endpoint: https://arckesis.com/api/subscribe
//
// Your MailerLite API key is never in this file. It is read at runtime from
// the encrypted secret you added in the Cloudflare dashboard.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

export async function onRequestPost({ request, env }) {
  const { email, consent } = await request.json().catch(() => ({}));

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ ok: false, error: 'Enter a valid email address.' }, 400);
  }

  if (consent !== true) {
    return json({ ok: false, error: 'Tick the box to confirm.' }, 400);
  }

  const res = await fetch('https://connect.mailerlite.com/api/subscribers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${env.MAILERLITE_API_KEY}`
    },
    body: JSON.stringify({
      email,
      groups: [env.MAILERLITE_GROUP_ID],
      status: 'unconfirmed'
    })
  });

  if (!res.ok) {
    const detail = await res.text();
    console.log('MailerLite error', res.status, detail);
    return json({ ok: false, error: 'That did not send.' }, 502);
  }

  return json({ ok: true });
}
