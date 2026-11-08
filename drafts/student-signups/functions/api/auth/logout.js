import { clearStudentCookie, json } from "../../_lib/studio.js";

// POST /api/auth/logout
export async function onRequestPost({ request }) {
  return json({ ok: true }, { headers: { "Set-Cookie": clearStudentCookie(request.url) } });
}
