const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
// Flat name (no "/") — a slash creates a nested label, and Gmail's search
// parser handles quoted nested-label paths inconsistently, silently
// zeroing out results instead of treating it as a literal no-op exclusion.
const PROCESSED_LABEL_NAME = 'InvoiceIntel-Processed';

export interface GmailEnv {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function readGmailEnv(): GmailEnv | null {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

export async function getAccessToken(env: GmailEnv): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      refresh_token: env.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Gmail token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function gmailFetch(accessToken: string, path: string, init?: RequestInit) {
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Gmail API error on ${path}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export interface GmailMessageSummary {
  id: string;
  subject: string;
  from: string;
}

export async function listMessageIds(accessToken: string, query: string, maxResults = 25): Promise<string[]> {
  const data = await gmailFetch(accessToken, `/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`);
  return (data.messages || []).map((m: { id: string }) => m.id);
}

export async function getProfile(accessToken: string): Promise<{ emailAddress: string }> {
  return gmailFetch(accessToken, '/profile');
}

interface GmailPart {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  payload: GmailPart & { headers?: { name: string; value: string }[] };
}

export async function getMessage(accessToken: string, id: string): Promise<GmailMessage> {
  return gmailFetch(accessToken, `/messages/${id}?format=full`);
}

export function getHeader(message: GmailMessage, name: string): string {
  const header = message.payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

export interface PdfAttachmentRef {
  filename: string;
  attachmentId: string;
}

export function findPdfAttachments(message: GmailMessage): PdfAttachmentRef[] {
  const found: PdfAttachmentRef[] = [];
  const walk = (part: GmailPart) => {
    if (part.mimeType === 'application/pdf' && part.body?.attachmentId) {
      found.push({ filename: part.filename || 'invoice.pdf', attachmentId: part.body.attachmentId });
    }
    part.parts?.forEach(walk);
  };
  walk(message.payload);
  return found;
}

const base64UrlToBase64 = (data: string): string => {
  // Gmail returns unpadded base64url — restore standard base64 alphabet and
  // padding since not every decoder tolerates a missing "=" tail.
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  return base64 + padding;
};

export async function getAttachmentBase64(accessToken: string, messageId: string, attachmentId: string): Promise<string> {
  const data = await gmailFetch(accessToken, `/messages/${messageId}/attachments/${attachmentId}`);
  return base64UrlToBase64(data.data);
}

async function findLabelId(accessToken: string): Promise<string | null> {
  const data = await gmailFetch(accessToken, '/labels');
  // Gmail's own label-name uniqueness check is case-insensitive, so this
  // lookup has to match that — otherwise a differently-cased leftover from
  // an earlier attempt causes create to 409 while this "already exists"
  // check fails to find it, and the self-heal below can't recover.
  const target = PROCESSED_LABEL_NAME.toLowerCase();
  const existing = (data.labels || []).find((l: { name: string }) => l.name.toLowerCase() === target);
  return existing?.id ?? null;
}

export async function ensureProcessedLabelId(accessToken: string): Promise<string> {
  const existingId = await findLabelId(accessToken);
  if (existingId) return existingId;

  try {
    const created = await gmailFetch(accessToken, '/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: PROCESSED_LABEL_NAME,
        labelListVisibility: 'labelHide',
        messageListVisibility: 'hide',
      }),
    });
    return created.id;
  } catch (err) {
    // Another concurrent scan may have just created it (Gmail returns 409
    // "Label name exists or conflicts") — re-check before giving up.
    const nowExistingId = await findLabelId(accessToken);
    if (nowExistingId) return nowExistingId;
    throw err;
  }
}

export async function markProcessed(accessToken: string, messageId: string, labelId: string): Promise<void> {
  await gmailFetch(accessToken, `/messages/${messageId}/modify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ addLabelIds: [labelId] }),
  });
}

export { PROCESSED_LABEL_NAME };
