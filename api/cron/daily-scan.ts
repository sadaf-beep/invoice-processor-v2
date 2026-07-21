import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_COLUMNS } from '../../types.js';
import { readGmailEnv, getAccessToken, getProfile, sendEmail, EmailAttachment } from '../../lib/gmailClient.js';
import { scanInvoiceEmails } from '../../lib/invoiceScan.js';
import { ensureDateFolder, getFolderLink, uploadFile } from '../../lib/driveClient.js';
import { toCsvString } from '../../lib/csv.js';
import { postSlackMessage } from '../../lib/slackClient.js';

export const config = {
  maxDuration: 60,
};

// Vercel invokes cron jobs with an "Authorization: Bearer <CRON_SECRET>"
// header when CRON_SECRET is set — this rejects any other caller so an
// outsider can't trigger (and burn API budget on) this endpoint.
function isAuthorizedCronRequest(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorizedCronRequest(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured.' });
    return;
  }

  const gmailEnv = readGmailEnv();
  if (!gmailEnv) {
    res.status(500).json({ error: 'Gmail is not connected.' });
    return;
  }

  const client = new Anthropic({ apiKey: anthropicKey });
  const runDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC — the cron fires at 00:00 UTC so this matches the intended local calendar day

  try {
    // A conservative maxMessages here — this runs unattended with no one to
    // retry it, and dedup labeling means anything not reached today is
    // simply picked up on tomorrow's run rather than lost.
    const { messages, debug } = await scanInvoiceEmails(client, gmailEnv, {
      columns: DEFAULT_COLUMNS,
      customInstructions: '',
      daysBack: 3,
      maxMessages: 10,
    });

    if (messages.length === 0) {
      res.status(200).json({ ranAt: runDate, processed: 0, debug });
      return;
    }

    const accessToken = await getAccessToken(gmailEnv);
    const profile = await getProfile(accessToken);

    let folderId: string | null = null;
    const emailAttachments: EmailAttachment[] = [];
    const summaryLines: string[] = [];
    const slackLines: string[] = [];
    let processedCount = 0;

    for (const message of messages) {
      if (message.status === 'error') {
        summaryLines.push(`✗ ${message.fileName}: ${message.error}`);
        slackLines.push(`✗ *${message.fileName}*: ${message.error}`);
        continue;
      }
      if (message.status === 'skipped') {
        continue;
      }

      // status === 'processed' from here on
      try {
        if (!folderId) folderId = await ensureDateFolder(accessToken, runDate);

        for (const attachment of message.attachments) {
          await uploadFile(accessToken, {
            name: attachment.filename,
            mimeType: 'application/pdf',
            base64Data: attachment.base64Data,
            folderId,
          });
        }

        const csvString = toCsvString(message.items, DEFAULT_COLUMNS);
        const csvName = `${message.fileName.replace(/\.pdf$/i, '')}.csv`;
        const uploadedCsv = await uploadFile(accessToken, {
          name: csvName,
          mimeType: 'text/csv',
          base64Data: Buffer.from(csvString, 'utf-8').toString('base64'),
          folderId,
        });

        emailAttachments.push({ filename: csvName, content: Buffer.from(csvString, 'utf-8').toString('base64'), contentType: 'text/csv' });
        summaryLines.push(`✓ ${message.fileName}: ${message.itemCount} row${message.itemCount === 1 ? '' : 's'}`);
        slackLines.push(`✓ *${message.fileName}*: ${message.itemCount} row${message.itemCount === 1 ? '' : 's'} — <${uploadedCsv.webViewLink}|CSV>`);
        processedCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summaryLines.push(`✗ ${message.fileName} (archive step): ${msg}`);
        slackLines.push(`✗ *${message.fileName}* (archive step): ${msg}`);
      }
    }

    if (summaryLines.length > 0) {
      await sendEmail(accessToken, {
        to: profile.emailAddress,
        subject: `InvoiceIntel: ${processedCount} invoice${processedCount === 1 ? '' : 's'} processed — ${runDate}`,
        text: `Daily scan for ${runDate}:\n\n${summaryLines.join('\n')}\n\nArchived to Google Drive under InvoiceIntel/${runDate}.`,
        attachments: emailAttachments,
      });

      const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
      if (slackWebhookUrl) {
        const folderLink = folderId ? await getFolderLink(accessToken, folderId) : null;
        const folderLine = folderLink ? `\n📁 <${folderLink}|Open today's Drive folder>` : '';
        await postSlackMessage(
          slackWebhookUrl,
          `*InvoiceIntel — ${processedCount} invoice${processedCount === 1 ? '' : 's'} processed (${runDate})*\n${slackLines.join('\n')}${folderLine}`
        );
      }
    }

    res.status(200).json({ ranAt: runDate, processed: processedCount, total: messages.length, debug });
  } catch (error) {
    console.error('Daily scan cron error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
