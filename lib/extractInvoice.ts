import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
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
    1. LABOUR — installation, service, engineering, travel/per-diem charges: a one-time service
       performed, not a right to use anything and not an ongoing coverage promise.
    2. SHIPPING — freight, delivery, logistics fees, one-time tariff/customs surcharges: a one-time
       pass-through cost of moving goods, never a usage right or coverage promise.
    3. PREPAID — ONLY items that are either (a) a right to USE software/a feature/a bundled
       capability for a period or perpetually (seat/port/channel-based licenses, subscriptions,
       site licenses, node-locked licenses, feature/capacity unlocks on hardware already owned), or
       (b) an ongoing support/maintenance coverage promise (SLAs, Care Plans, Support Agreements,
       TAC contracts, extended warranties — even when not literally labeled "SLA"). Tells:
       "License," "Subscription," "Seats," "Module," "Entitlement," "SLA," "Care," "Support
       Agreement," "Warranty," tiered response-time language ("24/7 Response," "Next Business Day
       Replacement"). Rare exception: a physical dongle/security key whose entire purpose is
       unlocking a software entitlement (no independent function) is still PREPAID despite shipping
       physically. NEVER classify as PREPAID: standalone hardware, cables/connectors/rack
       accessories, or one-time tariff/freight/installation charges just because they appear on the
       same quote as an actual PREPAID item — those belong in ASSET, BULK ITEM, SHIPPING, or LABOUR.
    4. BULK ITEM (Passive, structural, cables, mounts, connector packs, installation kits)
    5. ASSET (Active standalone electronics/hardware with no bundled usage right — a licence
       elsewhere referencing this hardware's serial number does NOT make the hardware PREPAID)

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
  // Original filename — used to detect a spreadsheet source, since browsers
  // report inconsistent (or blank) MIME types for .csv across OSes.
  fileName?: string;
  format: 'base' | 'term-dated';
  customInstructions: string;
  // Short identifying descriptions (e.g. "Acme — WidgetPro — SN-123") of
  // specific line items a human has already reviewed and approved as
  // licence candidates — when present, extraction is scoped to ONLY these,
  // rather than letting Claude independently re-decide what counts as a
  // licence across the whole document (which is how hardware/shipping/
  // tariff line items were leaking into licence sheets).
  focusItems?: string[];
}

const SPREADSHEET_EXTENSION = /\.(csv|xlsx|xls)$/i;
const SPREADSHEET_MIME = /spreadsheet|csv|ms-excel/i;

function isSpreadsheetSource(mimeType: string, fileName?: string): boolean {
  return (!!fileName && SPREADSHEET_EXTENSION.test(fileName)) || SPREADSHEET_MIME.test(mimeType);
}

// Renders every sheet/tab as CSV text, labeled by sheet name, so a
// multi-tab workbook (e.g. a GVCare equipment appendix on its own tab)
// reaches Claude with the same completeness a multi-page PDF would.
function spreadsheetToPromptText(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return workbook.SheetNames
    .map((name) => `--- Sheet: ${name} ---\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`)
    .join('\n\n');
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
  // Fallback line total — used when "terms" is empty (e.g. a perpetual
  // licence with no coverage dates) so the price isn't lost along with the
  // dates. When terms has entries, their own "amount" values are what's used.
  amount?: number;
  terms?: RawLicenseTerm[];
}

// A perpetual/one-time item with no coverage dates still needs to carry its
// price somewhere — this synthesizes a single blank-dated term from the
// item's fallback "amount" rather than silently dropping it to 0.
function effectiveTerms(r: RawLicenseItem): RawLicenseTerm[] {
  if (r.terms && r.terms.length > 0) return r.terms;
  return [{ start: '', end: '', amount: r.amount ?? 0 }];
}

export async function extractLicenseItems(client: Anthropic, input: ExtractLicenseInput): Promise<ExtractLicenseResult> {
  const { base64Data, mimeType, fileName, format, customInstructions, focusItems } = input;
  const cleanBase64 = base64Data.replace(/^data:.+;base64,/, '');
  const isSpreadsheet = isSpreadsheetSource(mimeType, fileName);

  const systemPrompt = `
    You are an expert at parsing vendor licence and support-agreement documents (e.g. Ross Video,
    Grass Valley/GVCare renewal quotes, CapEx upgrade sheets) into structured licence records for
    import — NOT a generic invoice/PO. Follow these rules precisely.

    The source may be a PDF/image of a quote, OR a raw spreadsheet export (shown below as CSV text,
    one section per original sheet/tab) with its own arbitrary column headers that do NOT already
    match the target fields — map its columns to the fields below using judgement (e.g. columns named
    "Start Date"/"End Date"/"Price" or "Year 1 Price"/"Year 2 Price" map into "terms"; a "Notes" or
    "Comments" column maps to Review Notes). Never assume a spreadsheet input already matches the
    output schema as-is.
    ${focusItems && focusItems.length > 0 ? `
    *** SCOPE RESTRICTION — READ FIRST, OUTRANKS EVERYTHING BELOW ***
    A human has already reviewed this document's line items and approved ONLY the following as
    licence candidates. Match each one to its corresponding line in the source document (by
    manufacturer/product/model/serial — use judgement, the exact wording may differ slightly) and
    extract ONLY these as licence records. Do NOT extract any other line item in the document, even
    if it looks like it could be a licence, warranty, SLA, or service — everything else has already
    been reviewed and excluded by a human and must not appear in your output:
    ${focusItems.map((f) => `    - ${f}`).join('\n')}
    ` : ''}
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
    "Invoice Number", "Review Notes", "amount", and "terms".

    "terms" is an array of { "start": "MM/DD/YYYY", "end": "MM/DD/YYYY", "amount": number } — one
    entry per distinct coverage period this line item has. Most lines have exactly one term; a
    multi-year contract has one entry per year found in the document. Never collapse multiple years
    into a single term — capture every year you can find, even if a product only appears in a later
    year (e.g. an item that first appears in Year 2, not Year 1).

    "amount" is this line's total price, ALWAYS populated even when "terms" is empty — it exists so
    a perpetual or one-time item's price is never lost just because it has no coverage dates (see
    rule 3 below).

    FIELD RULES:
    1. **Contract Name** is the licence name — give each distinct licence a clear, identifiable name.
       Never use the source file name. When one document produces multiple licence records that
       would otherwise be indistinguishable, pull a differentiator from the product name/model/
       description (e.g. include the model or product group in the name).
    2. **Client**: leave blank unless the document explicitly states this is a System Integrator (SI)
       reseller account — never populate with the end customer/venue name.
    3. **Term dates** (inside "terms"): use ONLY explicit coverage Start/End dates that are actually
       stated in the document for that line — whether as their own field(s) in a proposal/line-item
       detail section, or written out within the item's own name/description (e.g. a line literally
       stating a coverage range). These vary by line item; do not apply one date range to everything.
       **Purchase Date, Order Date, Due Date, and quote validity date are NEVER term dates** — they
       mean something else entirely (when the order was placed, when payment/delivery is due) and
       must never be used to calculate, infer, or guess a coverage Start/End. A duration mentioned in
       the name alone ("Annual Subscription," "3 Year Term," "One Year") without an actual date range
       stated anywhere is NOT enough to fabricate dates from — leave "start" and "end" as empty
       strings in that case. Whenever there are no explicit term dates for a line (perpetual licence,
       one-time CapEx upgrade, or a duration-only description with no real date range given), still
       include exactly ONE entry in "terms" carrying that line's price (from "amount"), with "start"
       and "end" left blank — NEVER return an empty "terms" array just because dates are missing,
       since that would silently drop the price too. Add a Review Note noting that no explicit term
       dates were stated in the source.
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
    8. **Type** must be exactly one of: License, SLA, Hardware, Service, Labor, Materials, Travel —
       use this classification guidance (drawn from real processing sessions, see
       docs/licence-classification-reference.md for the full reference):
       - **License** = a right to USE software/a feature/a bundled capability for a period or
         perpetually — the commercial substance is "you may use X," not "here is a physical thing."
         Tells: "License," "Subscription," "Seats," "Module," "Add-on," "Entitlement"; priced per
         seat/user/port/channel/instance, or a flat annual/perpetual fee. May reference separate
         hardware via Asset Relationships without itself being hardware (e.g. a port-expansion
         license pointing at a chassis's serial number) — that hardware is ALWAYS its own separate
         row, never merged into the licence row. Includes site licenses (flat fee, unlimited seats),
         node-locked licenses, capacity/tier upgrades (e.g. "Storage Tier Upgrade, 10TB to 50TB"),
         and feature unlocks on already-owned hardware (e.g. "Codec Pack License — H.265
         Enablement").
       - **SLA** = an ongoing support/maintenance COVERAGE commitment — response times, repair,
         replacement, or update entitlement over a period. Not a usage right; a right to receive
         support. Tells: "SLA," "Care," "Care Plan," "Support Agreement," "TAC," "Maintenance
         Agreement," tiered (Gold/Silver/Bronze), response-time language ("24/7 Response," "Next
         Business Day Replacement," "4-Hour Swap"). "Extended Warranty" counts as SLA even though
         not literally labeled that — map it to SLA and add a Review Note flagging the mapping,
         since there is no dedicated "Prepaid" Type value. If a line could be "receiving updates"
         (SLA) or "running a new feature set" (License) and it's genuinely unclear which, add a
         Review Note flagging it rather than guessing.
       - **Hardware** = standalone physical equipment with no bundled usage right. A licence
         elsewhere referencing this hardware's serial number does not make the hardware itself a
         licence — keep them as separate rows. Exception: a physical dongle/security key whose
         entire purpose is unlocking a software entitlement (no independent function) is License,
         not Hardware, despite shipping physically.
       - **Materials / Labor / Travel / Service** = one-time fees, bulk/passive items, and services
         clearly not a usage right or coverage promise — cables, connector packs, installation kits
         (Materials); installation/engineering labor (Labor); per-diem/travel reimbursement
         (Travel); items under an "OPTION" section per rule 7 above (Service). One-time tariff
         surcharges and freight/logistics fees are Materials, never License or SLA, even on the same
         quote as real licence items.
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

  let content: Anthropic.MessageParam['content'];
  if (isSpreadsheet) {
    // Spreadsheets aren't a document/image type Claude's API can read
    // directly — parse them into CSV text server-side and hand that over
    // as plain text instead, alongside the same field rules.
    const sheetText = spreadsheetToPromptText(Buffer.from(cleanBase64, 'base64'));
    content = [
      {
        type: 'text',
        text: `SOURCE SPREADSHEET DATA (raw rows below — map into the target fields per the rules above):\n\n${sheetText}`,
      },
    ];
  } else {
    const isImage = mimeType.startsWith('image/');
    const documentBlock: Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam = isImage
      ? { type: 'image', source: { type: 'base64', media_type: mimeType as any, data: cleanBase64 } }
      : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: cleanBase64 } };
    content = [
      documentBlock,
      { type: 'text', text: 'Extract every licence/contract line item per the rules above.' },
    ];
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: systemPrompt,
    messages: [{ role: 'user', content }],
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
      effectiveTerms(r).forEach((t) => {
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
  const maxTerms = Math.max(1, ...raw.map((r) => effectiveTerms(r).length));
  const columns = buildTermDatedColumns(maxTerms);
  const items: InvoiceItem[] = raw.map((r) => {
    const row: InvoiceItem = { ...shared(r) };
    const terms = effectiveTerms(r);
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
