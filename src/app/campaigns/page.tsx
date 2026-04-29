'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, Megaphone, Play, Pencil, Trash2, Clock, CheckCircle, AlertCircle } from 'lucide-react'

type Campaign = {
  id: string
  name: string
  description: string
  status: string
  createdAt: string
  updatedAt: string
  _count: { steps: number; runs: number }
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    draft:    'badge-gray',
    active:   'badge-blue',
    archived: 'badge-yellow',
  }
  return map[s] ?? 'badge-gray'
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [runModal, setRunModal] = useState<Campaign | null>(null)
  const [contactType, setContactType] = useState<'email' | 'phone'>('email')
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<string>('')

  useEffect(() => {
    fetch('/api/campaigns')
      .then((r) => r.json())
      .then((d) => setCampaigns(d.campaigns ?? []))
      .finally(() => setLoading(false))
  }, [])

  async function deleteCampaign(id: string) {
    if (!confirm('Delete this campaign and all its data?')) return
    await fetch(`/api/campaigns/${id}`, { method: 'DELETE' })
    setCampaigns((prev) => prev.filter((c) => c.id !== id))
  }

  async function runCampaign() {
    if (!runModal) return
    setRunning(true)
    setRunResult('')
    try {
      const r = await fetch(`/api/campaigns/${runModal.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactType }),
      })
      const d = await r.json()
      setRunResult(`Run complete: ${d.sent} sent, ${d.failed} failed.`)
    } catch {
      setRunResult('Execution failed. Check settings and try again.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Campaigns</h1>
          <p className="text-slate-500 mt-1">Build and manage automation flows</p>
        </div>
        <Link href="/campaigns/new" className="btn-primary">
          <Plus className="w-4 h-4" /> New Campaign
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="card py-16 text-center text-slate-400">
          <Megaphone className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-slate-500">No campaigns yet</p>
          <p className="text-sm mt-1">Create your first automation flow to get started</p>
          <Link href="/campaigns/new" className="btn-primary mt-4 inline-flex">
            <Plus className="w-4 h-4" /> Create Campaign
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {campaigns.map((c) => (
            <div key={c.id} className="card p-5 flex items-start gap-4 hover:shadow-md transition-shadow">
              <div className="w-10 h-10 bg-violet-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <Megaphone className="w-5 h-5 text-violet-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-slate-900">{c.name}</h3>
                  <span className={`badge ${statusBadge(c.status)}`}>{c.status}</span>
                </div>
                {c.description && (
                  <p className="text-sm text-slate-500 mt-0.5 truncate">{c.description}</p>
                )}
                <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                  <span>{c._count.steps} steps</span>
                  <span>{c._count.runs} runs</span>
                  <span>Updated {new Date(c.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => { setRunModal(c); setRunResult('') }}
                  className="btn-secondary py-1.5 px-3 text-xs"
                >
                  <Play className="w-3.5 h-3.5" /> Run
                </button>
                <Link href={`/campaigns/${c.id}`} className="btn-secondary py-1.5 px-3 text-xs">
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </Link>
                <button
                  onClick={() => deleteCampaign(c.id)}
                  className="btn-ghost py-1.5 px-2 text-red-400 hover:text-red-600 hover:bg-red-50 text-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Run Modal */}
      {runModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Run Campaign</h2>
            <p className="text-sm text-slate-500">
              Execute <strong>{runModal.name}</strong> against your contact list.
            </p>
            <div>
              <label className="label">Contact type to use</label>
              <select
                value={contactType}
                onChange={(e) => setContactType(e.target.value as 'email' | 'phone')}
                className="input"
              >
                <option value="email">Email contacts</option>
                <option value="phone">Phone contacts</option>
              </select>
            </div>

            {runResult && (
              <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                runResult.includes('failed') && !runResult.startsWith('Run complete')
                  ? 'bg-red-50 text-red-700'
                  : 'bg-emerald-50 text-emerald-700'
              }`}>
                {runResult.startsWith('Run complete') ? (
                  <CheckCircle className="w-4 h-4" />
                ) : (
                  <AlertCircle className="w-4 h-4" />
                )}
                {runResult}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setRunModal(null); setRunResult('') }}
                className="btn-secondary flex-1"
              >
                Close
              </button>
              {!runResult && (
                <button
                  onClick={runCampaign}
                  disabled={running}
                  className="btn-primary flex-1"
                >
                  {running ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Running…
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" /> Run Now
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
