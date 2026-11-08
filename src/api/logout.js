import { clearCookie, json } from "../_lib/auth.js";

// POST /api/logout
export async function onRequestPost({ request }) {
  return json({ ok: true }, { headers: { "Set-Cookie": clearCookie(request.url) } });
}
