# InvoiceIntel — Claude Edition

Redesigned UI for the invoice processor, extraction now runs on Claude (Opus) instead of Gemini.

## Architecture

- The frontend (`App.tsx`, `components/`) is a static Vite/React app.
- Extraction calls go to `api/extract.ts`, a Vercel serverless function. **The Anthropic API key lives
  only there** — it's read from `process.env.ANTHROPIC_API_KEY` on the server and never bundled into
  client-side JS. The browser calls `POST /api/extract` (see `services/claudeService.ts`), which is a
  thin `fetch` wrapper with no key of its own.

## Deploying on Vercel

1. Import the GitHub repo in Vercel — it auto-detects the Vite framework preset (build `vite build`,
   output `dist`), no need to touch those fields.
2. Under **Environment Variables**, add:
   - Key: `ANTHROPIC_API_KEY`
   - Value: your real Anthropic API key
   - Environments: Production and Preview (add Development too if you'll use `vercel dev` — see below)
3. Deploy. The `api/` folder is picked up automatically as a serverless function alongside the static site.

## Run locally

Plain `npm run dev` (Vite only) serves the UI but **cannot** run `api/extract.ts` — Vite's dev server
doesn't execute serverless functions, so extraction requests will 404. For full local testing:

1. `npm install -g vercel` (once)
2. `vercel link` (once, links this folder to the Vercel project)
3. `vercel env pull .env.local` (pulls `ANTHROPIC_API_KEY` from the linked project) — or just create
   `.env.local` yourself from `.env.local.example`
4. `vercel dev` — serves both the Vite frontend and `api/extract.ts` locally, matching production

Alternatively, push to a branch and test against the Vercel Preview deployment it generates.

## Connecting Gmail (manual scan)

The Extract Data panel has a "Scan Gmail" source alongside file upload. It searches your inbox for
messages with a subject containing **"Invoice Uploaded"**, pulls PDF attachments off matching messages,
runs them through the same Claude extraction as a normal upload, and appends the results to the active
sheet. This is the on-demand version — see **Daily automation** below for the unattended daily version.

**How dedup works:** there's no separate database. Processed messages get a Gmail label
(`InvoiceIntelProcessed`) applied via the API itself. The search query itself does *not* exclude that
label — Gmail's search parser handles quoted label-name exclusions inconsistently (confirmed by
reproducing it directly in Gmail's own search bar), so instead each matched message's own `labelIds` is
checked in code after fetching it, and already-labeled ones are skipped there. A message only gets
labeled after a successful extraction (or immediately if it turns out to have no PDF attached), so a
failed extraction is retried on the next scan.

### One-time setup

1. **Google Cloud project**: go to [console.cloud.google.com](https://console.cloud.google.com), create
   a project (or reuse one), and enable the **Gmail API** under APIs & Services → Library.
2. **OAuth consent screen**: APIs & Services → OAuth consent screen → External → fill in an app name and
   your email → save. You can leave it in **Testing** mode (no Google review needed) — under "Test
   users," add the Gmail address you want to scan.
3. **Data access scopes**: still on the same consent screen setup, under **Data access → Add or remove
   scopes**, search for and check all three of:
   - `.../auth/gmail.modify` (read + label messages)
   - `.../auth/gmail.send` (send the daily summary email — needed for automation, see below)
   - `.../auth/drive.file` (create/write only the files and folders this app itself creates — needed for
     Drive archival, see below)

   You can do this now even if you're only setting up the manual scan today — it saves a second
   re-consent later. Also enable the **Google Drive API** under APIs & Services → Library if you'll use
   automation.
4. **OAuth client**: APIs & Services → Credentials → Create Credentials → OAuth client ID → type
   **Web application**. Under "Authorized redirect URIs," add:
   `https://<your-vercel-domain>/api/gmail/callback`
   (your deployed app's domain — e.g. `https://invoice-processor-v2.vercel.app/api/gmail/callback`).
   Save, then copy the **Client ID** and **Client secret**.
5. In Vercel, add environment variables `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` with those values
   (Production + Preview), and redeploy.
6. Visit `https://<your-vercel-domain>/api/gmail/auth` in your browser, sign in with the Gmail account to
   scan, and approve access (the consent screen will list all three scopes above). You'll land on a page
   showing a refresh token — copy it into a `GMAIL_REFRESH_TOKEN` environment variable in Vercel
   (Production + Preview), then redeploy once more. That page only shows the token once; if you ever need
   a new one, revoke the app's access at
   [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and repeat this step.

Once all three `GMAIL_*` variables are set, "Scan Gmail" in the Extract panel works. Without them, it
fails with a clear "Gmail is not connected yet" error instead of a silent failure.

## Daily automation

A Vercel Cron job (`vercel.json`) hits `api/cron/daily-scan.ts` once a day at **00:00 UTC (6am
Bangladesh time / GMT+6)**. Each run:

1. Scans for "Invoice Uploaded" emails from the last 3 days (a small buffer in case a run is missed —
   dedup labeling means nothing gets processed twice regardless).
2. Extracts each one with Claude, same as the manual scan, using the standard 10-column schema (custom
   columns you add in the app during a browser session aren't visible to the unattended cron job, since
   nothing about your session persists between requests).
3. Archives the source PDF(s) and a generated CSV to Google Drive, under a dated folder:
   `InvoiceIntel/<YYYY-MM-DD>/`.
4. If anything was processed, emails you a summary with the CSV(s) attached.

There's no database and no in-app history view — email and the Drive archive are the record. (An earlier
version of this also logged runs to Postgres for an in-app review panel; removed to keep setup to just
the steps below.)

### Setup

1. **Scopes**: make sure your Google Cloud OAuth client has all three scopes listed in the Gmail setup
   section above (`gmail.modify`, `gmail.send`, `drive.file`), and that you've re-run
   `/api/gmail/auth` → copied the new `GMAIL_REFRESH_TOKEN` into Vercel if you set up Gmail scanning
   before automation was added — a refresh token only carries the scopes it was issued with.
2. **Cron secret**: add a `CRON_SECRET` environment variable (any random string — e.g. generate one with
   `openssl rand -hex 32`) in Vercel (Production only; cron jobs only run in Production). Vercel
   automatically sends this as a bearer token when it invokes the cron job, which is how
   `api/cron/daily-scan.ts` verifies the request actually came from Vercel and not an outsider hitting the
   URL directly.
3. Redeploy after setting all of the above.
4. **Test it manually** before waiting for the real 6am run — from your own machine (not from inside the
   app):
   ```
   curl -H "Authorization: Bearer <your CRON_SECRET>" https://<your-vercel-domain>/api/cron/daily-scan
   ```
   Check the response, your Drive `InvoiceIntel` folder, and your inbox to confirm all three pieces worked.

## What changed vs the original app

- Extraction: `api/extract.ts` calls the Anthropic Messages API (`claude-opus-4-8`) with a JSON-schema
  structured output built from your configured columns, instead of Gemini's `responseSchema`. It runs
  server-side now (Vercel function) rather than directly from the browser.
- UI: the "Extract Data" workflow is now a right-docked slide-in panel instead of a center modal, so the
  sheet stays visible while you configure an extraction. The top toolbar and grid were restyled to a
  lighter, flatter look.
- All original functionality is preserved: multi-sheet tabs, undo/redo, cell styling, dynamic columns,
  CSV/Excel export, and the extraction-logic PDF export.
- New: a manual "Scan Gmail" source in the Extract panel (see above) — the extraction logic itself is
  shared between `api/extract.ts` and `api/gmail-scan.ts` via `lib/extractInvoice.ts`.
- New: unattended daily automation (see **Daily automation** above) — a Vercel Cron job that scans,
  extracts, archives to Drive, and emails a summary.
