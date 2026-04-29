'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Save, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import CampaignFlowEditor, { FlowStep } from '@/components/CampaignFlowEditor'

export default function NewCampaignPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState<FlowStep[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!name.trim()) { setError('Campaign name is required.'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description, steps }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      router.push(`/campaigns/${data.campaign.id}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/campaigns" className="btn-ghost p-2">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">New Campaign</h1>
          <p className="text-slate-500 mt-0.5">Build your automation flow step by step</p>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <label className="label">Campaign Name *</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Welcome Series, Black Friday Blast…"
          />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea
            className="input resize-none"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description…"
          />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-slate-800 mb-3">Flow Steps</h2>
        <CampaignFlowEditor steps={steps} onChange={setSteps} />
      </div>

      {error && (
        <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <Link href="/campaigns" className="btn-secondary">
          Cancel
        </Link>
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="w-4 h-4" /> Save Campaign
            </>
          )}
        </button>
      </div>
    </div>
  )
}
