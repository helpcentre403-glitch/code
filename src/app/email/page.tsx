'use client'

import { useState, useEffect } from 'react'
import { Mail, Send, Users, CheckCircle, AlertCircle, Info } from 'lucide-react'

export default function EmailSenderPage() {
  const [fromName, setFromName] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [recipientMode, setRecipientMode] = useState<'all' | 'custom'>('all')
  const [customTo, setCustomTo] = useState('')
  const [contactCount, setContactCount] = useState(0)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number; errors?: string[] } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/contacts?type=emails&limit=1')
      .then((r) => r.json())
      .then((d) => setContactCount(d.total ?? 0))
      .catch(() => {})
  }, [])

  async function handleSend() {
    if (!fromEmail || !subject || !body) {
      setError('Sender email, subject, and message body are required.')
      return
    }
    setSending(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromName, fromEmail, subject, body,
          recipientMode, customTo,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')
      setResult(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Email Sender</h1>
        <p className="text-slate-500 mt-1">Send bulk emails directly to your contact list</p>
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-start gap-3 text-sm text-blue-800">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p>Emails are sent via SMTP. Configure your SMTP credentials in <strong>Settings</strong> before sending.</p>
      </div>

      <div className="card p-5 space-y-5">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
          <Mail className="w-4 h-4 text-blue-500" /> Sender Details
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Sender Name</label>
            <input className="input" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Your Name" />
          </div>
          <div>
            <label className="label">Sender Email *</label>
            <input className="input" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="you@domain.com" />
          </div>
        </div>

        <div>
          <label className="label">Subject *</label>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Your email subject…" />
        </div>

        <div>
          <label className="label">Message Body * (HTML supported)</label>
          <textarea
            className="input font-mono text-xs resize-y"
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={'<p>Hello,</p>\n<p>Your message here…</p>\n<br/>\n<p>Best,<br/>Your Name</p>'}
          />
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
          <Users className="w-4 h-4 text-violet-500" /> Recipients
        </h2>
        <div className="flex gap-3">
          {[
            { v: 'all',    label: `All email contacts (${contactCount})` },
            { v: 'custom', label: 'Custom list' },
          ].map(({ v, label }) => (
            <label key={v} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="mode"
                value={v}
                checked={recipientMode === v}
                onChange={() => setRecipientMode(v as 'all' | 'custom')}
                className="accent-blue-600"
              />
              <span className="text-sm text-slate-700">{label}</span>
            </label>
          ))}
        </div>
        {recipientMode === 'custom' && (
          <div>
            <label className="label">Email addresses (comma or line separated)</label>
            <textarea
              className="input font-mono text-xs resize-y"
              rows={4}
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              placeholder="alice@example.com, bob@example.com&#10;carol@example.com"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-4 space-y-2">
          <div className="flex items-center gap-2 text-emerald-800 font-semibold">
            <CheckCircle className="w-5 h-5" /> Send complete
          </div>
          <p className="text-sm text-emerald-700">
            ✓ {result.sent} sent &nbsp;·&nbsp; ✗ {result.failed} failed
          </p>
          {result.errors && result.errors.length > 0 && (
            <div className="text-xs text-red-600 max-h-24 overflow-y-auto space-y-0.5">
              {result.errors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={sending}
        className="btn-primary w-full justify-center py-3 text-base"
      >
        {sending ? (
          <>
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Sending emails…
          </>
        ) : (
          <>
            <Send className="w-5 h-5" /> Send Emails
          </>
        )}
      </button>
    </div>
  )
}
