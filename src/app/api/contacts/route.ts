import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const type   = searchParams.get('type') ?? 'emails'
  const search = searchParams.get('search') ?? ''
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit  = Math.min(500, parseInt(searchParams.get('limit') ?? '50'))
  const skip   = (page - 1) * limit

  const where: Record<string, unknown> = {}
  if (type === 'emails' || type === 'email') {
    where.email = { not: null }
    if (search) where.email = { not: null, contains: search }
  } else {
    where.phone = { not: null }
    if (search) where.phone = { not: null, contains: search }
  }

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.contact.count({ where }),
  ])

  return NextResponse.json({ contacts, total, page, limit })
}
