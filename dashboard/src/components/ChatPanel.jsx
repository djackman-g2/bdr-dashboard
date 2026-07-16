import { useEffect, useRef, useState } from 'react'
import { streamChat } from '../lib/data.js'

// Phase 6 — ask Claude about this account. The server grounds every answer on
// the account's research JSON (direct Anthropic API, no MCPs). Keyed by slug
// in AccountDetail so the conversation resets when you switch accounts.

const STARTERS = [
  'Why reach out now? Give me the two strongest angles.',
  'What should I probe on a first call?',
  'Draft a short cold-call opener for my best contact.',
]

export default function ChatPanel({ slug }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState(null)
  const scrollRef = useRef(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  async function send(text) {
    const content = (text ?? draft).trim()
    if (!content || streaming) return
    const history = [...messages, { role: 'user', content }]
    setDraft('')
    setError(null)
    setStreaming(true)
    let reply = ''
    setMessages([...history, { role: 'assistant', content: '' }])
    try {
      await streamChat(slug, history, {
        onDelta: (t) => {
          reply += t
          setMessages([...history, { role: 'assistant', content: reply }])
        },
        onError: (e) => setError(e.message),
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setStreaming(false)
      // Nothing streamed back (early failure) — drop the empty placeholder.
      if (!reply) setMessages(history)
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">Ask Claude</h2>
        <span className="text-xs text-zinc-500">answers grounded on this account's research</span>
        {messages.length > 0 && (
          <button
            onClick={() => {
              setMessages([])
              setError(null)
            }}
            disabled={streaming}
            className="ml-auto text-xs text-zinc-500 hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-300"
          >
            clear
          </button>
        )}
      </div>

      {messages.length === 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {STARTERS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={streaming}
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:border-primary-400 hover:text-primary-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-primary-500 dark:hover:text-primary-300"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <div ref={scrollRef} className="mb-3 max-h-96 space-y-3 overflow-y-auto pr-1">
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
              {m.role === 'user' ? (
                <p className="max-w-[85%] rounded-lg bg-primary-100 px-3 py-2 text-sm whitespace-pre-wrap dark:bg-primary-950/60">
                  {m.content}
                </p>
              ) : (
                <p className="text-sm whitespace-pre-wrap">
                  {m.content}
                  {streaming && i === messages.length - 1 && (
                    <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-primary-500 align-middle motion-reduce:animate-none" />
                  )}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="mb-2 rounded border border-brand-300 bg-brand-50 p-2 text-xs text-brand-700 dark:border-brand-900 dark:bg-brand-950/60 dark:text-brand-300">
          {error}
        </p>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          rows={draft.includes('\n') ? 3 : 1}
          placeholder="Ask about this account… (Enter to send, Shift+Enter for a new line)"
          aria-label="Ask Claude about this account"
          className="w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-300/50 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-primary-400 dark:focus:ring-primary-700/40"
        />
        <button
          onClick={() => send()}
          disabled={streaming || !draft.trim()}
          className="rounded-md bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-primary-600"
        >
          {streaming ? '…' : 'Send'}
        </button>
      </div>
    </section>
  )
}
