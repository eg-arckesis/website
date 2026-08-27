// functions/api/subscribe.js
// ARCKESIS email capture endpoint. Cloudflare Pages Function.
//
// Adds a contact to an EmailOctopus list via API v2.
// Double opt-in is controlled by the list settings in EmailOctopus, not here.
//
// Required environment values, set in Cloudflare Pages, Settings, Variables and Secrets:
//   EMAILOCTOPUS_API_KEY   (secret)
//   EMAILOCTOPUS_LIST_ID   (plain text)

const API_BASE = "https://api.emailoctopus.com";
const LIMIT = { email: 254 };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function clean(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  // Honeypot, if the form has one. A bot fills every field it finds.
  if (clean(payload.website, 200) !== "") {
    return json({ ok: true });
  }

  // Accept either key name so this works whatever the form sends.
  const email = clean(payload.email || payload.email_address, LIMIT.email).toLowerCase();

  if (!email) {
    return json({ ok: false, error: "missing_email" }, 400);
  }
  if (!looksLikeEmail(email)) {
    return json({ ok: false, error: "bad_email" }, 400);
  }

  if (!env.EMAILOCTOPUS_API_KEY || !env.EMAILOCTOPUS_LIST_ID) {
    return json({ ok: false, error: "not_configured" }, 500);
  }

  // Which form the signup came from, so the source is visible in EmailOctopus.
  const source = clean(payload.source, 40);
  const tags = source ? [source] : [];

  const body = { email_address: email };
  if (tags.length) body.tags = tags;
  // "status" is deliberately omitted. EmailOctopus then uses the list's own
  // double opt-in setting to decide between pending and subscribed.

  const url = API_BASE + "/lists/" + env.EMAILOCTOPUS_LIST_ID + "/contacts";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.EMAILOCTOPUS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 201 || res.status === 200) {
      return json({ ok: true });
    }

    // Already on the list. Not an error from the visitor's point of view, and
    // saying so out loud would confirm to a stranger who is subscribed.
    if (res.status === 409) {
      return json({ ok: true });
    }

    if (res.status === 422) {
      return json({ ok: false, error: "bad_email" }, 400);
    }

    const detail = await res.text();
    console.log("EmailOctopus error", res.status, detail);
    return json({ ok: false, error: "subscribe_failed" }, 502);
  } catch (err) {
    console.log("Subscribe endpoint error", String(err));
    return json({ ok: false, error: "subscribe_failed" }, 502);
  }
}

// Anything that is not a POST.
export async function onRequest() {
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
