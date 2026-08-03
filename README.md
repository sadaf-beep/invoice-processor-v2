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

## Licence / support-agreement extraction

Alongside the normal asset-invoice extraction, the Extract panel has a **Format** choice (upload source
only, not Gmail scan yet): **Asset invoice** (the default, unchanged) or **Licence / SLA**. This exists
because a proper licence record (Contract Name, Term dates, Category, Quote Number, Review Notes, etc.)
needs fields a generic invoice extraction never asks for — it's a different document shape (Ross Video,
Grass Valley/GVCare renewal quotes, CapEx upgrade sheets), not just a PO with different columns.

- **Picking "Licence / SLA" up front** runs the dedicated licence extraction directly (`lib/extractInvoice.ts`'s
  `extractLicenseItems`, via `api/extract-license.ts`), and always creates a **new, separate sheet** with the
  licence column layout — it never mixes into the active asset sheet.
- **Layout**: choose **Base** (one row per line item; a multi-year contract becomes one row per year) or
  **Term-dated** (one row per line item, with a `Term 1`, `Term 2`, … column group per year, sized to
  whatever the widest contract in that document needs). The app never guesses this for you, since it isn't
  something Claude should decide silently.
- **Auto-detection on the default path**: even when you leave the format on "Asset invoice," any line item
  Claude classifies as `PREPAID` is flagged as a licence candidate — this is a plain code check
  (`Item Type === 'PREPAID'`), not an extra model call. **All rows always stay in the asset sheet** —
  candidates are never removed, since a human should be able to verify them there too. Two things happen:
  1. **Highlighting**: every PREPAID row gets a violet cell highlight in the sheet (the same color as the
     PREPAID badge), so candidates are visible at a glance without needing to open any prompt.
  2. **Review checklist**: an inline banner lists each candidate individually with a checkbox (all checked
     by default) — uncheck any that aren't actually licences (e.g. hardware, freight, tariff lines that got
     misclassified). Choosing **Skip** leaves things as-is; choosing to process re-runs extraction against
     the **same file already in memory** (no re-upload), but only for the *approved* items — their
     manufacturer/product/model/serial are passed to Claude as an explicit allow-list ("extract only these
     specific line items, nothing else"), rather than letting it freely re-decide across the whole document
     a second time. That scoping is what keeps unrelated hardware/shipping/tariff lines from ending up in
     the licence sheet just because they happened to sit near an actual licence line in the source document.
- Licence sheets are marked with a small scale icon on their tab, and their column layout is fixed (matching
  the format), unlike asset sheets — Add/rename/delete-column still works if you need to adjust one by hand.
- **Spreadsheet sources**: the Licence / SLA format also accepts a `.csv`, `.xlsx`, or `.xls` file — some
  licence data arrives as a spreadsheet export rather than a PDF quote. The server parses every sheet/tab
  into CSV text (via the `xlsx` package) and hands that to Claude as plain text instead of a document/image,
  with the same field rules — including mapping whatever arbitrary column headers the source file happens
  to use onto the target schema. Asset invoice uploads stay PDF/JPG/PNG only, since POs consistently arrive
  that way in practice.

## Daily automation

A Vercel Cron job (`vercel.json`) hits `api/cron/daily-scan.ts` once a day at a **fixed time set in
`vercel.json`** (`0 0 * * *` = 00:00 UTC = 6am Bangladesh time, by default). Vercel's free **Hobby plan caps
cron jobs at once per day** — a more frequent schedule fails the *entire deployment*, not just this endpoint
— so the fire time can only be changed by editing that cron expression and redeploying, not from inside the
app. When it fires:

1. Checks the **Automate panel**'s on/off toggle (stored in Supabase) — does nothing if it's off.
2. Scans for "Invoice Uploaded" emails from the last 3 days (a small buffer in case a run is missed —
   dedup labeling means nothing gets processed twice regardless).
3. Extracts each one with Claude, same as the manual scan, using the standard 10-column schema (custom
   columns you add in the app during a browser session aren't visible to the unattended cron job, since
   nothing about your session persists between requests).
4. Archives the source PDF(s) and a generated CSV to Google Drive, under a dated folder:
   `InvoiceIntel/<YYYY-MM-DD>/`.
5. Emails you a summary with the CSV(s) attached.
6. If a `SLACK_WEBHOOK_URL` is configured, also posts a Slack message with the same summary — which
   invoice(s) were processed, a link to each CSV, and a link to open that day's Drive folder. This step is
   optional and skipped entirely if the env var isn't set.

The Automate panel's **run-time picker** is saved to Supabase but the cron job itself doesn't act on it on
the Hobby plan — it's only meaningfully live if this project is upgraded to **Vercel Pro** (which allows a
cron to poll more frequently and check a chosen time, the way this was originally built before the Hobby
limit was discovered). Until/unless that happens, changing the run time in the app is a no-op for the actual
schedule; the on/off toggle still fully works.

The **"Run automation now"** button fires the exact same pipeline immediately, ignoring the schedule
entirely — this is the reliable way to test or demo the automation on demand, works regardless of Vercel
plan, and is safe to click repeatedly (Gmail dedup labeling means already-processed invoices are just
skipped, not reprocessed).

There's still no in-app history view of past runs — email and the Drive archive are the record. Supabase's
job here is holding the on/off + run-time setting, plus one more thing: a **"last check-in"** heartbeat.

**Debugging a no-show run**: Vercel's free-plan function logs are short-lived, so if the daily email doesn't
show up, there's normally no way to tell whether the cron never fired, fired and skipped (e.g. the toggle was
off), or fired and errored — by the time you look, the log's often already gone. To make that diagnosable
without needing to catch it in time, `api/cron/daily-scan.ts` writes a `last_checked_at` timestamp and a
`last_result` string to Supabase on **every** invocation, whatever it did. The Automate panel shows this as
**"Last check-in"** — so you can always open it and see exactly when the cron last actually ran, and whether
it skipped (and why), succeeded, or errored, instead of guessing.

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
3. **Supabase (for the adjustable schedule)**:
   - Create a new project at [supabase.com](https://supabase.com) (the free tier is enough — this is a
     single settings row, not a real workload).
   - In the project's **SQL Editor**, run:
     ```sql
     create table if not exists automation_settings (
       id int primary key default 1,
       enabled boolean not null default false,
       run_hour smallint not null default 6,
       run_minute smallint not null default 0,
       timezone text not null default 'Asia/Dhaka',
       last_run_date date,
       last_checked_at timestamptz,
       last_result text,
       updated_at timestamptz not null default now()
     );

     insert into automation_settings (id) values (1)
     on conflict (id) do nothing;
     ```
     If you created this table before the "Last check-in" heartbeat existed, just add the two new columns
     instead of recreating anything:
     ```sql
     alter table automation_settings
       add column if not exists last_checked_at timestamptz,
       add column if not exists last_result text;
     ```
   - In the project's **Settings → API**, copy the **Project URL** and the **`service_role`** secret key
     (not the `anon` key — the service role key is what lets the server read/write this table).
   - Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as Vercel environment variables (Production). The
     service role key is a secret — it's only ever read server-side, never sent to the browser.
   - If Supabase isn't configured, the cron job just no-ops on its daily fire (rather than guessing whether
     it should be enabled) — automation stays off until it's set up, and "Run automation now" still works
     regardless.
4. **Slack notification (optional)**: if you'd also like a Slack message alongside the email, create an
   [Incoming Webhook](https://api.slack.com/messaging/webhooks) — in Slack, go to
   `api.slack.com/apps` → **Create New App** → **From scratch** → name it and pick your workspace → under
   **Incoming Webhooks**, toggle it on → **Add New Webhook to Workspace** → choose the channel to post to →
   copy the generated URL. Set it as a `SLACK_WEBHOOK_URL` environment variable in Vercel (Production).
   This needs no bot, no OAuth flow, and no extra scopes — it's just a URL the cron job posts a JSON message
   to. Skip this step entirely if you don't want Slack notifications; email + Drive archival work the same
   either way.
5. Redeploy after setting all of the above.
6. In the app, open **Automate** (header button, or View → Automate…), toggle **Process emails
   automatically** on, and set your preferred run time. Click **Run automation now** to test immediately —
   check the response toast, your Drive `InvoiceIntel` folder, your inbox, and (if configured) Slack to
   confirm everything worked.

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
  extracts, archives to Drive, emails a summary, and optionally posts a Slack notification.
- New: a separate **licence/support-agreement extraction path** (see above) — a distinct schema and rule
  set from the asset invoice extraction, produced into its own sheet, with automatic detection of stray
  PREPAID line items inside an otherwise normal asset invoice.
