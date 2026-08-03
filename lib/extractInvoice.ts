import Anthropic from '@anthropic-ai/sdk';
import { InvoiceItem, ColumnConfig, LICENSE_BASE_COLUMNS, buildTermDatedColumns } from '../types.js';

// Internal interface that includes Quantity for processing logic
interface RawInvoiceItem extends InvoiceItem {
  Quantity?: number;
}

const MODEL = 'claude-opus-4-8';

export interface ExtractInvoiceInput {
  base64Data: string;
  mimeType: string;
  columns: ColumnConfig[];
  customInstructions: string;
  pageRange: string;
}

// Shared by api/extract.ts (browser upload) and api/gmail-scan.ts (Gmail
// attachment) — the Claude call, prompt, and response parsing are identical
// regardless of where the document came from.
export async function extractInvoiceItems(client: Anthropic, input: ExtractInvoiceInput): Promise<InvoiceItem[]> {
  const { base64Data, mimeType, columns, customInstructions, pageRange } = input;
  const cleanBase64 = base64Data.replace(/^data:.+;base64,/, '');

  const columnNames = columns.map((c) => `"${c.label}"`).join(', ');

  const dynamicSystemInstruction = `
    You are an expert Invoice Processing AI with advanced reasoning capabilities.

    TASK:
    Extract line items from the invoice into a JSON array of objects. Each object must have exactly
    these keys: ${columnNames}, and "Quantity".

    *** PRIORITY INSTRUCTION ***
    The "USER OVERRIDES" section below contains custom business rules.
    IF ANY INSTRUCTION IN "USER OVERRIDES" CONFLICTS WITH THE "DEFAULT RULES",
    YOU MUST FOLLOW THE "USER OVERRIDES" AND IGNORE THE DEFAULT RULE.

    === USER OVERRIDES (HIGHEST PRIORITY) ===
    ${customInstructions ? customInstructions : 'No custom overrides provided.'}
    =========================================

    === DEFAULT RULES (Apply only if not overridden) ===
    1. **EXTRACT QUANTITY:** You MUST extract the "Quantity" for each line internally (integer). If not explicitly listed, imply it is 1.
    2. Output ONE object per unique line item found on the invoice. DO NOT split items into multiple rows yourself.
    3. Dates must be MM/DD/YYYY.
    4. "Purchase Price" should be the unit price.
    5. **STATUS:** If the columns list includes "Status", the value must ALWAYS be "Ordered". Never use "New", "Pending", or any other status.
    6. **IGNORE CANCELLED LINES:** Do NOT extract line items listed under a "Deleted Lines", "Cancelled", "Voided", or similarly struck-through/removed section — only extract active line items that are part of the current order.

    MANUFACTURER, MODEL #, PRODUCT NAME RULES:
    1. MANUFACTURER: The actual equipment maker. Do not infer if not stated.
    2. MODEL #: Official manufacturer part number (MPN). Do not use internal codes or row numbers.
    3. PRODUCT NAME: Provide the full product name as it appears on the invoice, but DO NOT include the manufacturer or model number. Only the name itself.
    4. DISAMBIGUATION: Manufacturer-labeled part number > Model #.

    ITEM CLASSIFICATION (Order of Operations):
    1. LABOUR (Installation, service)
    2. SHIPPING (Freight, delivery)
    3. PREPAID (Software, warranties)
    4. BULK ITEM (Passive, structural, cables, mounts)
    5. ASSET (Active standalone electronics)

    Confidence Check: If classification is ambiguous, output "REVIEW_REQUIRED".
    ====================================================

    PAGE RANGE INSTRUCTION:
    The user has requested to process the following page range: "${pageRange}".
    If this says "All", process every page.
    If it specifies a range (e.g., "1-3"), ONLY extract items visible on those specific pages.

    Every key must be present on every object — use an empty string ("") for text/date fields with no
    value, and 0 for numeric fields with no value.

    OUTPUT FORMAT: Return ONLY a raw JSON array. No markdown code fences, no commentary, no
    explanation — the response body must start with "[" and end with "]".
  `;

  const isImage = mimeType.startsWith('image/');
  const documentBlock: Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam = isImage
    ? { type: 'image', source: { type: 'base64', media_type: mimeType as any, data: cleanBase64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: cleanBase64 } };

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: dynamicSystemInstruction,
    messages: [
      {
        role: 'user',
        content: [
          documentBlock,
          {
            type: 'text',
            text: `Extract every invoice line item. Focus strictly on page range: ${pageRange}. Follow USER OVERRIDES above all else.`,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!textBlock) {
    throw new Error('No text response from Claude.');
  }

  // Claude sometimes wraps the JSON in a markdown code fence despite being
  // told not to — strip it before parsing.
  const cleanedText = textBlock.text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let rawData: RawInvoiceItem[];
  try {
    rawData = JSON.parse(cleanedText);
  } catch {
    throw new Error('Claude returned a response that was not valid JSON.');
  }

  const expandedData: InvoiceItem[] = [];

  // Row expansion logic — flatten "Quantity: N" into N individual rows
  const userAskedForQuantity = columns.some((c) => c.label.toLowerCase() === 'quantity');

  rawData.forEach((item) => {
    const qty = item.Quantity && item.Quantity > 0 ? item.Quantity : 1;

    const outputItem = { ...item };
    if (!userAskedForQuantity) {
      delete outputItem.Quantity;
    }

    for (let i = 0; i < qty; i++) {
      expandedData.push(outputItem);
    }
  });

  return expandedData;
}

// --- Licence / support-agreement extraction -------------------------------
// Encodes the key rules from the licence-processing skill. Claude only
// reports what it finds per line item, including every distinct coverage
// period in a `terms` array — the row/column layout for base vs term-dated
// format is a pure code-side transform below, not something Claude decides,
// since that choice is meant to be told to it (per the skill: "ask, don't
// guess" on base vs term-dated).

export interface ExtractLicenseInput {
  base64Data: string;
  mimeType: string;
  format: 'base' | 'term-dated';
  customInstructions: string;
}

export interface ExtractLicenseResult {
  items: InvoiceItem[];
  columns: ColumnConfig[];
}

interface RawLicenseTerm {
  start?: string;
  end?: string;
  amount?: number;
}

interface RawLicenseItem {
  'Contract Name'?: string;
  'Manufacturer'?: string;
  'Model #'?: string;
  'Description'?: string;
  'Client'?: string;
  'QTY'?: number;
  'Purchase Date'?: string;
  'Type'?: string;
  'Quote Number'?: string;
  'Asset Relationships'?: string;
  'Status'?: string;
  'Category'?: string;
  'PO Number'?: string;
  'Invoice Number'?: string;
  'Review Notes'?: string;
  terms?: RawLicenseTerm[];
}

export async function extractLicenseItems(client: Anthropic, input: ExtractLicenseInput): Promise<ExtractLicenseResult> {
  const { base64Data, mimeType, format, customInstructions } = input;
  const cleanBase64 = base64Data.replace(/^data:.+;base64,/, '');

  const systemPrompt = `
    You are an expert at parsing vendor licence and support-agreement documents (e.g. Ross Video,
    Grass Valley/GVCare renewal quotes, CapEx upgrade sheets) into structured licence records for
    import — NOT a generic invoice/PO. Follow these rules precisely.

    *** PRIORITY INSTRUCTION ***
    The "USER OVERRIDES" section below contains custom business rules.
    IF ANY INSTRUCTION IN "USER OVERRIDES" CONFLICTS WITH THE RULES BELOW,
    YOU MUST FOLLOW THE "USER OVERRIDES" AND IGNORE THE CONFLICTING RULE.

    === USER OVERRIDES (HIGHEST PRIORITY) ===
    ${customInstructions ? customInstructions : 'No custom overrides provided.'}
    =========================================

    TASK: Extract one JSON object per distinct licence/contract line item into a JSON array. Each
    object must have exactly these keys:
    "Contract Name", "Manufacturer", "Model #", "Description", "Client", "QTY", "Purchase Date",
    "Type", "Quote Number", "Asset Relationships", "Status", "Category", "PO Number",
    "Invoice Number", "Review Notes", and "terms".

    "terms" is an array of { "start": "MM/DD/YYYY", "end": "MM/DD/YYYY", "amount": number } — one
    entry per distinct coverage period this line item has. Most lines have exactly one term; a
    multi-year contract has one entry per year found in the document. Never collapse multiple years
    into a single term — capture every year you can find, even if a product only appears in a later
    year (e.g. an item that first appears in Year 2, not Year 1).

    FIELD RULES:
    1. **Contract Name** is the licence name — give each distinct licence a clear, identifiable name.
       Never use the source file name. When one document produces multiple licence records that
       would otherwise be indistinguishable, pull a differentiator from the product name/model/
       description (e.g. include the model or product group in the name).
    2. **Client**: leave blank unless the document explicitly states this is a System Integrator (SI)
       reseller account — never populate with the end customer/venue name.
    3. **Term dates** (inside "terms"): use the actual per-line-item coverage Start/End dates from the
       proposal/line-item detail — never the quote preparation date or the quote's own validity date.
       These vary by line item; do not apply one date range to everything. If there are genuinely no
       term dates (e.g. a one-time CapEx upgrade), return "terms": [] and add a Review Note: "One-time
       upgrade — no defined term dates."
    4. **Description**: use the full product description from a "Product Descriptions" page/section if
       the document has one (matched by product/model code) — not a short inline description.
    5. **Serial numbers** (Asset Relationships): copy exactly as printed, preserving dashes and all
       characters — never as a bare number. If a single line item lists multiple serials, put them
       comma-separated in Asset Relationships AND add a Review Note flagging that there are multiple
       serials on one line so a human can decide whether to keep them combined or split into separate
       rows — do not decide this yourself.
    6. **Qty-only / bulk items** with no serials (e.g. connector panels, small accessories covered in
       bulk): put the count in QTY, leave Asset Relationships blank, do not invent placeholder serials.
    7. **"OPTION" sections**: items listed under an "OPTION"/"Options" section of the quote are
       optional services (labor/travel), not items to omit. Set Type to "Service", set Category to the
       section name (e.g. "OPTION | SERVICES | EVENT SUPPORT"), and include them like any other line.
    8. **Type** must be exactly one of: License, SLA, Hardware, Service, Labor, Materials, Travel.
    9. **Status** must be exactly "Approved" or "Planned" — default to "Approved"; use "Planned" only
       when the document or user overrides clearly indicate the contract is a draft, unsigned, or
       otherwise not yet finalized.
    10. **Category**: the product group or section heading from the quote (e.g. "PCR", "LED CMS-T1",
        "GVCare SLA").
    11. Leave "Purchase Date", "PO Number", and "Invoice Number" blank ("") unless the document clearly
        states them — do not guess.
    12. Ignore line items under a "Deleted", "Cancelled", or "Voided" section — only active line items.

    Every key must be present on every object — use an empty string ("") for missing text fields, 0
    for missing numeric fields, and [] for "terms" if genuinely none apply.

    OUTPUT FORMAT: Return ONLY a raw JSON array. No markdown code fences, no commentary — the response
    body must start with "[" and end with "]".
  `;

  const isImage = mimeType.startsWith('image/');
  const documentBlock: Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam = isImage
    ? { type: 'image', source: { type: 'base64', media_type: mimeType as any, data: cleanBase64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: cleanBase64 } };

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          documentBlock,
          { type: 'text', text: 'Extract every licence/contract line item per the rules above.' },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!textBlock) {
    throw new Error('No text response from Claude.');
  }

  const cleanedText = textBlock.text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let raw: RawLicenseItem[];
  try {
    raw = JSON.parse(cleanedText);
  } catch {
    throw new Error('Claude returned a response that was not valid JSON.');
  }

  const shared = (r: RawLicenseItem) => ({
    'Contract Name': r['Contract Name'] ?? '',
    'Manufacturer': r['Manufacturer'] ?? '',
    'Model #': r['Model #'] ?? '',
    'Description': r['Description'] ?? '',
    'Client': r['Client'] ?? '',
    'QTY': r['QTY'] ?? 0,
    'Purchase Date': r['Purchase Date'] ?? '',
    'Type': r['Type'] ?? '',
    'Quote Number': r['Quote Number'] ?? '',
    'Asset Relationships': r['Asset Relationships'] ?? '',
    'Status': r['Status'] || 'Approved',
    'Category': r['Category'] ?? '',
    'PO Number': r['PO Number'] ?? '',
    'Invoice Number': r['Invoice Number'] ?? '',
    'Review Notes': r['Review Notes'] ?? '',
  });

  if (format === 'base') {
    // Skill's rule for the base format: a multi-year contract becomes one
    // row PER YEAR, not one row with everything squashed into a single term.
    const items: InvoiceItem[] = [];
    raw.forEach((r) => {
      const terms = r.terms && r.terms.length > 0 ? r.terms : [{ start: '', end: '', amount: 0 }];
      terms.forEach((t) => {
        items.push({
          ...shared(r),
          'Initial Term Start': t.start ?? '',
          'Initial Term End': t.end ?? '',
          'Amount': t.amount ?? 0,
        });
      });
    });
    return { items, columns: LICENSE_BASE_COLUMNS };
  }

  // Term-dated: one row per item, with a Term N group per year found —
  // columns are sized to whatever the widest item in this document needs.
  const maxTerms = Math.max(1, ...raw.map((r) => r.terms?.length ?? 0));
  const columns = buildTermDatedColumns(maxTerms);
  const items: InvoiceItem[] = raw.map((r) => {
    const row: InvoiceItem = { ...shared(r) };
    const terms = r.terms ?? [];
    for (let i = 1; i <= maxTerms; i++) {
      const t = terms[i - 1];
      row[`Term ${i} Start`] = t?.start ?? '';
      row[`Term ${i} End`] = t?.end ?? '';
      row[`Term ${i} Amount`] = t?.amount ?? 0;
    }
    return row;
  });

  return { items, columns };
}
