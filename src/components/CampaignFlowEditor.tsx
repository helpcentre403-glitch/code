'use client'

import { useState } from 'react'
import {
  Mail, MessageSquare, Clock, Plus, Trash2, ChevronUp, ChevronDown,
  GripVertical, ChevronRight, X, Save
} from 'lucide-react'

export type StepType = 'email' | 'sms' | 'wait'

export interface StepConfig {
  // email
  fromName?: string
  fromEmail?: string
  subject?: string
  body?: string
  // sms
  fromId?: string
  message?: string
  // wait
  days?: number
  hours?: number
}

export interface FlowStep {
  id: string
  type: StepType
  stepOrder: number
  config: StepConfig
}

interface Props {
  steps: FlowStep[]
  onChange: (steps: FlowStep[]) => void
}

const STEP_COLORS: Record<StepType, { bg: string; icon: string; border: string; label: string }> = {
  email: { bg: 'bg-blue-50',   icon: 'text-blue-600',   border: 'border-blue-200',  label: 'Send Email' },
  sms:   { bg: 'bg-green-50',  icon: 'text-green-600',  border: 'border-green-200', label: 'Send SMS'   },
  wait:  { bg: 'bg-amber-50',  icon: 'text-amber-600',  border: 'border-amber-200', label: 'Wait'       },
}

const STEP_ICONS: Record<StepType, React.ElementType> = {
  email: Mail,
  sms:   MessageSquare,
  wait:  Clock,
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function StepSummary({ step }: { step: FlowStep }) {
  if (step.type === 'email') {
    return (
      <span className="text-xs text-slate-500 truncate">
        {step.config.subject ? `Subject: ${step.config.subject}` : 'No subject set'}
      </span>
    )
  }
  if (step.type === 'sms') {
    return (
      <span className="text-xs text-slate-500 truncate">
        {step.config.message
          ? step.config.message.slice(0, 60) + (step.config.message.length > 60 ? '…' : '')
          : 'No message set'}
      </span>
    )
  }
  if (step.type === 'wait') {
    const parts = []
    if (step.config.days)  parts.push(`${step.config.days}d`)
    if (step.config.hours) parts.push(`${step.config.hours}h`)
    return <span className="text-xs text-slate-500">{parts.length ? `Delay: ${parts.join(' ')}` : 'No delay set'}</span>
  }
  return null
}

function EmailEditor({ config, onChange }: { config: StepConfig; onChange: (c: StepConfig) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Sender Name</label>
          <input
            className="input"
            value={config.fromName ?? ''}
            onChange={(e) => onChange({ ...config, fromName: e.target.value })}
            placeholder="John Smith"
          />
        </div>
        <div>
          <label className="label">Sender Email</label>
          <input
            className="input"
            type="email"
            value={config.fromEmail ?? ''}
            onChange={(e) => onChange({ ...config, fromEmail: e.target.value })}
            placeholder="john@company.com"
          />
        </div>
      </div>
      <div>
        <label className="label">Subject</label>
        <input
          className="input"
          value={config.subject ?? ''}
          onChange={(e) => onChange({ ...config, subject: e.target.value })}
          placeholder="Your subject line…"
        />
      </div>
      <div>
        <label className="label">Message Body (HTML supported)</label>
        <textarea
          className="input font-mono text-xs resize-y"
          rows={6}
          value={config.body ?? ''}
          onChange={(e) => onChange({ ...config, body: e.target.value })}
          placeholder="<p>Hello {{name}},</p><p>Your message here…</p>"
        />
      </div>
    </div>
  )
}

function SmsEditor({ config, onChange }: { config: StepConfig; onChange: (c: StepConfig) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Sender ID / Phone</label>
        <input
          className="input"
          value={config.fromId ?? ''}
          onChange={(e) => onChange({ ...config, fromId: e.target.value })}
          placeholder="+12025551234 or your Twilio number"
        />
      </div>
      <div>
        <label className="label">Message</label>
        <textarea
          className="input resize-y"
          rows={4}
          value={config.message ?? ''}
          onChange={(e) => onChange({ ...config, message: e.target.value })}
          placeholder="Your SMS message here…"
          maxLength={1600}
        />
        <p className="text-xs text-slate-400 mt-1">{(config.message ?? '').length}/1600 chars</p>
      </div>
    </div>
  )
}

function WaitEditor({ config, onChange }: { config: StepConfig; onChange: (c: StepConfig) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="label">Days</label>
        <input
          className="input"
          type="number"
          min={0}
          value={config.days ?? 0}
          onChange={(e) => onChange({ ...config, days: parseInt(e.target.value) || 0 })}
        />
      </div>
      <div>
        <label className="label">Hours</label>
        <input
          className="input"
          type="number"
          min={0}
          max={23}
          value={config.hours ?? 0}
          onChange={(e) => onChange({ ...config, hours: parseInt(e.target.value) || 0 })}
        />
      </div>
      <p className="col-span-2 text-xs text-slate-400">
        Campaign execution will pause for this duration before the next step.
      </p>
    </div>
  )
}

export default function CampaignFlowEditor({ steps, onChange }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)

  function addStep(type: StepType) {
    const newStep: FlowStep = {
      id: uid(),
      type,
      stepOrder: steps.length + 1,
      config: type === 'wait' ? { days: 1, hours: 0 } : {},
    }
    const updated = [...steps, newStep].map((s, i) => ({ ...s, stepOrder: i + 1 }))
    onChange(updated)
    setExpanded(newStep.id)
    setShowAddMenu(false)
  }

  function removeStep(id: string) {
    const updated = steps.filter((s) => s.id !== id).map((s, i) => ({ ...s, stepOrder: i + 1 }))
    onChange(updated)
    if (expanded === id) setExpanded(null)
  }

  function moveStep(id: string, dir: -1 | 1) {
    const idx = steps.findIndex((s) => s.id === id)
    if (idx + dir < 0 || idx + dir >= steps.length) return
    const updated = [...steps]
    ;[updated[idx], updated[idx + dir]] = [updated[idx + dir], updated[idx]]
    onChange(updated.map((s, i) => ({ ...s, stepOrder: i + 1 })))
  }

  function updateConfig(id: string, config: StepConfig) {
    onChange(steps.map((s) => (s.id === id ? { ...s, config } : s)))
  }

  return (
    <div className="space-y-3">
      {steps.length === 0 && (
        <div className="border-2 border-dashed border-slate-200 rounded-xl p-10 text-center text-slate-400">
          <p className="font-medium text-slate-500">No steps yet</p>
          <p className="text-sm mt-1">Add your first step below to start building your flow</p>
        </div>
      )}

      {steps.map((step, idx) => {
        const colors = STEP_COLORS[step.type]
        const Icon = STEP_ICONS[step.type]
        const isOpen = expanded === step.id

        return (
          <div key={step.id}>
            <div className={`border rounded-xl overflow-hidden transition-all ${colors.border} ${isOpen ? 'shadow-md' : 'hover:shadow-sm'}`}>
              {/* Step header */}
              <div
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none ${colors.bg}`}
                onClick={() => setExpanded(isOpen ? null : step.id)}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-white border ${colors.border}`}>
                  <Icon className={`w-4 h-4 ${colors.icon}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-400">Step {idx + 1}</span>
                    <span className="font-semibold text-slate-800 text-sm">{colors.label}</span>
                  </div>
                  <StepSummary step={step} />
                </div>
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => moveStep(step.id, -1)}
                    disabled={idx === 0}
                    className="p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-white/80 disabled:opacity-30 transition-all"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => moveStep(step.id, 1)}
                    disabled={idx === steps.length - 1}
                    className="p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-white/80 disabled:opacity-30 transition-all"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => removeStep(step.id)}
                    className="p-1.5 rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight
                    className={`w-4 h-4 text-slate-400 transition-transform ml-1 ${isOpen ? 'rotate-90' : ''}`}
                  />
                </div>
              </div>

              {/* Step editor */}
              {isOpen && (
                <div className="px-4 py-4 bg-white border-t border-slate-100">
                  {step.type === 'email' && (
                    <EmailEditor
                      config={step.config}
                      onChange={(c) => updateConfig(step.id, c)}
                    />
                  )}
                  {step.type === 'sms' && (
                    <SmsEditor
                      config={step.config}
                      onChange={(c) => updateConfig(step.id, c)}
                    />
                  )}
                  {step.type === 'wait' && (
                    <WaitEditor
                      config={step.config}
                      onChange={(c) => updateConfig(step.id, c)}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Connector line between steps */}
            {idx < steps.length - 1 && (
              <div className="flex justify-center py-1">
                <div className="w-0.5 h-4 bg-slate-200" />
              </div>
            )}
          </div>
        )
      })}

      {/* Add step button */}
      <div className="relative">
        {steps.length > 0 && (
          <div className="flex justify-center mb-2">
            <div className="w-0.5 h-4 bg-slate-200" />
          </div>
        )}
        <button
          onClick={() => setShowAddMenu((v) => !v)}
          className="w-full border-2 border-dashed border-slate-200 rounded-xl py-3 px-4 text-sm text-slate-400 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 transition-all flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" /> Add Step
        </button>

        {showAddMenu && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-10 overflow-hidden">
            {(Object.entries(STEP_COLORS) as [StepType, typeof STEP_COLORS[StepType]][]).map(([type, colors]) => {
              const Icon = STEP_ICONS[type]
              return (
                <button
                  key={type}
                  onClick={() => addStep(type)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left transition-colors"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors.bg} border ${colors.border}`}>
                    <Icon className={`w-4 h-4 ${colors.icon}`} />
                  </div>
                  <div>
                    <p className="font-medium text-slate-800 text-sm">{colors.label}</p>
                    <p className="text-xs text-slate-400">
                      {type === 'email' ? 'Send an email to contacts'
                        : type === 'sms' ? 'Send an SMS to contacts'
                        : 'Pause flow execution for a duration'}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
