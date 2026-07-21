const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const ROOT_FOLDER_NAME = 'InvoiceIntel';

async function driveFetch(accessToken: string, url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Drive API error: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function findFolder(accessToken: string, name: string, parentId: string | null): Promise<string | null> {
  const parentClause = parentId ? ` and '${parentId}' in parents` : ` and 'root' in parents`;
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`;
  const data = await driveFetch(accessToken, `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`);
  return data.files?.[0]?.id ?? null;
}

async function createFolder(accessToken: string, name: string, parentId: string | null): Promise<string> {
  const data = await driveFetch(accessToken, `${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    }),
  });
  return data.id;
}

async function findOrCreateFolder(accessToken: string, name: string, parentId: string | null): Promise<string> {
  const existing = await findFolder(accessToken, name, parentId);
  if (existing) return existing;
  return createFolder(accessToken, name, parentId);
}

// Finds-or-creates "InvoiceIntel/<YYYY-MM-DD>", returning the dated folder's ID.
export async function ensureDateFolder(accessToken: string, dateStr: string): Promise<string> {
  const rootId = await findOrCreateFolder(accessToken, ROOT_FOLDER_NAME, null);
  return findOrCreateFolder(accessToken, dateStr, rootId);
}

export interface UploadedFile {
  id: string;
  webViewLink: string;
}

export async function uploadFile(
  accessToken: string,
  { name, mimeType, base64Data, folderId }: { name: string; mimeType: string; base64Data: string; folderId: string }
): Promise<UploadedFile> {
  const boundary = 'invoiceintel_boundary';
  const metadata = JSON.stringify({ name, parents: [folderId] });
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n${base64Data}\r\n` +
    `--${boundary}--`;

  const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Drive upload error: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
