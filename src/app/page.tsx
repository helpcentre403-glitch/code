'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Mail, MessageSquare, Users, Megaphone, ArrowRight, TrendingUp, CheckCircle, XCircle } from 'lucide-react'

interface Stats {
  totalContacts: number
  emailContacts: number
  phoneContacts: number
  totalCampaigns: number
  activeCampaigns: number
  emailsSent: number
  emailsFailed: number
  smsSent: number
  smsFailed: number
  recentRuns: Array<{
    id: string
    campaignName: string
    status: string
    totalSent: number
    totalFailed: number
    startedAt: string
  }>
}

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  color,
}: {
  title: string
  value: number | string
  sub?: string
  icon: React.ElementType
  color: string
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 font-medium">{title}</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{typeof value === 'number' ? value.toLocaleString() : value}</p>
          {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const s = stats || {
    totalContacts: 0, emailContacts: 0, phoneContacts: 0,
    totalCampaigns: 0, activeCampaigns: 0,
    emailsSent: 0, emailsFailed: 0, smsSent: 0, smsFailed: 0,
    recentRuns: [],
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1">Overview of your campaign activity</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Contacts" value={s.totalContacts} sub={`${s.emailContacts} email · ${s.phoneContacts} phone`} icon={Users} color="bg-blue-500" />
        <StatCard title="Campaigns" value={s.totalCampaigns} sub={`${s.activeCampaigns} active`} icon={Megaphone} color="bg-violet-500" />
        <StatCard title="Emails Sent" value={s.emailsSent} sub={`${s.emailsFailed} failed`} icon={Mail} color="bg-emerald-500" />
        <StatCard title="SMS Sent" value={s.smsSent} sub={`${s.smsFailed} failed`} icon={MessageSquare} color="bg-orange-500" />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { href: '/campaigns/new', label: 'New Campaign', desc: 'Build an automation flow', icon: Megaphone, color: 'text-violet-600 bg-violet-50' },
          { href: '/contacts',      label: 'Add Contacts',  desc: 'Paste bulk emails or phones', icon: Users,     color: 'text-blue-600 bg-blue-50' },
          { href: '/email',         label: 'Send Email',    desc: 'Blast to your contact list',  icon: Mail,      color: 'text-emerald-600 bg-emerald-50' },
        ].map(({ href, label, desc, icon: Icon, color }) => (
          <Link key={href} href={href} className="card p-5 flex items-center gap-4 hover:shadow-md transition-shadow group">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900">{label}</p>
              <p className="text-xs text-slate-500 truncate">{desc}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 group-hover:translate-x-0.5 transition-all" />
          </Link>
        ))}
      </div>

      {/* Recent runs */}
      <div className="card">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Recent Campaign Runs</h2>
          <Link href="/campaigns" className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1">
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {s.recentRuns.length === 0 ? (
          <div className="px-5 py-12 text-center text-slate-400">
            <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No campaign runs yet</p>
            <Link href="/campaigns/new" className="text-blue-600 hover:underline text-sm mt-1 inline-block">Create your first campaign</Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {s.recentRuns.map((run) => (
              <div key={run.id} className="px-5 py-3.5 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 text-sm truncate">{run.campaignName}</p>
                  <p className="text-xs text-slate-400">{new Date(run.startedAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="flex items-center gap-1 text-emerald-600">
                    <CheckCircle className="w-3.5 h-3.5" /> {run.totalSent}
                  </span>
                  <span className="flex items-center gap-1 text-red-500">
                    <XCircle className="w-3.5 h-3.5" /> {run.totalFailed}
                  </span>
                </div>
                <span className={`badge ${run.status === 'completed' ? 'badge-green' : run.status === 'running' ? 'badge-blue' : 'badge-gray'}`}>
                  {run.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
