import type { VercelRequest, VercelResponse } from '@vercel/node';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const page = (title: string, bodyHtml: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;line-height:1.5;color:#1c1917}
code{background:#f5f0e8;padding:2px 6px;border-radius:4px;word-break:break-all}
.token{background:#f5f0e8;padding:12px 14px;border-radius:8px;font-family:monospace;font-size:13px;word-break:break-all;margin:16px 0}</style>
</head><body>${bodyHtml}</body></html>`;

// One-time setup route — exchanges the code Google just issued for a refresh
// token. Displayed once so it can be copied into Vercel env vars
// (GMAIL_REFRESH_TOKEN); this route does not store it anywhere itself.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).send(page('Setup error', '<p>GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET are not configured on the server.</p>'));
    return;
  }

  const { code, error } = req.query as { code?: string; error?: string };
  if (error) {
    res.status(400).send(page('Google declined', `<p>Google returned an error: <code>${escapeHtml(error)}</code></p>`));
    return;
  }
  if (!code) {
    res.status(400).send(page('Missing code', '<p>No authorization code was provided.</p>'));
    return;
  }

  const redirectUri = `https://${req.headers.host}/api/gmail/callback`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const data = await tokenRes.json();

  if (!tokenRes.ok) {
    res.status(400).send(page('Token exchange failed', `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`));
    return;
  }

  if (!data.refresh_token) {
    res.status(200).send(page('No refresh token returned', `
      <h2>Google didn't return a refresh token</h2>
      <p>This usually means this Google account already granted access before. Revoke the existing
      grant at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>
      (look for this app), then visit <code>/api/gmail/auth</code> again.</p>
    `));
    return;
  }

  res.status(200).send(page('Copy your refresh token', `
    <h2>Copy this into Vercel</h2>
    <p>Add it as the <code>GMAIL_REFRESH_TOKEN</code> environment variable in your Vercel project
    settings (Production + Preview), then redeploy. This page will not show it again.</p>
    <div class="token">${escapeHtml(data.refresh_token)}</div>
    <p>Do not share this value or commit it anywhere — it grants ongoing access to this Gmail account.</p>
  `));
}
