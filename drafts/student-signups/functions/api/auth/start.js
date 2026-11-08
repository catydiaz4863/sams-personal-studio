import { sameOrigin } from "../../_lib/auth.js";
import { normalizePhone, cleanName, sendCode, tooMany, clientIp, json } from "../../_lib/studio.js";

// POST /api/auth/start  { name, phone }  -> texts a 6-digit code
export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Bad origin" }, { status: 403 });
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request" }, { status: 400 }); }

  const name = cleanName(body.name);
  const phone = normalizePhone(body.phone);
  if (!name) return json({ error: "Please enter your name." }, { status: 400 });
  if (!phone) return json({ error: "Please enter a 10-digit US phone number." }, { status: 400 });

  // Limit texts: 3 per number per 10 minutes, 15 per device/network per hour.
  if (await tooMany(env, `code-phone:${phone}`, 3, 600) || await tooMany(env, `code-ip:${clientIp(request)}`, 15, 3600)) {
    return json({ error: "Too many codes requested. Wait a few minutes and try again." }, { status: 429 });
  }

  const sent = await sendCode(env, request, phone);
  if (!sent.ok) return json({ error: sent.error }, { status: 502 });
  return json({ ok: true, dev: !!sent.dev });
}
