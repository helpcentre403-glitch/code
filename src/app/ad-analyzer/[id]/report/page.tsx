'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, FileDown, Printer } from 'lucide-react'
import { buildReport, downloadMarkdown, reportFileName, reportTitle, type Block, type ReportInput } from '@/lib/adReport'

function RenderBlock({ b }: { b: Block }) {
  switch (b.kind) {
    case 'p':
      return <p className="text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">{b.text}</p>
    case 'quote':
      return <blockquote className="border-l-4 border-blue-500 pl-3 italic text-slate-800">“{b.text}”</blockquote>
    case 'pre':
      return <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs whitespace-pre-wrap font-mono text-slate-800">{b.text}</pre>
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul'
      return <Tag className={`${b.ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-1 text-sm text-slate-800`}>{b.items.map((x, i) => <li key={i}>{x}</li>)}</Tag>
    }
    case 'kv':
      return (
        <dl className="text-sm space-y-1.5">
          {b.rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[170px_1fr] gap-3">
              <dt className="font-semibold text-slate-500">{k}</dt>
              <dd className="text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>
      )
    case 'table':
      return (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>{b.head.map((h) => <th key={h} className="text-left text-xs uppercase text-slate-500 border-b border-slate-300 py-1.5 pr-3">{h}</th>)}</tr>
          </thead>
          <tbody>
            {b.rows.map((row, i) => (
              <tr key={i} className="align-top break-inside-avoid">
                {row.map((c, j) => <td key={j} className="border-b border-slate-100 py-1.5 pr-3 text-slate-800">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )
  }
}

export default function ReportPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<ReportInput | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/ad-analyzer/${params.id}`)
      .then((r) => r.json())
      .then((d) => (d.analysis ? setData(d.analysis) : setError(d.error || 'Not found')))
      .catch(() => setError('Could not load analysis'))
  }, [params.id])

  // Browser uses document.title as the default PDF file name
  useEffect(() => {
    if (data) document.title = reportFileName(data, 'pdf').replace(/\.pdf$/, '')
  }, [data])

  if (error) return <p className="text-red-600">{error}</p>
  if (!data) return <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 mb-6 print:hidden">
        <Link href="/ad-analyzer" className="btn-ghost"><ArrowLeft className="w-4 h-4" /> Back</Link>
        <div className="flex-1" />
        <button onClick={() => downloadMarkdown(data)} className="btn-secondary"><FileDown className="w-4 h-4" /> Download for Claude (.md)</button>
        <button onClick={() => window.print()} className="btn-primary"><Printer className="w-4 h-4" /> Save as PDF</button>
      </div>
      <p className="text-xs text-slate-500 mb-4 print:hidden">
        “Save as PDF” opens the print window. Set <strong>Destination</strong> to <strong>Save as PDF</strong>, then click Save.
      </p>

      <article className="bg-white rounded-xl border border-slate-200 p-8 space-y-6 print:border-0 print:p-0 print:rounded-none">
        <h1 className="text-2xl font-bold text-slate-900">{reportTitle(data)}</h1>
        {buildReport(data).map((sec, i) => (
          <section key={i} className="space-y-3">
            {sec.level === 2
              ? <h2 className="text-lg font-bold text-slate-900 border-b border-slate-200 pb-1 break-after-avoid">{sec.title}</h2>
              : <h3 className="text-base font-semibold text-slate-800 break-after-avoid">{sec.title}</h3>}
            {sec.blocks.map((b, j) => <RenderBlock key={j} b={b} />)}
          </section>
        ))}
      </article>
    </div>
  )
}
