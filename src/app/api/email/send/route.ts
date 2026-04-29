import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendBulkEmails } from '@/lib/email'
import { parseEmails } from '@/lib/validators'

export async function POST(req: NextRequest) {
  const { fromName, fromEmail, subject, body, recipientMode, customTo } = await req.json()

  if (!fromEmail || !subject || !body) {
    return NextResponse.json({ error: 'fromEmail, subject, and body are required' }, { status: 400 })
  }

  let recipients: Array<{ contactId: string; email: string }> = []

  if (recipientMode === 'custom') {
    const { valid } = parseEmails(customTo ?? '')
    if (valid.length === 0) {
      return NextResponse.json({ error: 'No valid email addresses provided' }, { status: 400 })
    }
    // Find or match contacts
    for (const email of valid) {
      let contact = await prisma.contact.findUnique({ where: { email } })
      if (!contact) {
        contact = await prisma.contact.create({ data: { email } })
      }
      recipients.push({ contactId: contact.id, email })
    }
  } else {
    const contacts = await prisma.contact.findMany({
      where: { email: { not: null } },
      take: 50000,
    })
    recipients = contacts
      .filter((c) => c.email)
      .map((c) => ({ contactId: c.id, email: c.email! }))
  }

  if (recipients.length === 0) {
    return NextResponse.json({ error: 'No recipients found' }, { status: 400 })
  }

  const result = await sendBulkEmails(
    recipients,
    { from: fromEmail, fromName: fromName || fromEmail, subject, html: body },
    undefined,
    200
  )

  return NextResponse.json(result)
}
