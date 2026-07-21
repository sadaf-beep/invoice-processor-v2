import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_COLUMNS } from '../types.js';
import { readGmailEnv, getAccessToken, getProfile, sendEmail, EmailAttachment } from './gmailClient.js';
import { scanInvoiceEmails } from './invoiceScan.js';
import { ensureDateFolder, getFolderLink, uploadFile } from './driveClient.js';
import { toCsvString } from './csv.js';
import { postSlackMessage } from './slackClient.js';

export interface AutomationRunResult {
  ranAt: string;
  processed: number;
  total: number;
  debug: unknown;
}

// The full scan -> extract -> archive -> email -> Slack pipeline, shared by
// the schedule-gated cron handler (api/cron/daily-scan.ts) and the in-app
// "Run automation now" button (api/automation-run-now.ts) so both stay in
// sync rather than drifting apart.
export async function runDailyAutomation(anthropicKey: string): Promise<AutomationRunResult> {
  const gmailEnv = readGmailEnv();
  if (!gmailEnv) throw new Error('Gmail is not connected.');

  const client = new Anthropic({ apiKey: anthropicKey });
  const runDate = new Date().toISOString().slice(0, 10);

  const { messages, debug } = await scanInvoiceEmails(client, gmailEnv, {
    columns: DEFAULT_COLUMNS,
    customInstructions: '',
    daysBack: 3,
    maxMessages: 10,
  });

  if (messages.length === 0) {
    return { ranAt: runDate, processed: 0, total: 0, debug };
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

  return { ranAt: runDate, processed: processedCount, total: messages.length, debug };
}
