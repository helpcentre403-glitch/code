'use client'

import { useState, useEffect } from 'react'
import { Settings, Mail, MessageSquare, Film, Save, CheckCircle, Eye, EyeOff, AlertCircle } from 'lucide-react'

const FIELDS = {
  smtp: [
    { key: 'SMTP_HOST',   label: 'SMTP Host',     placeholder: 'smtp.gmail.com',  type: 'text',     help: 'e.g. smtp.gmail.com, smtp.sendgrid.net' },
    { key: 'SMTP_PORT',   label: 'SMTP Port',     placeholder: '587',             type: 'number',   help: '587 (TLS) or 465 (SSL) or 25' },
    { key: 'SMTP_SECURE', label: 'Use SSL',       placeholder: 'false',           type: 'text',     help: 'true for port 465, false for 587' },
    { key: 'SMTP_USER',   label: 'SMTP Username', placeholder: 'you@domain.com',  type: 'text',     help: 'Your SMTP login username' },
    { key: 'SMTP_PASS',   label: 'SMTP Password', placeholder: '••••••••',        type: 'password', help: 'Your SMTP password or app password' },
  ],
  twilio: [
    { key: 'TWILIO_ACCOUNT_SID',  label: 'Account SID',    placeholder: 'ACxxxxxxxxxxxxxxxx', type: 'text',     help: 'Find in your Twilio console dashboard' },
    { key: 'TWILIO_AUTH_TOKEN',   label: 'Auth Token',     placeholder: '••••••••',           type: 'password', help: 'Find in your Twilio console dashboard' },
    { key: 'TWILIO_PHONE_NUMBER', label: 'Default Number', placeholder: '+12025551234',       type: 'text',     help: 'Your Twilio phone number (E.164 format)' },
  ],
  ai: [
    { key: 'ELEVENLABS_API_KEY',   label: 'ElevenLabs API Key',  placeholder: '••••••••',  type: 'password', help: 'elevenlabs.io → Developers → API Keys. Needs Speech-to-Text access.' },
    { key: 'ELEVENLABS_STT_MODEL', label: 'ElevenLabs STT Model', placeholder: 'scribe_v1', type: 'text',     help: 'Speech-to-text model id. Leave blank for scribe_v1.' },
    { key: 'ANTHROPIC_API_KEY',    label: 'Anthropic API Key',   placeholder: 'sk-ant-…',  type: 'password', help: 'console.anthropic.com → API Keys. Used for the analysis and script writing.' },
  ],
}

function PasswordField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        className="input pr-10"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => setValues(d.settings ?? {}))
      .finally(() => setLoading(false))
  }, [])

  function set(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  async function save() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: values }),
      })
      if (!res.ok) throw new Error('Failed to save settings')
      setSaved(true)
      setTimeout(() => setSaved(false), 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500 mt-1">Configure email (SMTP), SMS (Twilio) and Ad Analyzer credentials</p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-2 text-sm text-amber-800">
        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p>Settings are stored in the app database. For production, prefer environment variables in <code className="bg-amber-100 px-1 rounded">.env</code>.</p>
      </div>

      {saved && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
          <CheckCircle className="w-4 h-4" /> Settings saved successfully.
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {/* SMTP */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
          <Mail className="w-4 h-4 text-blue-500" /> Email / SMTP Configuration
        </h2>
        <p className="text-xs text-slate-500">
          Works with Gmail, SendGrid SMTP, Mailgun, or any SMTP server. For Gmail, use an App Password.
        </p>
        <div className="space-y-3">
          {FIELDS.smtp.map((f) => (
            <div key={f.key}>
              <label className="label">{f.label}</label>
              {f.type === 'password' ? (
                <PasswordField
                  value={values[f.key] ?? ''}
                  onChange={(v) => set(f.key, v)}
                  placeholder={f.placeholder}
                />
              ) : (
                <input
                  type={f.type}
                  className="input"
                  value={values[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                />
              )}
              {f.help && <p className="text-xs text-slate-400 mt-1">{f.help}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Twilio */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-green-500" /> Twilio SMS Configuration
        </h2>
        <p className="text-xs text-slate-500">
          Sign up at <strong>twilio.com</strong> to get a free trial with SMS sending capabilities.
        </p>
        <div className="space-y-3">
          {FIELDS.twilio.map((f) => (
            <div key={f.key}>
              <label className="label">{f.label}</label>
              {f.type === 'password' ? (
                <PasswordField
                  value={values[f.key] ?? ''}
                  onChange={(v) => set(f.key, v)}
                  placeholder={f.placeholder}
                />
              ) : (
                <input
                  type={f.type}
                  className="input"
                  value={values[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                />
              )}
              {f.help && <p className="text-xs text-slate-400 mt-1">{f.help}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Ad Analyzer */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
          <Film className="w-4 h-4 text-purple-500" /> Ad Analyzer (ElevenLabs + Claude)
        </h2>
        <p className="text-xs text-slate-500">
          ElevenLabs transcribes the video; Claude analyzes it and writes your script. Usage is billed to these accounts.
        </p>
        <div className="space-y-3">
          {FIELDS.ai.map((f) => (
            <div key={f.key}>
              <label className="label">{f.label}</label>
              {f.type === 'password' ? (
                <PasswordField
                  value={values[f.key] ?? ''}
                  onChange={(v) => set(f.key, v)}
                  placeholder={f.placeholder}
                />
              ) : (
                <input
                  type={f.type}
                  className="input"
                  value={values[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                />
              )}
              {f.help && <p className="text-xs text-slate-400 mt-1">{f.help}</p>}
            </div>
          ))}
        </div>
      </div>

      <button onClick={save} disabled={saving} className="btn-primary w-full justify-center py-3">
        {saving ? (
          <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
        ) : (
          <><Save className="w-4 h-4" /> Save Settings</>
        )}
      </button>
    </div>
  )
}
