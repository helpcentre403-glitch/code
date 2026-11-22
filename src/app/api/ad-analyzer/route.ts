import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { analyzeAd, transcribe } from '@/lib/adAnalyzer'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

const MAX_BYTES = 500 * 1024 * 1024 // 500 MB

export async function GET() {
  const rows = await prisma.adAnalysis.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, fileName: true, competitor: true, productName: true, createdAt: true },
    take: 100,
  })
  return NextResponse.json({ analyses: rows })
}

export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected a multipart form upload.' }, { status: 400 })
  }

  const file = form.get('video')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Please attach a video file.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File is larger than 500 MB.' }, { status: 400 })
  }

  const str = (k: string) => (typeof form.get(k) === 'string' ? (form.get(k) as string).trim() : '')
  const competitor = str('competitor')
  const productName = str('productName')
  const productDescription = str('productDescription')
  const extraNotes = str('extraNotes')

  try {
    const transcription = await transcribe(file)
    const analysis = await analyzeAd({ transcription, competitor, productName, productDescription, extraNotes })

    const saved = await prisma.adAnalysis.create({
      data: {
        fileName: file.name,
        competitor,
        productName,
        productDescription,
        transcript: transcription.text,
        segments: JSON.stringify(transcription.segments),
        stats: JSON.stringify(transcription.stats),
        analysis: JSON.stringify(analysis),
      },
    })

    return NextResponse.json({ id: saved.id })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Analysis failed'
    console.error('[ad-analyzer]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
