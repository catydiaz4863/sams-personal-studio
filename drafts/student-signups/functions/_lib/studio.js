// Shared helpers for student sign-ups: studio clock, schedule, phone numbers,
// student login cookie and text-message codes.
import { json } from "./auth.js";

export const TZ = "America/Chicago"; // McAllen, TX
export const SIGNUP_DAYS = 7;        // how far ahead students can sign up
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const STUDENT_COOKIE = "sps_student";
const STUDENT_SECONDS = 60 * 60 * 24 * 365; // stay signed in on a phone for a year

const enc = new TextEncoder();

// ---------- studio clock ----------
export function studioNow(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// The next N days starting today (studio time): [{ date, day }]
export function upcomingDays(n = SIGNUP_DAYS) {
  const [y, m, d] = studioNow().date.split("-").map(Number);
  const out = [];
  for (let i = 0; i < n; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    out.push({ date: dt.toISOString().slice(0, 10), day: DAY_KEYS[dt.getUTCDay()] });
  }
  return out;
}

export function dayKeyOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return DAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function isPast(date, time) {
  const now = studioNow();
  return date < now.date || (date === now.date && time <= now.time);
}

// ---------- schedule ----------
export async function loadSchedule(env, request) {
  const saved = await env.SCHEDULE_KV.get("schedule");
  if (saved) return JSON.parse(saved);
  const res = await env.ASSETS.fetch(new URL("/data/schedule.json", request.url));
  return res.json();
}

// ---------- phone numbers (US only) ----------
export function normalizePhone(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits[0] === "1") return "+" + digits;
  return null;
}

export function cleanName(input) {
  return String(input || "").replace(/\s+/g, " ").trim().slice(0, 60);
}

// ---------- student login cookie ----------
async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookieAttrs(url) {
  const secure = new URL(url).protocol === "https:" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export async function studentCookie(env, url, studentId) {
  const exp = Math.floor(Date.now() / 1000) + STUDENT_SECONDS;
  const sig = await hmac(env.SESSION_SECRET, `student:${studentId}:${exp}`);
  return `${STUDENT_COOKIE}=${studentId}.${exp}.${sig}; ${cookieAttrs(url)}; Max-Age=${STUDENT_SECONDS}`;
}

export function clearStudentCookie(url) {
  return `${STUDENT_COOKIE}=; ${cookieAttrs(url)}; Max-Age=0`;
}

// Returns the signed-in student row, or null.
export async function currentStudent(request, env) {
  if (!env.SESSION_SECRET) return null;
  const raw = request.headers.get("Cookie") || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${STUDENT_COOKIE}=([^;]+)`));
  if (!m) return null;
  const [idStr, expStr, sig] = m[1].split(".");
  const id = parseInt(idStr, 10);
  const exp = parseInt(expStr, 10);
  if (!id || !exp || !sig || exp < Date.now() / 1000) return null;
  const expected = await hmac(env.SESSION_SECRET, `student:${id}:${exp}`);
  if (!safeEqual(sig, expected)) return null;
  return env.DB.prepare("SELECT id, name, phone FROM students WHERE id = ?").bind(id).first();
}

// ---------- text-message codes (Twilio Verify) ----------
// On your own computer, set DEV_FAKE_SMS=true in .dev.vars: no text is sent
// and the code is always 123456. This only works on localhost.
function fakeSms(env, request) {
  const host = new URL(request.url).hostname;
  return env.DEV_FAKE_SMS === "true" && (host === "localhost" || host === "127.0.0.1");
}

function twilioAuth(env) {
  return "Basic " + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
}

export async function sendCode(env, request, phone) {
  if (fakeSms(env, request)) return { ok: true, dev: true };
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_VERIFY_SID) {
    return { ok: false, error: "Text messages aren't set up yet. Please text the studio to sign up." };
  }
  const res = await fetch(`https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SID}/Verifications`, {
    method: "POST",
    headers: { Authorization: twilioAuth(env), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: phone, Channel: "sms" }),
  });
  if (!res.ok) return { ok: false, error: "We couldn't text that number. Check it and try again." };
  return { ok: true };
}

export async function checkCode(env, request, phone, code) {
  code = String(code || "").replace(/\D/g, "");
  if (code.length < 4 || code.length > 8) return false;
  if (fakeSms(env, request)) return code === "123456";
  const res = await fetch(`https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SID}/VerificationCheck`, {
    method: "POST",
    headers: { Authorization: twilioAuth(env), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: phone, Code: code }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.status === "approved";
}

// ---------- simple rate limit (KV counter per key) ----------
export async function tooMany(env, key, limit, seconds) {
  const k = `rl:${key}`;
  const n = parseInt((await env.SCHEDULE_KV.get(k)) || "0", 10);
  if (n >= limit) return true;
  await env.SCHEDULE_KV.put(k, String(n + 1), { expirationTtl: Math.max(60, seconds) });
  return false;
}

export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "local";
}

export { json };
