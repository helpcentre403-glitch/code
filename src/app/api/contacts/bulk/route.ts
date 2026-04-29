import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const { type, values } = await req.json() as { type: string; values: string[] }

  if (!Array.isArray(values) || values.length === 0) {
    return NextResponse.json({ error: 'No values provided' }, { status: 400 })
  }

  let created = 0
  let skipped = 0

  const isEmail = type === 'emails' || type === 'email'

  // Process in batches of 500 for efficiency
  const batchSize = 500
  for (let i = 0; i < values.length; i += batchSize) {
    const batch = values.slice(i, i + batchSize)

    for (const value of batch) {
      try {
        if (isEmail) {
          await prisma.contact.create({ data: { email: value.toLowerCase().trim() } })
        } else {
          await prisma.contact.create({ data: { phone: value.trim() } })
        }
        created++
      } catch {
        // Unique constraint violation = duplicate
        skipped++
      }
    }
  }

  return NextResponse.json({ created, skipped, total: values.length })
}
