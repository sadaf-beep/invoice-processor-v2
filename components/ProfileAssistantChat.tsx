import React, { useState, useEffect, useRef } from 'react';
import { X, Bot, Loader2, Send, Check, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { runProfileAssistantTurn, ProfileAssistantMessage, ProfileProposal } from '../services/claudeService';

interface ChatBubble {
  role: 'user' | 'assistant';
  text: string;
}

interface ProfileAssistantChatProps {
  family: 'asset' | 'license';
  /** Text content of an uploaded processing-skill document, if this chat was opened from the skill-upload entry point. */
  seedDocument?: string;
  /** Shown in the chat log so the client can see what was uploaded — usually the file name. */
  seedLabel?: string;
  onClose: () => void;
  onSaved: (proposal: ProfileProposal) => void;
}

// Conversational entry point for building a FormatProfile: either a client
// describes their PO format in plain language, or (the seedDocument path)
// an existing processing-skill document is handed over for the AI to parse
// directly. Either way, the server (api/profile-assistant.ts) does the
// actual reasoning via Claude tool-use — this component just renders the
// back-and-forth and the resulting proposal for the user to confirm.
export const ProfileAssistantChat: React.FC<ProfileAssistantChatProps> = ({ family, seedDocument, seedLabel, onClose, onSaved }) => {
  const [bubbles, setBubbles] = useState<ChatBubble[]>(() =>
    seedDocument
      ? [{ role: 'user', text: seedLabel ? `📎 Uploaded ${seedLabel}` : '📎 Uploaded a processing-skill document' }]
      : [{
          role: 'assistant',
          text: "Tell me about your PO format — what fields it has, and any special handling rules (date formats, rows to ignore, currency conversions, etc). I'll suggest a format and you can confirm before anything is saved.",
        }]
  );
  const [messages, setMessages] = useState<ProfileAssistantMessage[]>([]);
  const [proposal, setProposal] = useState<ProfileProposal | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  const sendTurn = async (userMessage?: string, seed?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await runProfileAssistantTurn(family, messages, userMessage, seed);
      setMessages(result.messages);
      if (result.reply) setBubbles((prev) => [...prev, { role: 'assistant', text: result.reply }]);
      setProposal(result.proposal);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (seedDocument) sendTurn(undefined, seedDocument);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [bubbles, isLoading, proposal]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setBubbles((prev) => [...prev, { role: 'user', text }]);
    setInput('');
    setProposal(null);
    sendTurn(text);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[60] flex items-center justify-center p-6"
        style={{ background: 'rgba(28,25,23,0.4)' }}
      >
        <motion.div
          initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg h-[600px] max-h-[85vh] bg-[color:var(--color-surface)] rounded-2xl shadow-2xl border border-[color:var(--color-line)] flex flex-col overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-[color:var(--color-line)] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: 'linear-gradient(150deg, #D0714B, #B04E2D)' }}>
                <Bot className="text-white w-4 h-4" />
              </div>
              <div>
                <h2 className="text-[14px] font-bold text-[color:var(--color-ink)] leading-tight">Build a format with AI</h2>
                <p className="text-[11px] text-[color:var(--color-ink-muted)] leading-tight mt-0.5">
                  {family === 'asset' ? 'Asset invoice' : 'Licence / SLA'} format · preview
                </p>
              </div>
            </div>
            <button onClick={onClose} className="tbtn"><X size={18} /></button>
          </div>

          <div ref={logRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {bubbles.map((b, i) => (
              <div key={i} className={`flex ${b.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13px] leading-snug whitespace-pre-wrap ${
                    b.role === 'user' ? 'text-white' : 'bg-[color:var(--color-surface-sunken)] text-[color:var(--color-ink)]'
                  }`}
                  style={b.role === 'user' ? { background: 'var(--color-brand)' } : undefined}
                >
                  {b.text}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="rounded-xl px-3.5 py-2.5 bg-[color:var(--color-surface-sunken)] flex items-center gap-2">
                  <Loader2 size={13} className="animate-spin text-[color:var(--color-brand)]" />
                  <span className="text-[12px] text-[color:var(--color-ink-muted)]">Thinking…</span>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg px-3 py-2.5 border border-[color:var(--color-line)] bg-[color:var(--color-danger-soft)] flex items-start gap-2">
                <AlertCircle size={14} className="text-[color:var(--color-danger)] shrink-0 mt-0.5" />
                <p className="text-[12px] text-[color:var(--color-danger)] leading-snug">{error}</p>
              </div>
            )}

            {proposal && (
              <div className="rounded-xl border border-[color:var(--color-brand-border)] bg-[color:var(--color-brand-soft)] p-3.5 space-y-2.5">
                <p className="text-[12.5px] font-bold text-[color:var(--color-ink)]">Proposed format: {proposal.name}</p>
                <div className="flex flex-wrap gap-1.5">
                  {proposal.columns.map((c, i) => (
                    <span key={i} className="rchip">
                      {c.label} <span className="text-[color:var(--color-ink-muted)]">· {c.type}</span>
                    </span>
                  ))}
                </div>
                {proposal.licenseLayout && (
                  <p className="text-[11px] text-[color:var(--color-ink-muted)]">
                    Layout: {proposal.licenseLayout === 'base' ? 'Base' : 'Term-dated'}
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => onSaved(proposal)}
                    className="flex-1 h-9 rounded-lg text-[12.5px] font-semibold text-white flex items-center justify-center gap-1.5"
                    style={{ background: 'var(--color-brand)' }}
                  >
                    <Check size={13} /> Looks good — save format
                  </button>
                </div>
                <p className="text-[11px] text-[color:var(--color-ink-muted)]">Or reply below to ask for changes.</p>
              </div>
            )}
          </div>

          <div className="px-5 py-4 border-t border-[color:var(--color-line)] shrink-0 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
              disabled={isLoading}
              placeholder="Describe your PO format, or answer the question above…"
              className="flex-1 h-10 px-3 rounded-lg border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface)] text-[12.5px] outline-none focus:border-[color:var(--color-brand)] disabled:opacity-60"
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="h-10 w-10 rounded-lg flex items-center justify-center text-white shrink-0 disabled:opacity-40"
              style={{ background: 'var(--color-brand)' }}
            >
              <Send size={15} />
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
