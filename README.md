# InvoiceIntel — Claude Edition (prototype)

Redesigned UI for the invoice processor, extraction now runs on Claude (Opus) instead of Gemini.

## Run locally

1. `npm install`
2. Set `ANTHROPIC_API_KEY` in `.env.local` (already present in this prototype — do not commit it)
3. `npm run dev`

## What changed vs the original app

- Extraction: `services/claudeService.ts` calls the Anthropic Messages API (`claude-opus-4-8`) with a
  JSON-schema structured output built from your configured columns, instead of Gemini's `responseSchema`.
- UI: the "Extract Data" workflow is now a right-docked slide-in panel instead of a center modal, so the
  sheet stays visible while you configure an extraction. The top toolbar and grid were restyled to a
  lighter, flatter look.
- All original functionality is preserved: multi-sheet tabs, undo/redo, cell styling, dynamic columns,
  CSV/Excel export, and the extraction-logic PDF export.
