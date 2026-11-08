import { sameOrigin } from "../../_lib/auth.js";
import {
  normalizePhone, cleanName, checkCode, studentCookie, tooMany, json,
} from "../../_lib/studio.js";

// POST /api/auth/verify  { name, phone, code } -> signs the student in
export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Bad origin" }, { status: 403 });
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request" }, { status: 400 }); }

  const name = cleanName(body.name);
  const phone = normalizePhone(body.phone);
  if (!name || !phone) return json({ error: "Missing name or phone." }, { status: 400 });

  if (await tooMany(env, `verify:${phone}`, 6, 600)) {
    return json({ error: "Too many tries. Request a new code in a few minutes." }, { status: 429 });
  }
  if (!(await checkCode(env, request, phone, body.code))) {
    return json({ error: "That code isn't right. Check the text and try again." }, { status: 401 });
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO students (phone, name, created_at) VALUES (?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET name = excluded.name`
  ).bind(phone, name, now).run();
  const student = await env.DB.prepare("SELECT id, name FROM students WHERE phone = ?").bind(phone).first();

  return json({ ok: true, name: student.name }, {
    headers: { "Set-Cookie": await studentCookie(env, request.url, student.id) },
  });
}
