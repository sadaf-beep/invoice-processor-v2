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

## What changed vs the original app

- Extraction: `api/extract.ts` calls the Anthropic Messages API (`claude-opus-4-8`) with a JSON-schema
  structured output built from your configured columns, instead of Gemini's `responseSchema`. It runs
  server-side now (Vercel function) rather than directly from the browser.
- UI: the "Extract Data" workflow is now a right-docked slide-in panel instead of a center modal, so the
  sheet stays visible while you configure an extraction. The top toolbar and grid were restyled to a
  lighter, flatter look.
- All original functionality is preserved: multi-sheet tabs, undo/redo, cell styling, dynamic columns,
  CSV/Excel export, and the extraction-logic PDF export.
