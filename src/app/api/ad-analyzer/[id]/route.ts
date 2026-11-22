import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const row = await prisma.adAnalysis.findUnique({ where: { id: params.id } })
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({
    analysis: {
      ...row,
      segments: JSON.parse(row.segments),
      stats: JSON.parse(row.stats),
      analysis: JSON.parse(row.analysis),
    },
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.adAnalysis.delete({ where: { id: params.id } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
