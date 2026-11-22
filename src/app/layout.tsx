import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'

export const metadata: Metadata = {
  title: 'Campaign Manager',
  description: 'Bulk email & SMS campaign management with automation flows',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-slate-50 print:overflow-visible print:bg-white">
          <div className="max-w-7xl mx-auto p-6 print:p-0">{children}</div>
        </main>
      </body>
    </html>
  )
}
