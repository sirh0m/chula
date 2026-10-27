import { Fragment, useEffect, useRef, useState } from 'react';
import { CheckCheck, Loader2, SendHorizontal, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  'Listed 5 bags today at 7000 UGX',
  '8 bags of bread at 5k, was 15k, pickup 6-8pm',
  'Token ',
  'Status',
  'Sold out',
];

/** Render WhatsApp-style *bold* without using innerHTML. */
function WhatsAppText({ text }) {
  return text.split('\n').map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {line.split(/(\*[^*\n]+\*)/g).map((part, j) =>
        part.startsWith('*') && part.endsWith('*') && part.length > 2 ? <strong key={j}>{part.slice(1, -1)}</strong> : part,
      )}
    </Fragment>
  ));
}

const time = () => new Date().toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' });

export default function MerchantSimulatorPage() {
  const [merchants, setMerchants] = useState([]);
  const [merchantId, setMerchantId] = useState('');
  const [threads, setThreads] = useState({});
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState('');
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    api
      .simulatorMerchants()
      .then(({ merchants: list }) => {
        setMerchants(list);
        setMerchantId(list[0]?.id ?? '');
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  const merchant = merchants.find((m) => m.id === merchantId);
  const messages = threads[merchantId] ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const push = (message) => setThreads((t) => ({ ...t, [merchantId]: [...(t[merchantId] ?? []), message] }));

  const send = async (event) => {
    event?.preventDefault();
    const body = text.trim();
    if (!body || !merchant || sending) return;
    push({ from: 'me', text: body, at: time() });
    setText('');
    setSending(true);
    try {
      const result = await api.simulateWhatsApp({ from: merchant.phone, text: body });
      push({ from: 'bot', text: result.reply ?? '(no reply)', at: time(), meta: result.intent, source: result.source });
    } catch (err) {
      push({ from: 'bot', text: `Error: ${err.message}`, at: time(), meta: 'error' });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-6 lg:grid-cols-[1fr_340px]">
      <div className="flex h-[calc(100dvh-8rem)] min-h-[480px] flex-col overflow-hidden rounded-2xl border shadow-sm">
        <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
          <div className="grid size-10 place-items-center rounded-full bg-white/15 font-bold">C</div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">Chula Merchant Assistant</p>
            <p className="truncate text-xs opacity-80">{merchant ? `Chatting as ${merchant.name} · +${merchant.phone}` : 'Loading stores…'}</p>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-[#efe7dd] p-4">
          {loadError && <p className="rounded-lg bg-white p-3 text-sm text-destructive">{loadError}</p>}
          {messages.length === 0 && !loadError && (
            <div className="mx-auto max-w-sm rounded-lg bg-[#fff8c4] p-3 text-center text-xs text-[#5c5020] shadow-sm">
              This is a local stand-in for WhatsApp. Messages go through the same Gemini-powered agent as the real webhook. Try a
              suggestion on the right.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn('flex', m.from === 'me' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm',
                  m.from === 'me' ? 'rounded-tr-none bg-[#d9fdd3]' : 'rounded-tl-none bg-white',
                )}
              >
                <p className="leading-relaxed whitespace-pre-wrap text-[#111b21]">
                  <WhatsAppText text={m.text} />
                </p>
                <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-[#667781]">
                  {m.meta && m.from === 'bot' && (
                    <span className="mr-auto rounded bg-[#f0f2f5] px-1.5 py-0.5 font-mono">
                      {m.meta}
                      {m.source ? ` · ${m.source}` : ''}
                    </span>
                  )}
                  {m.at}
                  {m.from === 'me' && <CheckCheck className="size-3.5 text-[#53bdeb]" />}
                </p>
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex">
              <div className="flex items-center gap-2 rounded-lg rounded-tl-none bg-white px-3 py-2 text-xs text-[#667781] shadow-sm">
                <Loader2 className="size-3.5 animate-spin" /> typing…
              </div>
            </div>
          )}
        </div>

        <form onSubmit={send} className="flex items-center gap-2 bg-[#f0f2f5] p-3">
          <Input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message"
            className="rounded-full border-0 bg-white shadow-none"
            disabled={!merchant}
          />
          <Button type="submit" size="icon" className="shrink-0 rounded-full bg-[#00a884] hover:bg-[#029272]" disabled={!text.trim() || sending}>
            <SendHorizontal />
            <span className="sr-only">Send</span>
          </Button>
        </form>
      </div>

      <aside className="space-y-5">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Merchant WhatsApp</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Store staff manage stock and confirm pickups by texting Chula. Pick a store and send a message.
          </p>
        </div>
        <div className="grid gap-2">
          <label htmlFor="merchant" className="text-sm font-semibold">
            Store
          </label>
          <select
            id="merchant"
            value={merchantId}
            onChange={(e) => setMerchantId(e.target.value)}
            className="h-11 rounded-md border border-input bg-card px-3 text-sm font-medium"
          >
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.district})
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" /> Try saying
          </p>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setText(s);
                inputRef.current?.focus();
              }}
              className="cursor-pointer rounded-lg border bg-card px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-secondary"
            >
              {s === 'Token ' ? 'Token + a customer’s 6-digit code' : s}
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
