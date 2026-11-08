import {
  passwordMatches, sessionCookie, sameOrigin, isLockedOut,
  recordFailure, clearFailures, json,
} from "../_lib/auth.js";

// POST /api/login  { "password": "..." }
export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Bad origin" }, { status: 403 });

  if (await isLockedOut(request, env)) {
    return json({ error: "Too many wrong passwords. Try again in 15 minutes." }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request" }, { status: 400 });
  }

  let ok;
  try {
    ok = await passwordMatches(env, body && body.password);
  } catch {
    return json({ error: "The edit page isn't set up yet (missing password settings)." }, { status: 500 });
  }

  if (!ok) {
    await recordFailure(request, env);
    return json({ error: "That password isn't right." }, { status: 401 });
  }

  await clearFailures(request, env);
  return json({ ok: true }, { headers: { "Set-Cookie": await sessionCookie(env, request.url) } });
}
