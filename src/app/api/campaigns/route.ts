import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { steps: true, runs: true } },
    },
  })
  return NextResponse.json({ campaigns })
}

export async function POST(req: NextRequest) {
  const { name, description, steps } = await req.json()

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const campaign = await prisma.campaign.create({
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

  return NextResponse.json({ campaign }, { status: 201 })
}
