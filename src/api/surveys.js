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
    { id: "class", type: "class", label: "Which class did you take?", required: true, locked: true },
    { id: "stars", type: "stars", label: "How would you rate it?", required: true, locked: true },
    { id: "tags", type: "multi", label: "What did you like? (tap any)", options: ["Loved it", "Great workout", "Great for beginners", "Clear instructions", "Fun vibe", "Built my confidence"] },
    { id: "comment", type: "text", long: true, label: "Anything you'd tell a friend? (optional)", locked: true },
    { id: "name", type: "text", label: "Your first name (optional)", placeholder: "Shown as first name + last initial", locked: true },
    { id: "heard", type: "choice", private: true, label: "How did you hear about us?", options: ["Instagram", "Facebook", "Google", "A friend", "Walked or drove by", "Other"] },
    { id: "recommend", type: "scale", private: true, label: "How likely are you to recommend us to a friend? (0–10)" },
    { id: "tenure", type: "choice", private: true, label: "How long have you trained with us?", options: ["First month", "1–6 months", "6+ months"] },
  ],
};

// Starter templates; once Sam edits templates, his saved list is used.
const DEFAULT_TEMPLATES = [
  { id: "t-event", icon: "◆", tone: "orange", title: "Event feedback", intro: "Thanks for coming! Tell us how it went.", questions: [
    { type: "stars", label: "How would you rate the event?", required: true },
    { type: "multi", label: "What did you enjoy?", options: ["The instructor", "The music", "The choreography", "Meeting people", "The space"] },
    { type: "choice", label: "Would you come to another one?", options: ["Definitely", "Maybe", "Probably not"], required: true },
    { type: "text", long: true, label: "Anything we could do better?" }] },
  { id: "t-next", icon: "＋", tone: "pink", title: "What class should we add next?", intro: "Help us plan the next schedule.", questions: [
    { type: "multi", label: "Which classes would you take?", options: ["Heels / exotic", "Spin pole advanced", "Flexibility & stretch", "Floorwork", "Belly dance level 2", "Choreography"], required: true },
    { type: "text", long: true, label: "Any other ideas?" }] },
  { id: "t-times", icon: "◷", tone: "blue", title: "Best class times", intro: "We want to schedule classes when you can make it.", questions: [
    { type: "multi", label: "Which days work for you?", options: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], required: true },
    { type: "multi", label: "What times work for you?", options: ["Morning (before 12)", "Afternoon (12–5)", "Evening (after 5)"], required: true }] },
  { id: "t-new", icon: "✿", tone: "green", title: "New student check-in", intro: "Welcome to the studio! A few quick questions.", questions: [
    { type: "choice", label: "Have you done pole or dance before?", options: ["Never", "A little", "Yes, a lot"], required: true },
    { type: "multi", label: "What are your goals?", options: ["Get stronger", "Get flexible", "Have fun", "Build confidence", "Learn tricks", "Perform"] },
    { type: "choice", label: "How did you hear about us?", options: ["Instagram", "Facebook", "Google", "A friend", "Walked or drove by", "Other"] },
    { type: "text", long: true, label: "Any injuries or anything we should know?" }] },
];
const TONES = ["pink", "blue", "orange", "green"];

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

function cookieDone(request) {
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)svd=([^;]+)/);
  return m ? decodeURIComponent(m[1]).split(".").filter(Boolean) : [];
}
function doneCookie(request, ids) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `svd=${encodeURIComponent(ids.slice(-40).join("."))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`;
}
const TOKEN = /^[a-z0-9]{16,40}$/;
async function tokenState(env, sid, token) {
  if (!TOKEN.test(String(token || ""))) return "invalid";
  const v = await env.SCHEDULE_KV.get(`tok:${sid}:${token}`);
  return v === "open" ? "open" : v === "used" ? "used" : "invalid";
}

async function loadCustom(env) {
  const raw = await env.SCHEDULE_KV.get("surveys");
  return raw ? JSON.parse(raw) : { reviewOpen: true, surveys: [] };
}
async function allSurveys(env) {
  const saved = await loadCustom(env);
  const r = saved.review || {};
  const review = {
    ...REVIEW,
    title: r.title || REVIEW.title,
    intro: r.intro != null ? r.intro : REVIEW.intro,
    questions: r.questions || REVIEW.questions,
    access: r.access === "links" ? "links" : "anyone",
    open: saved.reviewOpen !== false,
  };
  return [review, ...saved.surveys];
}
async function loadEvents(env, request) {
  const saved = await env.SCHEDULE_KV.get("schedule");
  const data = saved ? JSON.parse(saved) : await (await env.ASSETS.fetch(new URL("/data/schedule.json", request.url))).json();
  return data.events || [];
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
    const url = new URL(request.url);
    if (s.access === "links") {
      const st = await tokenState(env, s.id, url.searchParams.get("t"));
      if (st === "used") return json({ done: true, title: s.title });
      if (st !== "open") return json({ invalid: true, title: s.title });
    } else if (cookieDone(request).includes(s.id)) {
      return json({ done: true, title: s.title });
    }
    const body = { id: s.id, kind: s.kind || "custom", title: s.title, intro: s.intro || "", questions: s.questions };
    if (s.event) {
      const ev = (await loadEvents(env, request)).find((e) => e.id === s.event);
      if (ev) body.event = { title: ev.title, date: ev.date };
    }
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
    const done = cookieDone(request);
    if (s.access === "links") {
      const st = await tokenState(env, s.id, body.t);
      if (st === "used") return json({ error: "This link was already used. Each link works once." }, { status: 409 });
      if (st !== "open") return json({ error: "This survey link isn't valid. Ask the studio for a new one." }, { status: 403 });
    } else if (done.includes(s.id)) {
      return json({ error: "You've already answered this survey. Thank you!" }, { status: 409 });
    }
    const classes = s.questions.some((q) => q.type === "class") ? await classOptions(env, request) : [];
    const result = validateAnswers(s, body.answers, classes);
    if (result.error) return json({ error: result.error }, { status: 400 });

    // Use up the one-time link before saving, so it can't be reused.
    if (s.access === "links") await env.SCHEDULE_KV.put(`tok:${s.id}:${body.t}`, "used", { expirationTtl: 60 * 60 * 24 * 365, metadata: { used: 1 } });
    await env.SCHEDULE_KV.put(key, String(n + 1), { expirationTtl: 3600 });

    // Reviews only need Sam's OK when they include words people typed
    // (a comment or a name). Stars and tags alone go live right away.
    const needsOk = s.kind === "review" && !!(result.answers.comment || result.answers.name);
    const status = s.kind === "review" && !needsOk ? "approved" : "new";
    await putResponse(env, { id: newId(), s: s.id, t: Date.now(), a: result.answers, st: status, f: false });
    if (s.kind === "review" && status === "approved") await rebuildPublic(env);

    const headers = s.access === "links" ? {} : { "Set-Cookie": doneCookie(request, done.concat(s.id)) };
    return json({ ok: true, needsOk }, { headers });
  },
};

// GET /api/survey-links -> open surveys that belong to an event
export const surveyLinks = {
  async onRequestGet({ env }) {
    const all = await allSurveys(env);
    const list = all.filter((s) => s.open && s.event && s.access !== "links").map((s) => ({ id: s.id, title: s.title, event: s.event }));
    return json({ links: list, reviewPublic: all[0].open && all[0].access !== "links" });
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

function validateQuestions(list, title, isReview) {
  const qs = [];
  const qids = new Set();
  for (const q of (list || []).slice(0, 25)) {
    const label = clean(q && q.label, 140);
    if (!label) continue;
    const core = isReview ? REVIEW.questions.find((x) => x.locked && x.id === q.id) : null;
    if (core) {
      qs.push({ ...core, label });
      qids.add(core.id);
      continue;
    }
    if (!TYPES.includes(q.type) || q.type === "class") return { error: `"${title}" has a question with an unknown type.` };
    let qid = clean(q.id, 16).replace(/[^a-zA-Z0-9]/g, "") || "q" + (qs.length + 1);
    while (qids.has(qid) || (isReview && REVIEW.questions.some((x) => x.locked && x.id === qid))) qid += "x";
    qids.add(qid);
    const item = { id: qid, type: q.type, label, required: !!q.required };
    if (q.type === "choice" || q.type === "multi") {
      const opts = [...new Set((q.options || []).map((o) => clean(o, 60)).filter(Boolean))].slice(0, 12);
      if (opts.length < 2) return { error: `"${label}" needs at least 2 options.` };
      item.options = opts;
    }
    if (q.type === "text" && q.long) item.long = true;
    if (q.private) item.private = true;
    qs.push(item);
  }
  if (isReview) {
    // the four core questions can be reworded but never removed
    REVIEW.questions.filter((x) => x.locked && !qids.has(x.id)).forEach((x) => qs.push({ ...x }));
    const order = (q) => (q.locked ? REVIEW.questions.indexOf(REVIEW.questions.find((x) => x.id === q.id)) : 50);
    qs.sort((a, b) => order(a) - order(b));
  }
  if (!qs.length) return { error: `"${title}" needs at least one question.` };
  return { questions: qs };
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
    const v = validateQuestions(s.questions, title, false);
    if (v.error) return v;
    const event = /^[a-z0-9]{6,24}$/.test(String(s.event || "")) ? s.event : "";
    out.push({ id, kind: "custom", title, intro: clean(s.intro, 300), open: s.open !== false, event,
      access: s.access === "links" ? "links" : "anyone", questions: v.questions, created: s.created || Date.now() });
  }
  return { surveys: out };
}

// GET /api/admin/surveys  -> all surveys
// PUT /api/admin/surveys  -> { reviewOpen, surveys: [custom...] }
export const adminSurveys = {
  async onRequestGet({ request, env }) {
    const denied = await guard(request, env, false);
    if (denied) return denied;
    const saved = await loadCustom(env);
    return json({ surveys: await allSurveys(env), templates: saved.templates || DEFAULT_TEMPLATES });
  },
  async onRequestPut({ request, env }) {
    const denied = await guard(request, env, true);
    if (denied) return denied;
    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad request" }, { status: 400 }); }
    const result = validateSurveys(body.surveys);
    if (result.error) return json({ error: result.error }, { status: 400 });
    const saved = await loadCustom(env);
    let review = saved.review;
    if (body.review) {
      const title = clean(body.review.title, 80) || REVIEW.title;
      const v = validateQuestions(body.review.questions, title, true);
      if (v.error) return json({ error: v.error }, { status: 400 });
      review = { title, intro: clean(body.review.intro, 300), questions: v.questions, access: body.review.access === "links" ? "links" : "anyone" };
    }
    let templates = saved.templates;
    if (Array.isArray(body.templates)) {
      if (body.templates.length > 30) return json({ error: "Too many templates." }, { status: 400 });
      templates = [];
      for (const t of body.templates) {
        const title = clean(t && t.title, 80);
        if (!title) return json({ error: "Every template needs a title." }, { status: 400 });
        const v = validateQuestions(t.questions, title, false);
        if (v.error) return json({ error: v.error }, { status: 400 });
        templates.push({
          id: /^[a-z0-9-]{2,30}$/.test(String(t.id || "")) ? t.id : "t-" + newId(),
          icon: clean(t.icon, 2) || "✎", tone: TONES.includes(t.tone) ? t.tone : "blue",
          title, intro: clean(t.intro, 300), questions: v.questions.map(({ id, ...q }) => q),
        });
      }
    }
    await env.SCHEDULE_KV.put("surveys", JSON.stringify({ reviewOpen: body.reviewOpen !== false, review, surveys: result.surveys, templates }));
    return json({ surveys: await allSurveys(env), templates: templates || DEFAULT_TEMPLATES });
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

// POST /api/admin/links  { survey, count }  -> one-time links
// GET  /api/admin/links?survey=id          -> how many are still unused
export const adminLinks = {
  async onRequestGet({ request, env }) {
    const denied = await guard(request, env, false);
    if (denied) return denied;
    const sid = new URL(request.url).searchParams.get("survey") || "";
    if (!/^[a-z0-9-]{1,40}$/.test(sid)) return json({ error: "Bad survey id" }, { status: 400 });
    let open = 0, used = 0, cursor;
    do {
      const page = await env.SCHEDULE_KV.list({ prefix: `tok:${sid}:`, cursor });
      for (const k of page.keys) (k.metadata && k.metadata.used ? used++ : open++);
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    return json({ open, used });
  },
  async onRequestPost({ request, env }) {
    const denied = await guard(request, env, true);
    if (denied) return denied;
    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad request" }, { status: 400 }); }
    const s = (await allSurveys(env)).find((x) => x.id === body.survey);
    if (!s) return json({ error: "That survey doesn't exist." }, { status: 404 });
    const count = Math.max(1, Math.min(50, parseInt(body.count, 10) || 1));
    const origin = new URL(request.url).origin;
    const links = [];
    for (let i = 0; i < count; i++) {
      const t = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
      await env.SCHEDULE_KV.put(`tok:${s.id}:${t}`, "open", { expirationTtl: 60 * 60 * 24 * 180, metadata: { used: 0 } });
      links.push(`${origin}/survey?id=${encodeURIComponent(s.id)}&t=${t}`);
    }
    return json({ links });
  },
};
