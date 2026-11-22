'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Megaphone,
  Mail,
  MessageSquare,
  Users,
  Settings,
  Zap,
  Film,
} from 'lucide-react'

const nav = [
  { href: '/',          label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/campaigns', label: 'Campaigns',    icon: Megaphone },
  { href: '/email',     label: 'Email Sender', icon: Mail },
  { href: '/sms',       label: 'SMS Sender',   icon: MessageSquare },
  { href: '/ad-analyzer', label: 'Ad Analyzer', icon: Film },
  { href: '/contacts',  label: 'Contacts',     icon: Users },
  { href: '/settings',  label: 'Settings',     icon: Settings },
]

export default function Sidebar() {
  const path = usePathname()

  return (
    <aside className="print:hidden w-60 bg-slate-900 flex flex-col h-screen flex-shrink-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-700/50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-tight">CampaignHub</p>
            <p className="text-slate-400 text-xs">Bulk messaging platform</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon }) => {
          const isActive = href === '/' ? path === '/' : path.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-700/50">
        <p className="text-slate-500 text-xs">v1.0.0 &mdash; Campaign Manager</p>
      </div>
    </aside>
  )
}
