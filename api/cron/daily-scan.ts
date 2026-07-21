import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_COLUMNS } from '../../types.js';
import { readGmailEnv, getAccessToken, getProfile, sendEmail, EmailAttachment } from '../../lib/gmailClient.js';
import { scanInvoiceEmails } from '../../lib/invoiceScan.js';
import { ensureDateFolder, uploadFile } from '../../lib/driveClient.js';
import { toCsvString } from '../../lib/csv.js';
import { ensureSchema, insertProcessedInvoice } from '../../lib/db.js';

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

    await ensureSchema();
    const accessToken = await getAccessToken(gmailEnv);
    const profile = await getProfile(accessToken);

    let folderId: string | null = null;
    const emailAttachments: EmailAttachment[] = [];
    const summaryLines: string[] = [];
    let processedCount = 0;

    for (const message of messages) {
      if (message.status === 'skipped') {
        await insertProcessedInvoice({
          runDate, messageId: message.id, subject: message.subject, fromAddress: message.from,
          fileName: message.fileName, itemCount: 0, status: 'skipped',
        });
        continue;
      }

      if (message.status === 'error') {
        await insertProcessedInvoice({
          runDate, messageId: message.id, subject: message.subject, fromAddress: message.from,
          fileName: message.fileName, itemCount: 0, status: 'error', error: message.error,
        });
        summaryLines.push(`✗ ${message.fileName}: ${message.error}`);
        continue;
      }

      // status === 'processed' from here on
      try {
        if (!folderId) folderId = await ensureDateFolder(accessToken, runDate);

        let drivePdfLink: string | null = null;
        for (const attachment of message.attachments) {
          const uploaded = await uploadFile(accessToken, {
            name: attachment.filename,
            mimeType: 'application/pdf',
            base64Data: attachment.base64Data,
            folderId,
          });
          if (!drivePdfLink) drivePdfLink = uploaded.webViewLink;
        }

        const csvString = toCsvString(message.items, DEFAULT_COLUMNS);
        const csvName = `${message.fileName.replace(/\.pdf$/i, '')}.csv`;
        const uploadedCsv = await uploadFile(accessToken, {
          name: csvName,
          mimeType: 'text/csv',
          base64Data: Buffer.from(csvString, 'utf-8').toString('base64'),
          folderId,
        });

        await insertProcessedInvoice({
          runDate, messageId: message.id, subject: message.subject, fromAddress: message.from,
          fileName: message.fileName, itemCount: message.itemCount, status: 'processed',
          drivePdfLink, driveCsvLink: uploadedCsv.webViewLink,
        });

        emailAttachments.push({ filename: csvName, content: Buffer.from(csvString, 'utf-8').toString('base64'), contentType: 'text/csv' });
        summaryLines.push(`✓ ${message.fileName}: ${message.itemCount} row${message.itemCount === 1 ? '' : 's'}`);
        processedCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await insertProcessedInvoice({
          runDate, messageId: message.id, subject: message.subject, fromAddress: message.from,
          fileName: message.fileName, itemCount: message.itemCount, status: 'error', error: msg,
        });
        summaryLines.push(`✗ ${message.fileName} (archive/log step): ${msg}`);
      }
    }

    if (summaryLines.length > 0) {
      await sendEmail(accessToken, {
        to: profile.emailAddress,
        subject: `InvoiceIntel: ${processedCount} invoice${processedCount === 1 ? '' : 's'} processed — ${runDate}`,
        text: `Daily scan for ${runDate}:\n\n${summaryLines.join('\n')}\n\nArchived to Google Drive under InvoiceIntel/${runDate}.`,
        attachments: emailAttachments,
      });
    }

    res.status(200).json({ ranAt: runDate, processed: processedCount, total: messages.length, debug });
  } catch (error) {
    console.error('Daily scan cron error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
