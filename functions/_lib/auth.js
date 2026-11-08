// Password check + signed session cookie for the owner's edit page.
//
// Secrets (set in the Cloudflare dashboard, never committed):
//   ADMIN_PASSWORD  the password the owner types on /admin.html
//   SESSION_SECRET  a long random string used to sign the login cookie

const COOKIE = "sps_admin";
const SESSION_SECONDS = 60 * 60 * 12; // stay logged in for 12 hours
const MAX_FAILS = 5; // wrong passwords allowed...
const LOCK_SECONDS = 15 * 60; // ...per 15 minutes, per IP address

const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

// Compare two strings without leaking how many characters matched.
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requireSecrets(env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new Error("ADMIN_PASSWORD and SESSION_SECRET (32+ chars) must be set");
  }
}

export async function passwordMatches(env, input) {
  requireSecrets(env);
  // HMAC both sides so the comparison is fixed-length and constant-time.
  const [a, b] = await Promise.all([
    hmac(env.SESSION_SECRET, "pw:" + String(input || "")),
    hmac(env.SESSION_SECRET, "pw:" + env.ADMIN_PASSWORD),
  ]);
  return safeEqual(a, b);
}

export async function sessionCookie(env, url) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  // Tie the cookie to the current password: changing the password logs everyone out.
  const sig = await hmac(env.SESSION_SECRET, `session:${exp}:${env.ADMIN_PASSWORD}`);
  return `${COOKIE}=${exp}.${sig}; ${cookieAttrs(url)}; Max-Age=${SESSION_SECONDS}`;
}

export function clearCookie(url) {
  return `${COOKIE}=; ${cookieAttrs(url)}; Max-Age=0`;
}

function cookieAttrs(url) {
  const secure = new URL(url).protocol === "https:" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Strict${secure}`;
}

export async function isLoggedIn(request, env) {
  try {
    requireSecrets(env);
  } catch {
    return false;
  }
  const raw = request.headers.get("Cookie") || "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return false;
  const [expStr, sig] = match[1].split(".");
  const exp = parseInt(expStr, 10);
  if (!exp || !sig || exp < Date.now() / 1000) return false;
  const expected = await hmac(env.SESSION_SECRET, `session:${exp}:${env.ADMIN_PASSWORD}`);
  return safeEqual(sig, expected);
}

// Only accept writes sent by our own pages (blocks cross-site form posts).
export function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

// ---- brute-force protection, stored in the same KV namespace ----
function lockKey(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  return `login-fails:${ip}`;
}

export async function isLockedOut(request, env) {
  const n = parseInt((await env.SCHEDULE_KV.get(lockKey(request))) || "0", 10);
  return n >= MAX_FAILS;
}

export async function recordFailure(request, env) {
  const key = lockKey(request);
  const n = parseInt((await env.SCHEDULE_KV.get(key)) || "0", 10);
  await env.SCHEDULE_KV.put(key, String(n + 1), { expirationTtl: LOCK_SECONDS });
}

export async function clearFailures(request, env) {
  await env.SCHEDULE_KV.delete(lockKey(request));
}

export function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}
