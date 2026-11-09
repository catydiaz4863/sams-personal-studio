// Surveys & reviews.
//
// KV keys
//   surveys              custom surveys Sam made + review survey settings
//   resp:<survey>:<id>   one response (value = JSON; metadata = same JSON when it fits)
//   reviews:public       approved class reviews, ready for the website
//   rl:resp:<ip>         submission rate limit
//
// Every response is a small record: { id, s, t, a, st, f }
//   s = survey id, t = time (ms), a = answers { questionId: value },
//   st = "new" | "approved" | "hidden", f = featured (for marketing)

import { isLoggedIn, sameOrigin, json } from "../_lib/auth.js";

const TYPES = ["stars", "scale", "choice", "multi", "text", "class"];
const MAX_RESPONSES = 5000;

// The built-in class review. Its questions are fixed so the data stays
// comparable month to month; Sam can only open/close it.
export const REVIEW = {
  id: "review",
  kind: "review",
  title: "How was your class?",
  intro: "Takes 30 seconds. Your review helps other students find their class.",
  open: true,
  questions: [
    { id: "class", type: "class", label: "Which class did you take?", required: true },
    { id: "stars", type: "stars", label: "How would you rate it?", required: true },
    { id: "tags", type: "multi", label: "What did you like? (tap any)", options: ["Loved it", "Great workout", "Great for beginners", "Clear instructions", "Fun vibe", "Built my confidence"] },
    { id: "comment", type: "text", long: true, label: "Anything you'd tell a friend? (optional)" },
    { id: "name", type: "text", label: "Your first name (optional)", placeholder: "Shown as first name + last initial" },
    { id: "heard", type: "choice", private: true, label: "How did you hear about us?", options: ["Instagram", "Facebook", "Google", "A friend", "Walked or drove by", "Other"] },
    { id: "recommend", type: "scale", private: true, label: "How likely are you to recommend us to a friend? (0–10)" },
    { id: "tenure", type: "choice", private: true, label: "How long have you trained with us?", options: ["First month", "1–6 months", "6+ months"] },
  ],
};

// ---------- helpers ----------
function clean(v, max) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
}
function newId() {
  return Date.now().toString(36) + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}
function ip(request) {
  return request.headers.get("CF-Connecting-IP") || "local";
}
// "ana rodriguez" -> "Ana R."
export function displayName(raw) {
  const parts = clean(raw, 40).split(" ").filter(Boolean);
  if (!parts.length) return "";
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  return parts.length > 1 ? `${cap(parts[0])} ${parts[parts.length - 1].charAt(0).toUpperCase()}.` : cap(parts[0]);
}

async function loadCustom(env) {
  const raw = await env.SCHEDULE_KV.get("surveys");
  return raw ? JSON.parse(raw) : { reviewOpen: true, surveys: [] };
}
async function allSurveys(env) {
  const saved = await loadCustom(env);
  return [{ ...REVIEW, open: saved.reviewOpen !== false }, ...saved.surveys];
}
async function classOptions(env, request) {
  let schedule = null;
  const saved = await env.SCHEDULE_KV.get("schedule");
  if (saved) schedule = JSON.parse(saved);
  else schedule = await (await env.ASSETS.fetch(new URL("/data/schedule.json", request.url))).json();
  const names = [...new Set((schedule.classes || []).map((c) => c.name))].sort();
  return [...names, "General / the studio"];
}

// Check and tidy one response against its survey.
function validateAnswers(survey, answers, classes) {
  const out = {};
  for (const q of survey.questions) {
    const v = answers ? answers[q.id] : undefined;
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
    if (empty) {
      if (q.required) return { error: `Please answer: ${q.label}` };
      continue;
    }
    if (q.type === "stars" || q.type === "scale") {
      const n = Number(v);
      const max = q.type === "stars" ? 5 : 10;
      const min = q.type === "stars" ? 1 : 0;
      if (!Number.isInteger(n) || n < min || n > max) return { error: `Invalid answer for: ${q.label}` };
      out[q.id] = n;
    } else if (q.type === "choice") {
      if (!q.options.includes(v)) return { error: `Invalid answer for: ${q.label}` };
      out[q.id] = v;
    } else if (q.type === "class") {
      if (!classes.includes(v)) return { error: "Please pick a class from the list." };
      out[q.id] = v;
    } else if (q.type === "multi") {
      if (!Array.isArray(v) || !v.every((x) => q.options.includes(x))) return { error: `Invalid answer for: ${q.label}` };
      out[q.id] = [...new Set(v)];
    } else if (q.type === "text") {
      const t = clean(v, q.long ? 280 : 60);
      if (t) out[q.id] = t;
      else if (q.required) return { error: `Please answer: ${q.label}` };
    }
  }
  return { answers: out };
}

// KV metadata is limited to 1024 bytes; store the record there when it fits
// so Sam's list loads in one call.
function metaFor(rec) {
  const s = JSON.stringify(rec);
  return new TextEncoder().encode(s).length <= 1000 ? rec : { id: rec.id, s: rec.s, t: rec.t, st: rec.st, f: rec.f, big: 1 };
}
async function putResponse(env, rec) {
  await env.SCHEDULE_KV.put(`resp:${rec.s}:${rec.id}`, JSON.stringify(rec), { metadata: metaFor(rec) });
}
async function listResponses(env, surveyId) {
  const out = [];
  let cursor;
  do {
    const page = await env.SCHEDULE_KV.list({ prefix: `resp:${surveyId}:`, cursor });
    for (const k of page.keys) {
      if (k.metadata && !k.metadata.big) out.push(k.metadata);
      else {
        const v = await env.SCHEDULE_KV.get(k.name);
        if (v) out.push(JSON.parse(v));
      }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && out.length < MAX_RESPONSES);
  return out.sort((a, b) => b.t - a.t);
}

// Approved class reviews, shaped for the website (no private answers).
async function rebuildPublic(env) {
  const all = await listResponses(env, "review");
  const reviews = all
    .filter((r) => r.st === "approved")
    .slice(0, 300)
    .map((r) => ({
      class: r.a.class,
      stars: r.a.stars,
      tags: r.a.tags || [],
      comment: r.a.comment || "",
      name: displayName(r.a.name) || "A student",
      date: new Date(r.t).toISOString().slice(0, 10),
      featured: !!r.f,
    }));
  await env.SCHEDULE_KV.put("reviews:public", JSON.stringify(reviews));
}

// ---------- public ----------

// GET /api/survey?id=review  -> the survey to show
// POST /api/survey           -> { id, answers, website (honeypot), ms }
export const survey = {
  async onRequestGet({ request, env }) {
    const id = new URL(request.url).searchParams.get("id") || "";
    const s = (await allSurveys(env)).find((x) => x.id === id);
    if (!s) return json({ error: "This survey doesn't exist." }, { status: 404 });
    if (!s.open) return json({ closed: true, title: s.title });
    const body = { id: s.id, kind: s.kind || "custom", title: s.title, intro: s.intro || "", questions: s.questions };
    if (s.questions.some((q) => q.type === "class")) body.classes = await classOptions(env, request);
    return json(body);
  },

  async onRequestPost({ request, env }) {
    if (!sameOrigin(request)) return json({ error: "Bad origin" }, { status: 403 });
    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad request" }, { status: 400 }); }

    // Bots fill the hidden field or submit instantly. Pretend it worked.
    if (body.website || Number(body.ms) < 2500) return json({ ok: true });

    const key = `rl:resp:${ip(request)}`;
    const n = parseInt((await env.SCHEDULE_KV.get(key)) || "0", 10);
    if (n >= 8) return json({ error: "Thanks! You've sent a lot of answers already. Try again later." }, { status: 429 });

    const s = (await allSurveys(env)).find((x) => x.id === body.id);
    if (!s || !s.open) return json({ error: "This survey is closed." }, { status: 404 });
    const classes = s.questions.some((q) => q.type === "class") ? await classOptions(env, request) : [];
    const result = validateAnswers(s, body.answers, classes);
    if (result.error) return json({ error: result.error }, { status: 400 });

    await env.SCHEDULE_KV.put(key, String(n + 1), { expirationTtl: 3600 });
    await putResponse(env, { id: newId(), s: s.id, t: Date.now(), a: result.answers, st: "new", f: false });
    return json({ ok: true });
  },
};

// GET /api/reviews -> approved reviews for the website
export const reviews = {
  async onRequestGet({ env }) {
    const raw = await env.SCHEDULE_KV.get("reviews:public");
    return new Response(raw || "[]", {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" },
    });
  },
};

// ---------- Sam only ----------
async function guard(request, env, write) {
  if (write && !sameOrigin(request)) return json({ error: "Bad origin" }, { status: 403 });
  if (!(await isLoggedIn(request, env))) return json({ error: "You've been logged out. Log in again." }, { status: 401 });
  return null;
}

function validateSurveys(list) {
  if (!Array.isArray(list) || list.length > 30) return { error: "Too many surveys." };
  const out = [];
  const ids = new Set(["review"]);
  for (const s of list) {
    const title = clean(s && s.title, 80);
    if (!title) return { error: "Every survey needs a title." };
    let id = clean(s.id, 24).toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!id || ids.has(id)) id = newId();
    ids.add(id);
    const qs = [];
    const qids = new Set();
    for (const q of (s.questions || []).slice(0, 25)) {
      const label = clean(q && q.label, 140);
      if (!label) continue;
      if (!TYPES.includes(q.type) || q.type === "class") return { error: `"${title}" has a question with an unknown type.` };
      let qid = clean(q.id, 16).replace(/[^a-zA-Z0-9]/g, "") || "q" + (qs.length + 1);
      while (qids.has(qid)) qid += "x";
      qids.add(qid);
      const item = { id: qid, type: q.type, label, required: !!q.required };
      if (q.type === "choice" || q.type === "multi") {
        const opts = [...new Set((q.options || []).map((o) => clean(o, 60)).filter(Boolean))].slice(0, 12);
        if (opts.length < 2) return { error: `"${label}" needs at least 2 options.` };
        item.options = opts;
      }
      if (q.type === "text" && q.long) item.long = true;
      qs.push(item);
    }
    if (!qs.length) return { error: `"${title}" needs at least one question.` };
    out.push({ id, kind: "custom", title, intro: clean(s.intro, 300), open: s.open !== false, questions: qs, created: s.created || Date.now() });
  }
  return { surveys: out };
}

// GET /api/admin/surveys  -> all surveys
// PUT /api/admin/surveys  -> { reviewOpen, surveys: [custom...] }
export const adminSurveys = {
  async onRequestGet({ request, env }) {
    const denied = await guard(request, env, false);
    if (denied) return denied;
    return json({ surveys: await allSurveys(env) });
  },
  async onRequestPut({ request, env }) {
    const denied = await guard(request, env, true);
    if (denied) return denied;
    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad request" }, { status: 400 }); }
    const result = validateSurveys(body.surveys);
    if (result.error) return json({ error: result.error }, { status: 400 });
    await env.SCHEDULE_KV.put("surveys", JSON.stringify({ reviewOpen: body.reviewOpen !== false, surveys: result.surveys }));
    return json({ surveys: await allSurveys(env) });
  },
};

// GET  /api/admin/responses?survey=id   -> every response (newest first)
// POST /api/admin/responses  { survey, id, status?, featured?, remove? }
export const adminResponses = {
  async onRequestGet({ request, env }) {
    const denied = await guard(request, env, false);
    if (denied) return denied;
    const sid = new URL(request.url).searchParams.get("survey") || "";
    if (!/^[a-z0-9-]{1,40}$/.test(sid)) return json({ error: "Bad survey id" }, { status: 400 });
    return json({ responses: await listResponses(env, sid) });
  },
  async onRequestPost({ request, env }) {
    const denied = await guard(request, env, true);
    if (denied) return denied;
    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad request" }, { status: 400 }); }
    const sid = String(body.survey || "");
    const rid = String(body.id || "");
    if (!/^[a-z0-9-]{1,40}$/.test(sid) || !/^[a-z0-9]{1,40}$/.test(rid)) return json({ error: "Bad id" }, { status: 400 });
    const key = `resp:${sid}:${rid}`;
    const raw = await env.SCHEDULE_KV.get(key);
    if (!raw) return json({ error: "That response no longer exists." }, { status: 404 });
    if (body.remove) {
      await env.SCHEDULE_KV.delete(key);
    } else {
      const rec = JSON.parse(raw);
      if (["new", "approved", "hidden"].includes(body.status)) rec.st = body.status;
      if (typeof body.featured === "boolean") rec.f = body.featured;
      await putResponse(env, rec);
    }
    if (sid === "review") await rebuildPublic(env);
    return json({ ok: true });
  },
};
