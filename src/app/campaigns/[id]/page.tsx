'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Save, ArrowLeft, Play, Trash2, CheckCircle, XCircle } from 'lucide-react'
import Link from 'next/link'
import CampaignFlowEditor, { FlowStep } from '@/components/CampaignFlowEditor'

type CampaignRun = {
  id: string; status: string; totalSent: number; totalFailed: number; startedAt: string; completedAt?: string
}

export default function CampaignEditorPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState<FlowStep[]>([])
  const [runs, setRuns] = useState<CampaignRun[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [runModal, setRunModal] = useState(false)
  const [contactType, setContactType] = useState<'email' | 'phone'>('email')
  const [running, setRunning] = useState(false)
  const [runMsg, setRunMsg] = useState('')

  useEffect(() => {
    fetch(`/api/campaigns/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setName(d.campaign.name)
        setDescription(d.campaign.description ?? '')
        setSteps(
          (d.campaign.steps ?? []).map((s: { id: string; type: string; stepOrder: number; config: string }) => ({
            id: s.id,
            type: s.type as FlowStep['type'],
            stepOrder: s.stepOrder,
            config: (() => { try { return JSON.parse(s.config) } catch { return {} } })(),
          }))
        )
        setRuns(d.campaign.runs ?? [])
      })
      .catch(() => setError('Campaign not found.'))
      .finally(() => setLoading(false))
  }, [id])

  async function save() {
    if (!name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError(''); setSaved(false)
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description, steps }),
      })
      if (!res.ok) throw new Error(await res.text())
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  async function runCampaign() {
    setRunning(true); setRunMsg('')
    try {
      const r = await fetch(`/api/campaigns/${id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactType }),
      })
      const d = await r.json()
      setRunMsg(`Done: ${d.sent} sent, ${d.failed} failed.`)
      // refresh runs
      const cr = await fetch(`/api/campaigns/${id}`)
      const cd = await cr.json()
      setRuns(cd.campaign.runs ?? [])
    } catch {
      setRunMsg('Execution failed. Check settings.')
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/campaigns" className="btn-ghost p-2">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900">Edit Campaign</h1>
          <p className="text-slate-500 mt-0.5">Modify steps and settings</p>
        </div>
        <button onClick={() => setRunModal(true)} className="btn-secondary">
          <Play className="w-4 h-4" /> Run
        </button>
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</> : <><Save className="w-4 h-4" /> Save</>}
        </button>
      </div>

      {saved && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-3 text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4" />Campaign saved successfully.</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 text-sm">{error}</div>}

      <div className="card p-5 space-y-4">
        <div>
          <label className="label">Campaign Name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input resize-none" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-slate-800 mb-3">Flow Steps</h2>
        <CampaignFlowEditor steps={steps} onChange={setSteps} />
      </div>

      {/* Run history */}
      {runs.length > 0 && (
        <div className="card">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Run History</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {runs.map((run) => (
              <div key={run.id} className="px-5 py-3 flex items-center gap-4">
                <div className="flex-1">
                  <p className="text-xs text-slate-400">{new Date(run.startedAt).toLocaleString()}</p>
                </div>
                <span className="flex items-center gap-1 text-sm text-emerald-600"><CheckCircle className="w-3.5 h-3.5" />{run.totalSent}</span>
                <span className="flex items-center gap-1 text-sm text-red-500"><XCircle className="w-3.5 h-3.5" />{run.totalFailed}</span>
                <span className={`badge ${run.status === 'completed' ? 'badge-green' : 'badge-blue'}`}>{run.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Run Modal */}
      {runModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold">Run Campaign</h2>
            <p className="text-sm text-slate-500">This will process all steps and send messages to your contacts.</p>
            <div>
              <label className="label">Contact type</label>
              <select value={contactType} onChange={(e) => setContactType(e.target.value as 'email' | 'phone')} className="input">
                <option value="email">Email contacts</option>
                <option value="phone">Phone contacts</option>
              </select>
            </div>
            {runMsg && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg p-3 text-sm">{runMsg}</div>
            )}
            <div className="flex gap-3">
              <button onClick={() => { setRunModal(false); setRunMsg('') }} className="btn-secondary flex-1">Close</button>
              {!runMsg && (
                <button onClick={runCampaign} disabled={running} className="btn-primary flex-1">
                  {running ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Running…</> : <><Play className="w-4 h-4" /> Run Now</>}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
