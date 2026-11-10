# Sam's Personal Studio website

A small, fast website for a pole & belly dance studio. Plain HTML/CSS/JS:
no framework, no build step. The owner edits the monthly schedule from a
password-protected page, `/admin`.

It runs as a **Cloudflare Worker**: the files in `public/` are served as-is,
and `src/` handles the few `/api/*` requests.

## Pages

| Page | File |
| --- | --- |
| Home | `public/index.html` |
| Monthly schedule | `public/schedule.html` |
| Classes | `public/classes.html` |
| Visit & contact | `public/contact.html` |
| Events, workshops & party rental | `public/events.html` |
| About Sam | `public/about.html` |
| Owner edit page (not linked anywhere) | `public/admin.html` |

Pages are served at short addresses: `/schedule`, `/classes`, `/events`, `/about`, `/contact`, `/admin`.

## How the schedule editing works

- The schedule is stored in Cloudflare KV, a small free database.
- `src/worker.js` sends `/api/*` requests to the handlers in `src/api/`:
  - `GET /api/schedule`: public, returns the schedule.
  - `POST /api/login`: checks the password and sets a 12-hour login cookie.
  - `PUT /api/schedule`: saves the schedule; only works when logged in.
- Security:
  - The password lives in a Cloudflare secret, never in the code.
  - The login cookie is signed, HttpOnly and SameSite=Strict.
  - Logins lock for 15 minutes after 5 wrong passwords.
  - Cross-site requests are rejected.
  - All schedule text is inserted as plain text, never as HTML.
- Events (workshops, recitals, drop-ins, parties) are edited on the same page and saved
  with the schedule. Past events drop off the website by themselves.
- Event flyer images are shrunk in the browser (max 1600px) and stored in KV
  under `media:<id>`, served at `/media/<id>`. Images no event uses are deleted
  on the next save.
- Schedules are stored by month (`schedules: [{ key, start, early, open, classes }]`).
  The one whose `start` has passed is the main schedule. The next one shows on the
  site as "Coming up" from its `early` date (early registration for current
  students), says "open to everyone" from its `open` date, and replaces the
  current schedule on its `start` date. Dates use McAllen (Central) time.
- Every save keeps the previous version under the KV key `schedule:previous`.
- `public/data/schedule.json` is the starter schedule, used until the first save.

## Cost

| | |
| --- | --- |
| Cloudflare Workers hosting + static files | free tier (100k API requests/day; page files are free) |
| KV storage | free tier (1k saves/day) |
| Domain | ~$10–15 **per year** (transfer it away from Webador, or buy one at Cloudflare at cost) |

## Run it locally

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars   # then set a test password in .dev.vars
```

```bash
npm run dev                      # http://localhost:8788  (edit page: /admin)
```

## Deploy (one time)

1. Create a free Cloudflare account.
2. Create a KV namespace named `SCHEDULE_KV` (dashboard: **Storage & Databases → KV**,
   or `npx wrangler kv namespace create SCHEDULE_KV`) and put its id in `wrangler.toml`.
   This repo's `wrangler.toml` already has the studio's id.
3. **Workers & Pages → Create → Import a repository**, pick this repo.
   Deploy command: `npx wrangler deploy` (the default). The Worker's name must match
   `name` in `wrangler.toml` (`sams-personal-studio`).
4. In the Worker's **Settings → Variables and Secrets**, add two **secrets**:
   - `ADMIN_PASSWORD`: the owner's password (long, not reused anywhere).
   - `SESSION_SECRET`: a random string of 32+ characters (`openssl rand -base64 48`).
5. Every push to `main` redeploys automatically.
6. Optional: point the domain at it under **Settings → Domains & Routes**.

Changing `ADMIN_PASSWORD` logs out every existing session.

## Placeholders still to fill in

- Class descriptions on `classes.html`: written as a first draft, have Sam check them.
