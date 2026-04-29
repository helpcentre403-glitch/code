'use client'

import { useState, useEffect } from 'react'
import { MessageSquare, Send, Users, CheckCircle, AlertCircle, Info } from 'lucide-react'

export default function SmsSenderPage() {
  const [fromId, setFromId] = useState('')
  const [message, setMessage] = useState('')
  const [recipientMode, setRecipientMode] = useState<'all' | 'custom'>('all')
  const [customTo, setCustomTo] = useState('')
  const [contactCount, setContactCount] = useState(0)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number; errors?: string[] } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/contacts?type=phones&limit=1')
      .then((r) => r.json())
      .then((d) => setContactCount(d.total ?? 0))
      .catch(() => {})
  }, [])

  async function handleSend() {
    if (!message.trim()) { setError('Message is required.'); return }
    setSending(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromId, message, recipientMode, customTo }),
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
        <h1 className="text-2xl font-bold text-slate-900">SMS Sender</h1>
        <p className="text-slate-500 mt-1">Send bulk SMS messages to your phone contact list</p>
      </div>

      <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-start gap-3 text-sm text-green-800">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p>SMS messages are sent via Twilio. Configure your Twilio credentials in <strong>Settings</strong> before sending.</p>
      </div>

      <div className="card p-5 space-y-5">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-green-500" /> Message Details
        </h2>
        <div>
          <label className="label">Sender Phone / ID</label>
          <input
            className="input"
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
            placeholder="+12025551234 (leave blank to use Twilio default)"
          />
          <p className="text-xs text-slate-400 mt-1">Use your Twilio number or leave blank to use the default from Settings.</p>
        </div>
        <div>
          <label className="label">Message *</label>
          <textarea
            className="input resize-y"
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Your SMS message here…"
            maxLength={1600}
          />
          <p className="text-xs text-slate-400 mt-1">{message.length}/1600 chars · ~{Math.ceil(message.length / 160)} SMS segment(s)</p>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
          <Users className="w-4 h-4 text-violet-500" /> Recipients
        </h2>
        <div className="flex gap-3">
          {[
            { v: 'all',    label: `All phone contacts (${contactCount})` },
            { v: 'custom', label: 'Custom list' },
          ].map(({ v, label }) => (
            <label key={v} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="mode" value={v} checked={recipientMode === v} onChange={() => setRecipientMode(v as 'all' | 'custom')} className="accent-green-600" />
              <span className="text-sm text-slate-700">{label}</span>
            </label>
          ))}
        </div>
        {recipientMode === 'custom' && (
          <div>
            <label className="label">Phone numbers (comma or line separated)</label>
            <textarea
              className="input font-mono text-xs resize-y"
              rows={4}
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              placeholder="+1234567890&#10;+44 20 7946 0958"
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
          <p className="text-sm text-emerald-700">✓ {result.sent} sent · ✗ {result.failed} failed</p>
          {result.errors && result.errors.length > 0 && (
            <div className="text-xs text-red-600 max-h-24 overflow-y-auto space-y-0.5">
              {result.errors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}
        </div>
      )}

      <button onClick={handleSend} disabled={sending} className="btn-primary w-full justify-center py-3 text-base" style={{ background: '#16a34a' }}
        onMouseEnter={(e) => { if (!sending) (e.currentTarget as HTMLButtonElement).style.background = '#15803d' }}
        onMouseLeave={(e) => { if (!sending) (e.currentTarget as HTMLButtonElement).style.background = '#16a34a' }}
      >
        {sending ? (
          <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Sending SMS…</>
        ) : (
          <><Send className="w-5 h-5" /> Send SMS</>
        )}
      </button>
    </div>
  )
}
