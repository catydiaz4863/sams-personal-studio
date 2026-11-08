# Sam's Personal Studio website

A small, fast website for a pole & belly dance studio. Plain HTML/CSS/JS:
no framework, no build step. The owner edits the monthly schedule from a
password-protected page, `/admin.html`.

## Pages

| Page | File |
| --- | --- |
| Home | `public/index.html` |
| Monthly schedule | `public/schedule.html` |
| Classes | `public/classes.html` |
| Visit & contact | `public/contact.html` |
| Owner edit page (not linked anywhere) | `public/admin.html` |

## How the schedule editing works

- The schedule is stored in Cloudflare KV, a small free database.
- `functions/api/*.js` are tiny server functions that run on Cloudflare:
  - `GET /api/schedule`: public, returns the schedule.
  - `POST /api/login`: checks the password and sets a 12-hour login cookie.
  - `PUT /api/schedule`: saves the schedule; only works when logged in.
- Security:
  - The password lives in a Cloudflare secret, never in the code.
  - The login cookie is signed, HttpOnly and SameSite=Strict.
  - Logins lock for 15 minutes after 5 wrong passwords.
  - Cross-site requests are rejected.
  - All schedule text is inserted as plain text, never as HTML.
- Every save keeps the previous version under the KV key `schedule:previous`.
- `public/data/schedule.json` is the starter schedule, used until the first save.

## Cost

| | |
| --- | --- |
| Cloudflare Pages hosting | free |
| Pages Functions + KV | free tier (100k requests/day, 1k saves/day) |
| Domain | ~$10–15 **per year** (transfer it away from Webador, or buy one at Cloudflare at cost) |

## Run it locally

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars   # then set a test password in .dev.vars
```

```bash
npm run dev                      # http://localhost:8788  (edit page: /admin.html)
```

## Deploy (one time)

1. Create a free Cloudflare account.
2. Create the KV store and paste the printed id into `wrangler.toml`:

   ```bash
   npx wrangler kv namespace create SCHEDULE_KV
   ```

3. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**,
   pick this repo, build command *(none)*, output directory `public`.
4. In the project's **Settings → Variables and Secrets**, add two **secrets**:
   - `ADMIN_PASSWORD`: the owner's password (long, not reused anywhere).
   - `SESSION_SECRET`: a random string of 32+ characters (`openssl rand -base64 48`).
5. **Settings → Bindings → KV namespace:** variable name `SCHEDULE_KV`, pointing at the store from step 2.
6. Optional: point the domain at it under **Custom domains**.

Changing `ADMIN_PASSWORD` logs out every existing session.

## Placeholders still to fill in

- Phone number `(555) 555-0123`, used in every page.
- The street address (highlighted in yellow).
- Instagram / Facebook links in the footer.
- Class descriptions on `classes.html`: written as a first draft, have Sam check them.
