import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendBulkSms } from '@/lib/sms'
import { parsePhones } from '@/lib/validators'

export async function POST(req: NextRequest) {
  const { fromId, message, recipientMode, customTo } = await req.json()

  if (!message?.trim()) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  }

  let recipients: Array<{ contactId: string; phone: string }> = []

  if (recipientMode === 'custom') {
    const { valid } = parsePhones(customTo ?? '')
    if (valid.length === 0) {
      return NextResponse.json({ error: 'No valid phone numbers provided' }, { status: 400 })
    }
    for (const phone of valid) {
      let contact = await prisma.contact.findUnique({ where: { phone } })
      if (!contact) {
        contact = await prisma.contact.create({ data: { phone } })
      }
      recipients.push({ contactId: contact.id, phone })
    }
  } else {
    const contacts = await prisma.contact.findMany({
      where: { phone: { not: null } },
      take: 10000,
    })
    recipients = contacts
      .filter((c) => c.phone)
      .map((c) => ({ contactId: c.id, phone: c.phone! }))
  }

  if (recipients.length === 0) {
    return NextResponse.json({ error: 'No recipients found' }, { status: 400 })
  }

  const defaultFrom = fromId || process.env.TWILIO_PHONE_NUMBER || ''

  const result = await sendBulkSms(
    recipients,
    { from: defaultFrom, message },
    undefined,
    300
  )

  return NextResponse.json(result)
}
