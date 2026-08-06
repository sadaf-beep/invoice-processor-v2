import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_COLUMNS, LICENSE_BASE_COLUMNS } from '../types.js';

const MODEL = 'claude-opus-4-8';

// The one structured "output" of a conversation — everything else the
// assistant says is free-form chat. It's modeled as a tool rather than
// parsed from prose so the client only ever has to trust `proposal`, never
// scrape it out of a text reply.
const PROPOSE_FORMAT_TOOL: Anthropic.Tool = {
  name: 'propose_format',
  description:
    "Finalize a format profile once you have enough information — a name, the fields to extract, and any handling instructions. Calling this ends the information-gathering part of the conversation and shows the client a proposal to confirm or revise.",
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'A short, human name for this format, e.g. "TVA Pedido PO" or "Acme Renewals".',
      },
      columns: {
        type: 'array',
        description: 'The fields to extract, in the order they should appear as spreadsheet columns.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Column header shown to the client.' },
            type: { type: 'string', enum: ['string', 'number', 'date'] },
          },
          required: ['label', 'type'],
        },
      },
      instructions: {
        type: 'string',
        description:
          'The full extraction instructions for Claude to follow when processing this client\'s documents going forward — field-by-field handling rules, edge cases, anything the client told you about how their documents are laid out. Written as instructions to an extraction model, not as a message to the client.',
      },
      licenseLayout: {
        type: 'string',
        enum: ['base', 'term-dated'],
        description:
          'Licence/SLA profiles only: "base" for one row per line item, "term-dated" if coverage terms should each get their own Start/End/Amount columns.',
      },
      summaryForUser: {
        type: 'string',
        description:
          "A short, plain-language summary of the proposed format for the client to review — what fields it captures and the key handling rules — ending by asking them to confirm or say what to change.",
      },
    },
    required: ['name', 'columns', 'instructions', 'summaryForUser'],
  },
};

function columnReference(family: 'asset' | 'license'): string {
  const cols = family === 'asset' ? DEFAULT_COLUMNS : LICENSE_BASE_COLUMNS;
  return cols.map((c) => `${c.label} (${c.type})`).join(', ');
}

function systemPrompt(family: 'asset' | 'license', hasSeedDocument: boolean): string {
  const kind = family === 'asset' ? 'asset invoice' : 'licence/SLA';
  const reference = columnReference(family);

  const base = `You are helping a client of an invoice-processing tool set up a custom extraction format for their ${kind} documents. The tool already ships with a default format for this document type — its fields are: ${reference}. Your job is to help the client end up with a format tailored to their documents, then call propose_format to finalize it.

Guidelines:
- Suggest fields based on the default list above as a starting point, but adapt freely — add fields the client mentions, drop ones that don't apply, rename to match their terminology.
- When the client describes a field-specific handling rule (e.g. "ignore shipping rows", "dates are in DD/MM/YYYY", "treat renewals as new rows"), fold it into the instructions you'll eventually propose — don't just acknowledge it and forget it.
- Write the final "instructions" field as directives to an extraction model (second person, imperative, specific), not as a recap of the conversation.
- Ask only what you need to — usually one or two short questions are enough. Don't interrogate the client with a long questionnaire.
- Only call propose_format once you're confident you have a workable format. Before that, just respond with plain text questions or suggestions.
- After calling propose_format, the client sees your summaryForUser and can either confirm or ask for changes — if they ask for changes, continue the conversation and call propose_format again with the revision.`;

  if (!hasSeedDocument) return base;

  return `${base}

The client has uploaded an existing processing-skill document describing how their documents should be handled. Treat it as the primary source of truth: extract the fields and rules it already defines directly into your proposal rather than re-asking the client for information it already contains. Call propose_format right away unless something in the document is genuinely ambiguous — this client wants immediate results, not a long back-and-forth.`;
}

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

export interface ProfileAssistantInput {
  family: 'asset' | 'license';
  messages: Anthropic.MessageParam[];
  userMessage?: string;
  seedDocument?: string;
}

export interface ProfileAssistantResult {
  messages: Anthropic.MessageParam[];
  reply: string;
  proposal: ProfileProposal | null;
}

// Anthropic's API rejects a new user turn right after an assistant message
// that contains a tool_use block unless a matching tool_result comes first —
// and roles must strictly alternate, so that tool_result has to share the
// same user turn as any new user text rather than getting its own message.
// Since propose_format isn't a "real" tool — it's just how we get a
// structured proposal out of an otherwise free-form chat — we synthesize
// that tool_result ourselves so the client never has to know the mechanics.
function pendingToolResultBlocks(messages: Anthropic.MessageParam[]): Anthropic.ToolResultBlockParam[] | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) return null;

  const pendingToolUses = last.content.filter(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
  );
  if (pendingToolUses.length === 0) return null;

  return pendingToolUses.map((block) => ({
    type: 'tool_result',
    tool_use_id: block.id,
    content: 'Shown to the client for review.',
  }));
}

export async function runProfileAssistantTurn(
  client: Anthropic,
  input: ProfileAssistantInput
): Promise<ProfileAssistantResult> {
  const { family, userMessage, seedDocument } = input;
  let messages = input.messages ?? [];
  const pendingToolResults = pendingToolResultBlocks(messages);

  if (messages.length === 0) {
    const parts: string[] = [];
    if (seedDocument) {
      parts.push(`Here is our processing-skill document describing how these documents should be handled:\n\n${seedDocument}`);
    }
    if (userMessage) parts.push(userMessage);
    if (parts.length === 0) {
      throw new Error('Provide a userMessage or seedDocument to start the conversation.');
    }
    messages = [{ role: 'user', content: parts.join('\n\n') }];
  } else if (pendingToolResults) {
    const content: Anthropic.ContentBlockParam[] = [...pendingToolResults];
    if (userMessage) content.push({ type: 'text', text: userMessage } satisfies Anthropic.TextBlockParam);
    messages = [...messages, { role: 'user', content }];
  } else if (userMessage) {
    messages = [...messages, { role: 'user', content: userMessage }];
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt(family, Boolean(seedDocument)),
    tools: [PROPOSE_FORMAT_TOOL],
    messages,
  });

  const updatedMessages: Anthropic.MessageParam[] = [...messages, { role: 'assistant', content: response.content }];

  const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
  const reply = textBlocks.map((b) => b.text).join('\n\n');

  const proposeCall = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'propose_format'
  );
  const proposal = proposeCall ? (proposeCall.input as ProfileProposal) : null;

  return { messages: updatedMessages, reply, proposal };
}
