import { isLoggedIn, sameOrigin, json } from "../_lib/auth.js";
import { MEDIA_PATH, cleanupMedia } from "./media.js";

const KEY = "schedule";
const PREVIOUS_KEY = "schedule:previous";
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_PRICES = { twice: 100, once: 70, registration: 30 };
const EVENT_TYPES = ["workshop", "recital", "dropin", "party", "other"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- schedules by month ----------
// Stored as schedules: [{ key: "2026-12", start, early, open, classes }].
//   start = the day it replaces the previous schedule (automatic)
//   early = early registration for current students (announcement appears)
//   open  = registration opens to everyone
// Dates follow the studio's clock (McAllen = Central time).
const MONTH = /^\d{4}-\d{2}$/;
function todayKey() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function addMonths(key, n) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// Older saves had one "classes" list; treat it as the schedule running now.
function normalize(data) {
  if (Array.isArray(data.schedules)) return data;
  return { ...data, schedules: [{ key: todayKey().slice(0, 7), start: "2000-01-01", classes: data.classes || [] }] };
}

// Which schedule is running today, and which one comes next.
function pick(schedules, today) {
  const sorted = schedules.slice().sort((a, b) => a.start.localeCompare(b.start));
  const started = sorted.filter((x) => x.start <= today);
  const current = started[started.length - 1] || sorted[0] || null;
  const upcoming = sorted.find((x) => x.start > today && x !== current) || null;
  return { current, upcoming };
}

// What the website gets. The upcoming schedule only shows once early
// registration starts; the owner always sees everything.
function shape(raw, owner) {
  const data = normalize(raw);
  const today = todayKey();
  const { current, upcoming } = pick(data.schedules, today);
  const out = {
    month: current ? monthLabel(current.key) : "",
    monthKey: current ? current.key : "",
    classes: current ? current.classes : [],
    closed: current && current.closed ? current.closed : [],
    note: data.note || "",
    prices: data.prices,
    events: data.events || [],
    updatedAt: data.updatedAt,
  };
  if (current && current.start > today) out.startsOn = current.start; // nothing has started yet
  if (upcoming && upcoming.early && today >= upcoming.early && upcoming.classes.length) {
    out.next = {
      month: monthLabel(upcoming.key), key: upcoming.key, start: upcoming.start,
      early: upcoming.early, open: upcoming.open || upcoming.early,
      phase: today >= (upcoming.open || upcoming.early) ? "open" : "early",
      classes: upcoming.classes,
      closed: upcoming.closed || [],
    };
  }
  if (owner) {
    out.today = today;
    out.schedules = [current, upcoming].filter(Boolean).map((x) => ({ ...x, label: monthLabel(x.key) }));
  }
  return out;
}

async function loadRaw(env, request) {
  const saved = await env.SCHEDULE_KV.get(KEY);
  if (saved) return JSON.parse(saved);
  const starter = await env.ASSETS.fetch(new URL("/data/schedule.json", request.url));
  return starter.json();
}

// GET /api/schedule  (public; the owner also gets next month's draft)
export async function onRequestGet({ request, env }) {
  return json(shape(await loadRaw(env, request), await isLoggedIn(request, env)));
}

// PUT /api/schedule  (owner only)
export async function onRequestPut({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Bad origin" }, { status: 403 });
  if (!(await isLoggedIn(request, env))) {
    return json({ error: "You've been logged out. Log in again to save." }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request" }, { status: 400 });
  }

  const result = validate(body);
  if (result.error) return json({ error: result.error }, { status: 400 });

  // Keep the last version so a bad save can be undone.
  const current = await env.SCHEDULE_KV.get(KEY);
  if (current) await env.SCHEDULE_KV.put(PREVIOUS_KEY, current);

  await env.SCHEDULE_KV.put(KEY, JSON.stringify(result.data));
  const saved = result.data;
  // Remove flyer images that no event uses anymore.
  try {
    await cleanupMedia(env, result.data.events.map((e) => e.image).filter(Boolean));
  } catch (err) {
    console.error("media cleanup failed", err);
  }
  return json(shape(saved, true));
}

function cleanText(value, max) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function validateClasses(list, label) {
  if (!Array.isArray(list)) return { error: `${label} is missing its class list.` };
  if (list.length > 200) return { error: `${label} has more than 200 classes.` };
  const classes = [];
  for (const c of list) {
    const name = cleanText(c && c.name, 60);
    const day = c && c.day;
    const time = c && c.time;
    if (!name) continue; // ignore blank rows
    if (!DAYS.includes(day)) return { error: `"${name}" has an unknown day.` };
    if (!TIME.test(String(time))) return { error: `"${name}" needs a start time.` };
    const item = { day, time, name };
    // Package extras (all optional): pkg groups the days of one class,
    // len = minutes, price = custom monthly price, sale = { price, label, until }.
    if (/^[a-z0-9]{1,16}$/.test(String(c.pkg || ""))) item.pkg = c.pkg;
    if (c.len !== undefined && c.len !== null && c.len !== "") {
      const len = Number(c.len);
      if (!Number.isInteger(len) || len < 15 || len > 240) return { error: `"${name}" has an invalid length.` };
      if (len !== 60) item.len = len;
    }
    if (c.price !== undefined && c.price !== null && c.price !== "") {
      const n = Number(c.price);
      if (!Number.isInteger(n) || n < 0 || n > 9999) return { error: `"${name}" price must be whole dollars.` };
      item.price = n;
    }
    if (c.sale && c.sale.price !== undefined && c.sale.price !== "") {
      const n = Number(c.sale.price);
      if (!Number.isInteger(n) || n < 0 || n > 9999) return { error: `"${name}" sale price must be whole dollars.` };
      const sale = { price: n };
      const lab = cleanText(c.sale.label, 30);
      if (lab) sale.label = lab;
      if (c.sale.until) {
        if (!DATE.test(String(c.sale.until))) return { error: `"${name}" has an invalid sale end date.` };
        sale.until = c.sale.until;
      }
      item.sale = sale;
    }
    classes.push(item);
  }
  classes.sort((a, b) =>
    DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.time.localeCompare(b.time));
  return { classes };
}

function validate(body) {
  if (!body || typeof body !== "object") return { error: "Bad request" };
  const today = todayKey();
  const list = Array.isArray(body.schedules) ? body.schedules
    : Array.isArray(body.classes) ? [{ key: today.slice(0, 7), start: "2000-01-01", classes: body.classes }] : null;
  if (!list) return { error: "Schedule is missing its class list." };
  if (list.length > 4) return { error: "Too many schedules." };
  let schedules = [];
  const keys = new Set();
  for (const x of list) {
    if (!x || !MONTH.test(String(x.key))) return { error: "Unknown month." };
    if (keys.has(x.key)) continue;
    keys.add(x.key);
    const label = monthLabel(x.key);
    const v = validateClasses(x.classes, label);
    if (v.error) return v;
    const item = { key: x.key, classes: v.classes };
    if (Array.isArray(x.closed)) {
      const closed = [...new Set(x.closed.filter((d) => DAYS.includes(d)))];
      if (closed.length) item.closed = closed;
    }
    for (const f of ["start", "early", "open"]) {
      if (x[f] === undefined || x[f] === null || x[f] === "") continue;
      if (!DATE.test(String(x[f])) || isNaN(Date.parse(x[f] + "T00:00:00Z"))) return { error: `${label}: invalid ${f} date.` };
      item[f] = x[f];
    }
    if (!item.start) return { error: `${label} needs a start date.` };
    if (item.early && item.open && item.open < item.early) return { error: `${label}: registration for everyone can't be before early registration.` };
    if (item.open && item.open > item.start) return { error: `${label}: registration should open before the schedule starts.` };
    if (item.early && item.early > item.start) return { error: `${label}: early registration should be before the schedule starts.` };
    schedules.push(item);
  }
  // Keep the schedule running now plus anything upcoming; older ones drop off.
  const { current } = pick(schedules, today);
  schedules = schedules.filter((x) => x === current || x.start > today);
  schedules.sort((a, b) => a.start.localeCompare(b.start));
  // Monthly prices, in whole dollars: per class taken twice a week / once a week,
  // plus the one-time registration fee for new students.
  const prices = { ...DEFAULT_PRICES };
  for (const key of Object.keys(DEFAULT_PRICES)) {
    const raw = body.prices && body.prices[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 9999) {
      return { error: "Prices must be whole dollar amounts (0 to 9999)." };
    }
    prices[key] = n;
  }

  // Events (workshops, recitals, drop-ins, parties). Old ones are dropped
  // 60 days after they happen so the list stays small.
  const events = [];
  const rawEvents = Array.isArray(body.events) ? body.events : [];
  if (rawEvents.length > 60) return { error: "That's more than 60 events." };
  const cutoff = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  for (const e of rawEvents) {
    const title = cleanText(e && e.title, 80);
    if (!title) continue;
    const type = EVENT_TYPES.includes(e.type) ? e.type : "other";
    const date = String(e.date || "");
    if (!DATE.test(date) || isNaN(Date.parse(date + "T00:00:00Z"))) {
      return { error: `"${title}" needs a date.` };
    }
    if (date < cutoff) continue;
    const ev = { type, title, date };
    if (e.time) {
      if (!TIME.test(String(e.time))) return { error: `"${title}" has an invalid time.` };
      ev.time = e.time;
    }
    if (e.price !== undefined && e.price !== null && e.price !== "") {
      const n = Number(e.price);
      if (!Number.isInteger(n) || n < 0 || n > 9999) return { error: `"${title}" price must be whole dollars.` };
      ev.price = n;
    }
    const description = cleanText(e.description, 400);
    if (description) ev.description = description;
    if (e.image) {
      if (!MEDIA_PATH.test(String(e.image))) return { error: `"${title}" has an invalid flyer image.` };
      ev.image = e.image;
    }

    events.push(ev);
  }
  events.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));

  return {
    data: {
      note: cleanText(body.note, 300),
      prices,
      events,
      schedules,
      updatedAt: new Date().toISOString(),
    },
  };
}
