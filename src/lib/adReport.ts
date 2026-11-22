// Builds the "everything about this ad" knowledge doc.
// Client-safe: no server imports. Used by the Markdown download and the PDF (print) page.
import type { AdAnalysisResult, TranscriptSegment, TranscriptStats } from './adAnalyzer'

export interface ReportInput {
  fileName: string
  competitor: string
  productName: string
  productDescription?: string
  transcript: string
  segments: TranscriptSegment[]
  stats: TranscriptStats
  analysis: AdAnalysisResult
  createdAt: string
}

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; items: string[]; ordered?: boolean }
  | { kind: 'kv'; rows: [string, string][] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'pre'; text: string }

export interface ReportSection {
  title: string
  level: 2 | 3
  blocks: Block[]
}

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, '0')}`

export function reportTitle(r: ReportInput) {
  return `Ad Breakdown: ${r.competitor || r.fileName}`
}

export function buildReport(r: ReportInput): ReportSection[] {
  const a = r.analysis
  const s: ReportSection[] = []
  const sec = (title: string, blocks: Block[], level: 2 | 3 = 2) => s.push({ title, level, blocks })

  sec('About this document', [
    {
      kind: 'p',
      text:
        'Breakdown of a competitor video ad. The transcript comes from ElevenLabs speech-to-text; the analysis was written by Claude from the transcript only. ' +
        'It did not see the visuals and had no performance data (spend, CTR, ROAS), so scores are judgments of the script, not proof of results.',
    },
    {
      kind: 'kv',
      rows: [
        ['Competitor', r.competitor || 'unknown'],
        ['Source file', r.fileName],
        ['Analyzed', new Date(r.createdAt).toLocaleString()],
        ['Written for product', r.productName || '(none, template script)'],
      ],
    },
  ])

  sec('Overview', [
    {
      kind: 'kv',
      rows: [
        ['Verdict', a.overview.oneLineVerdict],
        ['Product advertised', a.overview.productAdvertised],
        ['Core angle', a.overview.coreAngle],
        ['Target audience', a.overview.targetAudience],
        ['Awareness level', a.overview.awarenessLevel],
        ['Ad format', a.overview.adFormat],
      ],
    },
  ])

  sec('Measured stats', [
    {
      kind: 'kv',
      rows: [
        ['Words', String(r.stats.wordCount)],
        ['Speech duration', `${r.stats.speechSeconds}s`],
        ['Words per minute', `${r.stats.wordsPerMinute} (${r.stats.wordCount} words ÷ ${r.stats.speechSeconds}s × 60)`],
        ['Language', r.stats.languageCode ?? 'unknown'],
      ],
    },
  ])

  sec('Competitor script (as spoken)', [{ kind: 'p', text: r.transcript }])

  sec('Script labeled by section', [
    { kind: 'table', head: ['Time', 'Section', 'Line'], rows: a.labeledScript.map((l) => [l.timestamp, l.section, l.line]) },
  ])

  sec('Hook', [
    { kind: 'quote', text: a.hook.text },
    { kind: 'kv', rows: [['Score', `${a.hook.score}/10`], ['Hook type', a.hook.hookType], ['Why it works', a.hook.whyItWorks], ['Weaknesses', a.hook.weaknesses]] },
  ])

  sec('Body', [
    { kind: 'kv', rows: [['Score', `${a.body.score}/10`], ['Why it works', a.body.whyItWorks], ['Weaknesses', a.body.weaknesses]] },
  ])
  sec('Structure (beats in order)', [{ kind: 'list', ordered: true, items: a.body.structure }], 3)
  sec('Persuasion techniques', [{ kind: 'list', items: a.body.persuasionTechniques }], 3)
  sec('Objections handled', [{ kind: 'list', items: a.body.objectionsHandled.length ? a.body.objectionsHandled : ['None'] }], 3)

  sec('Call to action', [
    { kind: 'quote', text: a.cta.text },
    { kind: 'kv', rows: [['Score', `${a.cta.score}/10`], ['Offer / urgency', a.cta.offerOrUrgency], ['Assessment', a.cta.assessment]] },
  ])

  sec('Formatting & delivery', [
    { kind: 'kv', rows: [['Pacing', a.formatting.pacing], ['Sentence style', a.formatting.sentenceStyle], ['Tone of voice', a.formatting.toneOfVoice]] },
    { kind: 'list', items: a.formatting.notes },
  ])

  sec('What to steal', [{ kind: 'list', items: a.keyTakeaways }])

  if (a.learnings) {
    sec('Reusable script template', [{ kind: 'pre', text: a.learnings.scriptTemplate }])
    sec('Power phrases', [{ kind: 'list', items: a.learnings.powerPhrases }])
    sec('Emotional triggers', [{ kind: 'list', items: a.learnings.emotionalTriggers }])
    sec('What to test next', [{ kind: 'list', items: a.learnings.whatToTestNext }])
  }

  sec(`New script${r.productName ? ` for ${r.productName}` : ''}: ${a.newScript.title}`, [
    { kind: 'kv', rows: [['Angle', a.newScript.angle], ['Estimated length', `~${a.newScript.estimatedLengthSeconds}s`]] },
    { kind: 'p', text: a.newScript.fullVoiceover },
    { kind: 'kv', rows: [['Why this should work', a.newScript.whyThisShouldWork]] },
  ])
  sec('Shot list', [
    { kind: 'table', head: ['Section', 'Voiceover', 'Visual', 'On-screen text'], rows: a.newScript.lines.map((l) => [l.section, l.voiceover, l.visual, l.onScreenText]) },
  ], 3)
  sec('Alternative hooks to test', [{ kind: 'list', ordered: true, items: a.alternativeHooks }], 3)

  sec('Raw transcript with timestamps', [{ kind: 'pre', text: r.segments.map((x) => `[${fmt(x.start)}] ${x.text}`).join('\n') }])

  return s
}

// ---------------------------------------------------------------------------
// Markdown output (best format for uploading into a Claude chat / Project)
// ---------------------------------------------------------------------------

const cell = (t: string) => (t || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

function blockToMd(b: Block): string {
  switch (b.kind) {
    case 'p': return b.text
    case 'quote': return `> ${b.text}`
    case 'pre': return '```\n' + b.text + '\n```'
    case 'list': return b.items.map((x, i) => (b.ordered ? `${i + 1}. ${x}` : `- ${x}`)).join('\n')
    case 'kv': return b.rows.map(([k, v]) => `- **${k}:** ${v}`).join('\n')
    case 'table':
      return [
        `| ${b.head.map(cell).join(' | ')} |`,
        `| ${b.head.map(() => '---').join(' | ')} |`,
        ...b.rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
      ].join('\n')
  }
}

export function reportToMarkdown(r: ReportInput): string {
  const parts = [`# ${reportTitle(r)}`]
  for (const sec of buildReport(r)) {
    parts.push(`${'#'.repeat(sec.level)} ${sec.title}`)
    for (const b of sec.blocks) parts.push(blockToMd(b))
  }
  return parts.join('\n\n') + '\n'
}

export function reportFileName(r: ReportInput, ext: string) {
  const base = `ad-breakdown-${r.competitor || r.fileName.replace(/\.[^.]+$/, '')}-${r.createdAt.slice(0, 10)}`
  return base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-') + '.' + ext
}

export function downloadMarkdown(r: ReportInput) {
  const blob = new Blob([reportToMarkdown(r)], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = reportFileName(r, 'md')
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
