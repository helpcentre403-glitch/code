'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Film, Upload, Sparkles, Copy, Check, Trash2, AlertCircle, FileText, Search, PenLine, Clock,
} from 'lucide-react'
import type { AdAnalysisResult, TranscriptSegment, TranscriptStats } from '@/lib/adAnalyzer'

interface HistoryRow { id: string; fileName: string; competitor: string; productName: string; createdAt: string }
interface FullAnalysis {
  id: string
  fileName: string
  competitor: string
  productName: string
  transcript: string
  segments: TranscriptSegment[]
  stats: TranscriptStats
  analysis: AdAnalysisResult
  createdAt: string
}

const TABS = [
  { id: 'script', label: 'Competitor Script', icon: FileText },
  { id: 'breakdown', label: 'Breakdown', icon: Search },
  { id: 'mine', label: 'Your Script', icon: PenLine },
] as const
type Tab = (typeof TABS)[number]['id']

function fmt(sec: number) {
  return `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, '0')}`
}

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="btn-secondary !py-1 !px-2.5 text-xs"
      onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}
    >
      {done ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {done ? 'Copied' : label}
    </button>
  )
}

function ScorePill({ score }: { score: number }) {
  const cls = score >= 8 ? 'badge-green' : score >= 5 ? 'badge-yellow' : 'badge-red'
  return <span className={cls}>{score}/10</span>
}

function List({ items }: { items: string[] }) {
  if (!items?.length) return <p className="text-sm text-slate-400">None</p>
  return <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
}

function Section({ title, score, children }: { title: string; score?: number; children: React.ReactNode }) {
  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">{title}</h3>
        {score !== undefined && <ScorePill score={score} />}
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">{label}</p>
      <div className="text-sm text-slate-700">{children}</div>
    </div>
  )
}

export default function AdAnalyzerPage() {
  const [file, setFile] = useState<File | null>(null)
  const [competitor, setCompetitor] = useState('')
  const [productName, setProductName] = useState('')
  const [productDescription, setProductDescription] = useState('')
  const [extraNotes, setExtraNotes] = useState('')
  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState('')
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [current, setCurrent] = useState<FullAnalysis | null>(null)
  const [tab, setTab] = useState<Tab>('script')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Remember product details between runs (per browser)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('adAnalyzer.product') || '{}')
      if (saved.productName) setProductName(saved.productName)
      if (saved.productDescription) setProductDescription(saved.productDescription)
    } catch {}
    loadHistory()
  }, [])

  async function loadHistory() {
    const r = await fetch('/api/ad-analyzer').then((r) => r.json()).catch(() => ({ analyses: [] }))
    setHistory(r.analyses ?? [])
  }

  async function open(id: string) {
    const r = await fetch(`/api/ad-analyzer/${id}`).then((r) => r.json())
    if (r.analysis) { setCurrent(r.analysis); setTab('script') }
  }

  async function remove(id: string) {
    if (!confirm('Delete this analysis?')) return
    await fetch(`/api/ad-analyzer/${id}`, { method: 'DELETE' })
    if (current?.id === id) setCurrent(null)
    loadHistory()
  }

  async function run() {
    if (!file) return
    setRunning(true)
    setError('')
    setStage('Uploading & transcribing with ElevenLabs…')
    try { localStorage.setItem('adAnalyzer.product', JSON.stringify({ productName, productDescription })) } catch {}

    // The server does both steps in one request; switch the label after a bit for feedback.
    const t = setTimeout(() => setStage('Analyzing hook, body & CTA and writing your script with Claude…'), 15000)
    try {
      const fd = new FormData()
      fd.append('video', file)
      fd.append('competitor', competitor)
      fd.append('productName', productName)
      fd.append('productDescription', productDescription)
      fd.append('extraNotes', extraNotes)
      const res = await fetch('/api/ad-analyzer', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }))
      if (!res.ok) throw new Error(data.error || 'Analysis failed')
      await open(data.id)
      loadHistory()
      setFile(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      clearTimeout(t)
      setRunning(false)
      setStage('')
    }
  }

  const a = current?.analysis

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Film className="w-6 h-6 text-blue-600" /> Ad Analyzer</h1>
        <p className="text-slate-500 mt-1">Upload a competitor video ad → get the script, a breakdown, and a new script for your product.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ---------------- Left: input + history ---------------- */}
        <div className="space-y-6">
          <div className="card p-5 space-y-4">
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f) }}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-blue-400'}`}
            >
              <Upload className="w-6 h-6 mx-auto text-slate-400" />
              <p className="text-sm text-slate-600 mt-2">{file ? <strong>{file.name}</strong> : 'Drop an MP4 here or click to choose'}</p>
              {file && <p className="text-xs text-slate-400 mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB</p>}
              <input ref={inputRef} type="file" accept="video/*,audio/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>

            <div>
              <label className="label">Competitor (optional)</label>
              <input className="input" value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder="Brand name" />
            </div>
            <div>
              <label className="label">Your product name</label>
              <input className="input" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Leave blank for a template script" />
            </div>
            <div>
              <label className="label">Your product description</label>
              <textarea className="input min-h-[90px]" value={productDescription} onChange={(e) => setProductDescription(e.target.value)} placeholder="What it is, key benefits, price/offer, who it's for. Only real facts — the script won't invent claims." />
            </div>
            <div>
              <label className="label">Extra instructions (optional)</label>
              <textarea className="input min-h-[60px]" value={extraNotes} onChange={(e) => setExtraNotes(e.target.value)} placeholder="e.g. make it 20s, female voice, mention free shipping" />
            </div>

            <button onClick={run} disabled={!file || running} className="btn-primary w-full justify-center py-3">
              {running
                ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Working…</>
                : <><Sparkles className="w-4 h-4" /> Analyze ad</>}
            </button>
            {running && <p className="text-xs text-slate-500 text-center">{stage} This usually takes 1–3 minutes.</p>}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
              </div>
            )}
          </div>

          <div className="card p-5">
            <h2 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><Clock className="w-4 h-4 text-slate-400" /> History</h2>
            {history.length === 0 && <p className="text-sm text-slate-400">No analyses yet.</p>}
            <ul className="space-y-1">
              {history.map((h) => (
                <li key={h.id} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm ${current?.id === h.id ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                  <button className="text-left flex-1 min-w-0" onClick={() => open(h.id)}>
                    <p className="truncate font-medium text-slate-700">{h.competitor || h.fileName}</p>
                    <p className="text-xs text-slate-400 truncate">{new Date(h.createdAt).toLocaleString()} {h.productName && `· for ${h.productName}`}</p>
                  </button>
                  <button onClick={() => remove(h.id)} className="text-slate-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ---------------- Right: results ---------------- */}
        <div className="lg:col-span-2 space-y-4">
          {!current && (
            <div className="card p-10 text-center text-slate-400">
              <Film className="w-10 h-10 mx-auto mb-3" />
              Upload a video to see results here.
            </div>
          )}

          {current && a && (
            <>
              <div className="card p-5">
                <div className="flex flex-wrap gap-2 mb-3">
                  <span className="badge-blue">{a.overview.adFormat}</span>
                  <span className="badge-gray">{a.overview.awarenessLevel}</span>
                  <span className="badge-gray">{current.stats.wordCount} words</span>
                  <span className="badge-gray">{current.stats.speechSeconds}s speech</span>
                  <span className="badge-gray" title={`${current.stats.wordCount} words ÷ ${current.stats.speechSeconds}s × 60`}>{current.stats.wordsPerMinute} wpm</span>
                </div>
                <p className="text-slate-800 font-medium">{a.overview.oneLineVerdict}</p>
                <div className="grid sm:grid-cols-3 gap-4 mt-4">
                  <Field label="Product">{a.overview.productAdvertised}</Field>
                  <Field label="Angle">{a.overview.coreAngle}</Field>
                  <Field label="Audience">{a.overview.targetAudience}</Field>
                </div>
              </div>

              <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-1 w-fit">
                {TABS.map(({ id, label, icon: Icon }) => (
                  <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${tab === id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                    <Icon className="w-4 h-4" /> {label}
                  </button>
                ))}
              </div>

              {tab === 'script' && (
                <div className="space-y-4">
                  <div className="card p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-slate-800">Script, labeled by section</h3>
                      <CopyBtn text={current.transcript} label="Copy raw transcript" />
                    </div>
                    <table className="w-full text-sm">
                      <tbody>
                        {a.labeledScript.map((l, i) => (
                          <tr key={i} className="border-t border-slate-100 align-top">
                            <td className="py-2 pr-3 text-slate-400 font-mono text-xs whitespace-nowrap">{l.timestamp}</td>
                            <td className="py-2 pr-3"><span className="badge-gray whitespace-nowrap">{l.section}</span></td>
                            <td className="py-2 text-slate-700">{l.line}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <details className="card p-5">
                    <summary className="cursor-pointer font-semibold text-slate-800">Raw transcript with timestamps (ElevenLabs)</summary>
                    <div className="mt-3 space-y-1 text-sm">
                      {current.segments.map((s, i) => (
                        <p key={i}><span className="font-mono text-xs text-slate-400 mr-2">{fmt(s.start)}</span>{s.text}</p>
                      ))}
                    </div>
                  </details>
                </div>
              )}

              {tab === 'breakdown' && (
                <div className="space-y-4">
                  <Section title="Hook" score={a.hook.score}>
                    <blockquote className="border-l-4 border-blue-500 pl-3 text-slate-800 italic">“{a.hook.text}”</blockquote>
                    <Field label="Type">{a.hook.hookType}</Field>
                    <Field label="Why it works">{a.hook.whyItWorks}</Field>
                    <Field label="Weaknesses">{a.hook.weaknesses}</Field>
                  </Section>
                  <Section title="Body" score={a.body.score}>
                    <Field label="Structure"><ol className="list-decimal pl-5 space-y-1">{a.body.structure.map((s, i) => <li key={i}>{s}</li>)}</ol></Field>
                    <Field label="Persuasion techniques"><List items={a.body.persuasionTechniques} /></Field>
                    <Field label="Objections handled"><List items={a.body.objectionsHandled} /></Field>
                    <Field label="Why it works">{a.body.whyItWorks}</Field>
                    <Field label="Weaknesses">{a.body.weaknesses}</Field>
                  </Section>
                  <Section title="Call to action" score={a.cta.score}>
                    <blockquote className="border-l-4 border-blue-500 pl-3 text-slate-800 italic">“{a.cta.text}”</blockquote>
                    <Field label="Offer / urgency">{a.cta.offerOrUrgency}</Field>
                    <Field label="Assessment">{a.cta.assessment}</Field>
                  </Section>
                  <Section title="Formatting & delivery">
                    <Field label="Pacing">{a.formatting.pacing}</Field>
                    <Field label="Sentence style">{a.formatting.sentenceStyle}</Field>
                    <Field label="Tone">{a.formatting.toneOfVoice}</Field>
                    <Field label="Notes"><List items={a.formatting.notes} /></Field>
                  </Section>
                  <Section title="What to steal"><List items={a.keyTakeaways} /></Section>
                  <p className="text-xs text-slate-400">Scores are Claude’s judgment from the transcript only — no visuals or performance data (spend, CTR, ROAS) were available.</p>
                </div>
              )}

              {tab === 'mine' && (
                <div className="space-y-4">
                  <div className="card p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-800">{a.newScript.title}</h3>
                        <p className="text-sm text-slate-500">{a.newScript.angle} · ~{a.newScript.estimatedLengthSeconds}s</p>
                      </div>
                      <CopyBtn text={a.newScript.fullVoiceover} label="Copy voiceover" />
                    </div>
                    <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-800 whitespace-pre-wrap">{a.newScript.fullVoiceover}</div>
                    <Field label="Why this should work">{a.newScript.whyThisShouldWork}</Field>
                  </div>
                  <div className="card p-5">
                    <h3 className="font-semibold text-slate-800 mb-3">Shot list</h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase text-slate-400">
                          <th className="pb-2 pr-3">Section</th><th className="pb-2 pr-3">Voiceover</th><th className="pb-2 pr-3">Visual</th><th className="pb-2">On-screen text</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.newScript.lines.map((l, i) => (
                          <tr key={i} className="border-t border-slate-100 align-top">
                            <td className="py-2 pr-3"><span className="badge-gray">{l.section}</span></td>
                            <td className="py-2 pr-3 text-slate-800">{l.voiceover}</td>
                            <td className="py-2 pr-3 text-slate-500">{l.visual}</td>
                            <td className="py-2 text-slate-500">{l.onScreenText}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Section title="Alternative hooks to test">
                    <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-700">
                      {a.alternativeHooks.map((h, i) => <li key={i}><div className="flex justify-between gap-2"><span>{h}</span><CopyBtn text={h} /></div></li>)}
                    </ol>
                  </Section>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
