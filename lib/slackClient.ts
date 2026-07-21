// Posts to a Slack Incoming Webhook — deliberately not a full Slack app/bot,
// since that would need OAuth + a files:write scope just to attach a file.
// A webhook can't upload files into Slack, but it can post a message with
// links (to the Drive folder and each CSV), which is all that was asked for
// and needs zero Slack-side app setup beyond generating the webhook URL.
export async function postSlackMessage(webhookUrl: string, text: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook error: ${res.status} ${await res.text()}`);
  }
}
