import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: params.id },
    include: {
      steps: { orderBy: { stepOrder: 'asc' } },
      runs:  { orderBy: { startedAt: 'desc' }, take: 10 },
    },
  })

  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ campaign })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { name, description, steps } = await req.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  // Delete existing steps and recreate
  await prisma.campaignStep.deleteMany({ where: { campaignId: params.id } })

  const campaign = await prisma.campaign.update({
    where: { id: params.id },
    data: {
      name: name.trim(),
      description: description ?? '',
      steps: {
        create: (steps ?? []).map((s: { type: string; stepOrder: number; config: Record<string, unknown> }) => ({
          type: s.type,
          stepOrder: s.stepOrder,
          config: JSON.stringify(s.config ?? {}),
        })),
      },
    },
    include: { steps: true },
  })

  return NextResponse.json({ campaign })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.campaign.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
