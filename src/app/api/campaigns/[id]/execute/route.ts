import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { sendSms } from '@/lib/sms'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { contactType = 'email' } = await req.json()

  const campaign = await prisma.campaign.findUnique({
    where: { id: params.id },
    include: { steps: { orderBy: { stepOrder: 'asc' } } },
  })

  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  if (campaign.steps.length === 0) return NextResponse.json({ error: 'Campaign has no steps' }, { status: 400 })

  // Get contacts
  const contacts = await prisma.contact.findMany({
    where: contactType === 'email' ? { email: { not: null } } : { phone: { not: null } },
    take: 10000,
  })

  if (contacts.length === 0) {
    return NextResponse.json({ error: 'No contacts found for this type' }, { status: 400 })
  }

  // Create run record
  const run = await prisma.campaignRun.create({
    data: { campaignId: params.id, status: 'running' },
  })

  let totalSent = 0
  let totalFailed = 0

  // Process each step
  for (const step of campaign.steps) {
    let config: Record<string, unknown> = {}
    try { config = JSON.parse(step.config) } catch { /* ok */ }

    if (step.type === 'wait') {
      // In production this would schedule future jobs; for now we skip
      continue
    }

    if (step.type === 'email') {
      for (const contact of contacts) {
        if (!contact.email) continue
        const result = await sendEmail({
          to: contact.email,
          from: (config.fromEmail as string) || 'noreply@campaignhub.app',
          fromName: (config.fromName as string) || 'CampaignHub',
          subject: (config.subject as string) || '(No subject)',
          html: (config.body as string) || '',
          contactId: contact.id,
          campaignRunId: run.id,
        })
        if (result.success) totalSent++
        else totalFailed++

        // Rate limiting: 5 emails/sec
        await new Promise((r) => setTimeout(r, 200))
      }
    }

    if (step.type === 'sms') {
      for (const contact of contacts) {
        if (!contact.phone) continue
        const result = await sendSms({
          to: contact.phone,
          from: (config.fromId as string) || process.env.TWILIO_PHONE_NUMBER || '',
          message: (config.message as string) || '',
          contactId: contact.id,
          campaignRunId: run.id,
        })
        if (result.success) totalSent++
        else totalFailed++

        // Rate limiting: ~3 SMS/sec
        await new Promise((r) => setTimeout(r, 300))
      }
    }
  }

  // Update run
  await prisma.campaignRun.update({
    where: { id: run.id },
    data: { status: 'completed', totalSent, totalFailed, completedAt: new Date() },
  })

  return NextResponse.json({ sent: totalSent, failed: totalFailed, runId: run.id })
}
