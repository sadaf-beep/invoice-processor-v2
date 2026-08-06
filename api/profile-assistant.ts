import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { runProfileAssistantTurn, ProfileAssistantInput } from '../lib/profileAssistant.js';

export const config = {
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
    return;
  }

  const { family, messages, userMessage, seedDocument } = req.body as ProfileAssistantInput;

  if (family !== 'asset' && family !== 'license') {
    res.status(400).json({ error: 'Missing or invalid required field: family ("asset" or "license").' });
    return;
  }

  const client = new Anthropic({ apiKey });

  try {
    const result = await runProfileAssistantTurn(client, { family, messages: messages ?? [], userMessage, seedDocument });
    res.status(200).json(result);
  } catch (error) {
    console.error('Profile assistant error:', error);
    const message = error instanceof Error ? error.message : String(error);
    const status = /Provide a userMessage or seedDocument/.test(message) ? 400 : 500;
    res.status(status).json({ error: message });
  }
}
