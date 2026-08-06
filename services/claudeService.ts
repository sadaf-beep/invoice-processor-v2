import { InvoiceItem, ColumnConfig } from "../types";

// Calls our own /api/extract serverless function rather than the Anthropic
// API directly — the API key lives server-side only (see api/extract.ts)
// and is never bundled into client-side JS.
export const processInvoiceWithClaude = async (
  base64Data: string,
  mimeType: string,
  columns: ColumnConfig[],
  customInstructions: string,
  pageRange: string
): Promise<InvoiceItem[]> => {
  const response = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64Data, mimeType, columns, customInstructions, pageRange }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Extraction failed with status ${response.status}`);
  }

  const { items } = (await response.json()) as { items: InvoiceItem[] };
  return items;
};

// Calls /api/extract-license — the licence/support-agreement extraction
// path, distinct from the asset invoice schema above. Returns columns too,
// since the term-dated format's column set is sized dynamically to however
// many coverage terms were actually found in the document.
export const processLicenseWithClaude = async (
  base64Data: string,
  mimeType: string,
  fileName: string,
  format: 'base' | 'term-dated',
  customInstructions: string,
  focusItems?: string[]
): Promise<{ items: InvoiceItem[]; columns: ColumnConfig[] }> => {
  const response = await fetch('/api/extract-license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Data, mimeType, fileName, format, customInstructions, focusItems }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `License extraction failed with status ${response.status}`);
  }

  return response.json();
};

// Messages are opaque to the client — they're just handed back to
// /api/profile-assistant verbatim on the next turn so the server (which owns
// the Anthropic message-shape bookkeeping) can continue the conversation.
export type ProfileAssistantMessage = Record<string, unknown>;

export interface ProfileAssistantColumn {
  label: string;
  type: 'string' | 'number' | 'date';
}

export interface ProfileProposal {
  name: string;
  columns: ProfileAssistantColumn[];
  instructions: string;
  licenseLayout?: 'base' | 'term-dated';
  summaryForUser: string;
}

export interface ProfileAssistantTurnResult {
  messages: ProfileAssistantMessage[];
  reply: string;
  proposal: ProfileProposal | null;
}

// Calls /api/profile-assistant — the conversational AI helper that turns a
// client's plain-language description of their PO/licence format (or an
// uploaded processing-skill document) into a FormatProfile proposal.
export const runProfileAssistantTurn = async (
  family: 'asset' | 'license',
  messages: ProfileAssistantMessage[],
  userMessage?: string,
  seedDocument?: string
): Promise<ProfileAssistantTurnResult> => {
  const response = await fetch('/api/profile-assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ family, messages, userMessage, seedDocument }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Profile assistant failed with status ${response.status}`);
  }

  return response.json();
};
