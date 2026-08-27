// functions/api/contact.js
// ARCKESIS contact form endpoint. Cloudflare Pages Function.
//
// Reads: name, email, message, website (honeypot), turnstileToken
// Sends: one email to CONTACT_TO via Resend, with the sender in reply-to
// Stores: nothing
//
// Required environment values, set in Cloudflare Pages, Settings, Variables and Secrets:
//   TURNSTILE_SECRET   (secret)
//   RESEND_API_KEY     (secret)
//   CONTACT_TO         (plain text, your real inbox)
//   CONTACT_FROM       (plain text, e.g. ARCKESIS <hello@send.arckesis.com>)

const LIMIT = { name: 100, email: 254, subject: 150, message: 5000 };

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

// Anything going into an email header must not contain line breaks.
function headerSafe(value) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

async function verifyTurnstile(token, secret, ip) {
  if (!secret) return true; // not configured yet, do not block the form
  if (!token) return false;

  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);

  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body }
    );
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    return false;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  // Honeypot. A bot fills every field it finds. Answer as if it worked.
  if (clean(payload.website, 200) !== "") {
    return json({ ok: true });
  }

  const name = clean(payload.name, LIMIT.name);
  const email = clean(payload.email, LIMIT.email);
  const subject = headerSafe(clean(payload.subject, LIMIT.subject));
  const message = clean(payload.message, LIMIT.message);

  if (!name || !email || !message) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }
  if (!looksLikeEmail(email)) {
    return json({ ok: false, error: "bad_email" }, 400);
  }
  if (message.length < 10) {
    return json({ ok: false, error: "message_too_short" }, 400);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const human = await verifyTurnstile(payload.turnstileToken, env.TURNSTILE_SECRET, ip);
  if (!human) {
    return json({ ok: false, error: "verification_failed" }, 403);
  }

  if (!env.RESEND_API_KEY || !env.CONTACT_TO || !env.CONTACT_FROM) {
    return json({ ok: false, error: "not_configured" }, 500);
  }

  const safe = {
    name: escapeHtml(name),
    email: escapeHtml(email),
    subject: escapeHtml(subject),
    message: escapeHtml(message).replace(/\n/g, "<br>"),
  };

  const html =
    '<div style="font-family:Georgia,serif;font-size:15px;line-height:24px;color:#302F2D">' +
    "<p><strong>From:</strong> " + safe.name + " (" + safe.email + ")</p>" +
    (subject ? "<p><strong>Subject:</strong> " + safe.subject + "</p>" : "") +
    "<p><strong>Message:</strong></p>" +
    "<p>" + safe.message + "</p>" +
    '<hr style="border:none;border-top:1px solid #E8E0D0;margin:24px 0">' +
    '<p style="font-size:12px;color:#8a8781">Sent from the contact form on arckesis.com</p>' +
    "</div>";

  const text =
    "From: " + name + " (" + email + ")\n" +
    (subject ? "Subject: " + subject + "\n" : "") +
    "\n" + message +
    "\n\n---\nSent from the contact form on arckesis.com";

  const emailSubject = subject
    ? "ARCKESIS: " + subject
    : "ARCKESIS contact form: " + name;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.CONTACT_FROM,
        to: [env.CONTACT_TO],
        reply_to: email,
        subject: emailSubject,
        html: html,
        text: text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.log("Resend error", res.status, detail);
      return json({ ok: false, error: "send_failed" }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    console.log("Contact endpoint error", String(err));
    return json({ ok: false, error: "send_failed" }, 502);
  }
}

// Anything that is not a POST.
export async function onRequest() {
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
