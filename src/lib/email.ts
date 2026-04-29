import nodemailer from 'nodemailer'
import { prisma } from './prisma'

export interface EmailOptions {
  to: string
  from: string
  fromName: string
  subject: string
  html: string
  contactId?: string
  campaignRunId?: string
}

function createTransport() {
  const smtpHost = process.env.SMTP_HOST
  const smtpUser = process.env.SMTP_USER
  const smtpPass = process.env.SMTP_PASS

  if (!smtpHost || !smtpUser || !smtpPass) {
    return null
  }

  return nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: smtpUser, pass: smtpPass },
  })
}

export async function sendEmail(opts: EmailOptions): Promise<{ success: boolean; error?: string }> {
  const transporter = createTransport()

  if (!transporter) {
    const error = 'SMTP not configured. Add SMTP_HOST, SMTP_USER, SMTP_PASS in Settings.'
    await logEmail(opts, 'failed', error)
    return { success: false, error }
  }

  try {
    await transporter.sendMail({
      from: `"${opts.fromName}" <${opts.from}>`,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    })
    await logEmail(opts, 'sent')
    return { success: true }
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err)
    await logEmail(opts, 'failed', error)
    return { success: false, error }
  }
}

async function logEmail(opts: EmailOptions, status: string, error?: string) {
  if (!opts.contactId) return
  try {
    await prisma.emailLog.create({
      data: {
        contactId: opts.contactId,
        campaignRunId: opts.campaignRunId,
        status,
        toEmail: opts.to,
        subject: opts.subject,
        error,
      },
    })
  } catch {
    // non-critical
  }
}

export async function sendBulkEmails(
  recipients: Array<{ contactId: string; email: string }>,
  opts: Omit<EmailOptions, 'to' | 'contactId'>,
  campaignRunId?: string,
  rateLimitMs = 200
): Promise<{ sent: number; failed: number; errors: string[] }> {
  let sent = 0
  let failed = 0
  const errors: string[] = []

  for (const recipient of recipients) {
    const result = await sendEmail({
      ...opts,
      to: recipient.email,
      contactId: recipient.contactId,
      campaignRunId,
    })

    if (result.success) {
      sent++
    } else {
      failed++
      errors.push(`${recipient.email}: ${result.error}`)
    }

    if (rateLimitMs > 0 && recipients.indexOf(recipient) < recipients.length - 1) {
      await new Promise((r) => setTimeout(r, rateLimitMs))
    }
  }

  return { sent, failed, errors }
}
