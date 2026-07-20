import type { VercelRequest, VercelResponse } from '@vercel/node';

// One-time setup route: visit this URL in your browser, sign in with the
// Gmail account to scan, and it redirects to Google's consent screen. Google
// then redirects back to /api/gmail/callback with a refresh token to copy
// into Vercel env vars. Not used by the app at runtime.
export default function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  if (!clientId) {
    res.status(500).send('GMAIL_CLIENT_ID is not configured on the server.');
    return;
  }

  const redirectUri = `https://${req.headers.host}/api/gmail/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/gmail.modify',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
