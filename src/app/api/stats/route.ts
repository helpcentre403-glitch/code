import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const [
    totalContacts,
    emailContacts,
    phoneContacts,
    totalCampaigns,
    activeCampaigns,
    emailsSent,
    emailsFailed,
    smsSent,
    smsFailed,
    recentRuns,
  ] = await Promise.all([
    prisma.contact.count(),
    prisma.contact.count({ where: { email: { not: null } } }),
    prisma.contact.count({ where: { phone: { not: null } } }),
    prisma.campaign.count(),
    prisma.campaign.count({ where: { status: { not: 'archived' } } }),
    prisma.emailLog.count({ where: { status: 'sent' } }),
    prisma.emailLog.count({ where: { status: 'failed' } }),
    prisma.smsLog.count({ where: { status: 'sent' } }),
    prisma.smsLog.count({ where: { status: 'failed' } }),
    prisma.campaignRun.findMany({
      take: 10,
      orderBy: { startedAt: 'desc' },
      include: { campaign: { select: { name: true } } },
    }),
  ])

  return NextResponse.json({
    totalContacts,
    emailContacts,
    phoneContacts,
    totalCampaigns,
    activeCampaigns,
    emailsSent,
    emailsFailed,
    smsSent,
    smsFailed,
    recentRuns: recentRuns.map((r) => ({
      id: r.id,
      campaignName: r.campaign.name,
      status: r.status,
      totalSent: r.totalSent,
      totalFailed: r.totalFailed,
      startedAt: r.startedAt,
    })),
  })
}
