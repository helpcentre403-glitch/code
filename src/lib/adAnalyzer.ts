import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { getSetting } from './settings'

// ---------------------------------------------------------------------------
// Config helpers — values saved on the Settings page win over .env
// ---------------------------------------------------------------------------

async function config(key: string): Promise<string | undefined> {
  const fromDb = await getSetting(key)
  return (fromDb && fromDb.trim()) || process.env[key] || undefined
}

// ---------------------------------------------------------------------------
// 1. Transcription (ElevenLabs Speech-to-Text)
// ---------------------------------------------------------------------------

interface ElevenWord {
  text: string
  start?: number
  end?: number
  type?: 'word' | 'spacing' | 'audio_event' | string
  speaker_id?: string
}

interface ElevenResponse {
  text?: string
  language_code?: string
  language_probability?: number
  words?: ElevenWord[]
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface TranscriptStats {
  wordCount: number
  speechSeconds: number
  wordsPerMinute: number
  languageCode: string | null
}

export interface Transcription {
  text: string
  segments: TranscriptSegment[]
  stats: TranscriptStats
}

export async function transcribe(file: File): Promise<Transcription> {
  const apiKey = await config('ELEVENLABS_API_KEY')
  if (!apiKey) throw new Error('ElevenLabs API key missing. Add ELEVENLABS_API_KEY in Settings.')
  const modelId = (await config('ELEVENLABS_STT_MODEL')) || 'scribe_v1'

  const form = new FormData()
  form.append('file', file, file.name || 'ad.mp4')
  form.append('model_id', modelId)
  form.append('tag_audio_events', 'false')
  form.append('timestamps_granularity', 'word')

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`ElevenLabs transcription failed (${res.status}): ${body.slice(0, 500)}`)
  }

  const data = (await res.json()) as ElevenResponse
  const words = (data.words ?? []).filter((w) => w.type === 'word' || w.type === undefined)
  const text = (data.text ?? '').trim()

  if (!text) throw new Error('No speech was detected in this video (it may be music/text-only).')

  return {
    text,
    segments: buildSegments(words, text),
    stats: buildStats(words, text, data.language_code ?? null),
  }
}

/** Group words into lines, breaking on sentence punctuation or pauses > 0.7s. */
function buildSegments(words: ElevenWord[], fallbackText: string): TranscriptSegment[] {
  const timed = words.filter((w) => typeof w.start === 'number' && typeof w.end === 'number')
  if (timed.length === 0) return [{ start: 0, end: 0, text: fallbackText }]

  const segments: TranscriptSegment[] = []
  let current: ElevenWord[] = []

  const flush = () => {
    if (!current.length) return
    segments.push({
      start: current[0].start!,
      end: current[current.length - 1].end!,
      text: current.map((w) => w.text.trim()).join(' ').replace(/\s+([,.!?])/g, '$1'),
    })
    current = []
  }

  timed.forEach((w, i) => {
    current.push(w)
    const next = timed[i + 1]
    const endsSentence = /[.!?]$/.test(w.text.trim())
    const longPause = next ? next.start! - w.end! > 0.7 : false
    if (endsSentence || longPause || current.length >= 18) flush()
  })
  flush()
  return segments
}

function buildStats(words: ElevenWord[], text: string, languageCode: string | null): TranscriptStats {
  const timed = words.filter((w) => typeof w.start === 'number' && typeof w.end === 'number')
  const wordCount = timed.length || text.split(/\s+/).filter(Boolean).length
  // Speech duration = first word start → last word end (silence before/after excluded)
  const speechSeconds = timed.length ? timed[timed.length - 1].end! - timed[0].start! : 0
  const wordsPerMinute = speechSeconds > 0 ? Math.round((wordCount / speechSeconds) * 60) : 0
  return { wordCount, speechSeconds: Math.round(speechSeconds * 10) / 10, wordsPerMinute, languageCode }
}

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// 2. Analysis + new script (Claude)
// ---------------------------------------------------------------------------

const Score = z.number().int().describe('Score from 1 (weak) to 10 (excellent)')

export const AnalysisSchema = z.object({
  overview: z.object({
    productAdvertised: z.string(),
    coreAngle: z.string().describe('The main selling angle in one sentence'),
    targetAudience: z.string(),
    awarenessLevel: z.enum(['unaware', 'problem-aware', 'solution-aware', 'product-aware', 'most-aware']),
    adFormat: z.string().describe('e.g. UGC testimonial, problem/solution, founder story, listicle, us-vs-them, unboxing'),
    oneLineVerdict: z.string(),
  }),
  labeledScript: z
    .array(
      z.object({
        timestamp: z.string().describe('m:ss start time of the line, copied from the transcript'),
        section: z.enum(['hook', 'problem', 'agitation', 'solution', 'demo', 'benefits', 'social-proof', 'objection-handling', 'offer', 'cta', 'other']),
        line: z.string(),
      }),
    )
    .describe('The original transcript split into lines, each tagged with its role. Do not change the wording.'),
  hook: z.object({
    text: z.string().describe('Exact hook wording (roughly first 3 seconds / first sentence)'),
    hookType: z.string().describe('e.g. bold claim, question, callout, pattern interrupt, POV, curiosity gap, negative'),
    whyItWorks: z.string(),
    weaknesses: z.string(),
    score: Score,
  }),
  body: z.object({
    structure: z.array(z.string()).describe('The beats of the body in order'),
    persuasionTechniques: z.array(z.string()),
    objectionsHandled: z.array(z.string()),
    whyItWorks: z.string(),
    weaknesses: z.string(),
    score: Score,
  }),
  cta: z.object({
    text: z.string(),
    offerOrUrgency: z.string().describe('Discount, scarcity, guarantee etc. Say "none" if absent'),
    assessment: z.string(),
    score: Score,
  }),
  formatting: z.object({
    pacing: z.string().describe('Comment on the measured words-per-minute and sentence rhythm'),
    sentenceStyle: z.string(),
    toneOfVoice: z.string(),
    notes: z.array(z.string()),
  }),
  keyTakeaways: z.array(z.string()).describe('What to steal from this ad'),
  alternativeHooks: z.array(z.string()).describe('5 alternative hooks for the user’s product using the same psychology'),
  newScript: z.object({
    title: z.string(),
    angle: z.string(),
    estimatedLengthSeconds: z.number().int(),
    lines: z.array(
      z.object({
        section: z.string(),
        voiceover: z.string(),
        visual: z.string().describe('Shot / on-screen direction'),
        onScreenText: z.string().describe('Caption overlay, or empty string'),
      }),
    ),
    fullVoiceover: z.string().describe('The full voiceover as one block of text, ready to paste into ElevenLabs'),
    whyThisShouldWork: z.string(),
  }),
})

export type AdAnalysisResult = z.infer<typeof AnalysisSchema>

const SYSTEM_PROMPT = `You are a senior direct-response creative strategist for e-commerce brands running paid social (Meta, TikTok).
You break down competitor video ads and write new scripts.

Rules:
- Base every claim about the competitor ad only on the transcript and stats you are given. You cannot see the visuals; say so when it matters.
- You have no performance data (spend, CTR, ROAS). Do not claim the ad "is winning" or "converts well"; describe why its structure could work.
- Keep the competitor's wording exactly as transcribed in labeledScript.
- The new script must be original: reuse the structure and psychology, never copy the competitor's sentences or brand claims.
- Do not invent product facts, results, statistics, reviews or certifications for the user's product. If you need one, write a placeholder like [INSERT REAL RESULT].
- Write in plain, spoken language that sounds natural read aloud. Match the length of the original unless told otherwise.`

export interface AnalyzeInput {
  transcription: Transcription
  competitor?: string
  productName?: string
  productDescription?: string
  extraNotes?: string
}

export async function analyzeAd(input: AnalyzeInput): Promise<AdAnalysisResult> {
  const apiKey = await config('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('Anthropic API key missing. Add ANTHROPIC_API_KEY in Settings.')

  const client = new Anthropic({ apiKey })
  const { transcription: t } = input

  const timestamped = t.segments.map((s) => `[${fmtTime(s.start)}] ${s.text}`).join('\n')
  const product = input.productName?.trim()
    ? `Name: ${input.productName}\nDescription: ${input.productDescription || '(none given)'}`
    : 'Not provided. Write the new script as a reusable template with [PRODUCT], [BENEFIT], [RESULT] placeholders.'

  const userPrompt = `<competitor>${input.competitor || 'unknown'}</competitor>

<transcript_timestamped>
${timestamped}
</transcript_timestamped>

<measured_stats>
Words: ${t.stats.wordCount}
Speech duration: ${t.stats.speechSeconds}s
Words per minute: ${t.stats.wordsPerMinute} (= ${t.stats.wordCount} words / ${t.stats.speechSeconds}s × 60)
Detected language: ${t.stats.languageCode ?? 'unknown'}
</measured_stats>

<my_product>
${product}
</my_product>

<extra_notes>
${input.extraNotes?.trim() || 'none'}
</extra_notes>

Break down this competitor ad (hook, body, CTA, formatting) and write a new script for my product.`

  const response = await client.beta.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: betaZodOutputFormat(AnalysisSchema) },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude declined to analyze this ad${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : '.'}`)
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Analysis was cut off (output too long). Try a shorter video.')
  }
  if (!response.parsed_output) throw new Error('Could not parse the analysis response.')
  return response.parsed_output
}
