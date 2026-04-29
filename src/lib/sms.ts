import { prisma } from './prisma'

export interface SmsOptions {
  to: string
  from: string
  message: string
  contactId?: string
  campaignRunId?: string
}

function createTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN

  if (!accountSid || !authToken) return null

  // Dynamic import to avoid issues when twilio is not configured
  const twilio = require('twilio')
  return twilio(accountSid, authToken)
}

export async function sendSms(opts: SmsOptions): Promise<{ success: boolean; error?: string }> {
  const client = createTwilioClient()

  if (!client) {
    const error = 'Twilio not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Settings.'
    await logSms(opts, 'failed', error)
    return { success: false, error }
  }

  try {
    await client.messages.create({
      body: opts.message,
      from: opts.from || process.env.TWILIO_PHONE_NUMBER,
      to: opts.to,
    })
    await logSms(opts, 'sent')
    return { success: true }
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err)
    await logSms(opts, 'failed', error)
    return { success: false, error }
  }
}

async function logSms(opts: SmsOptions, status: string, error?: string) {
  if (!opts.contactId) return
  try {
    await prisma.smsLog.create({
      data: {
        contactId: opts.contactId,
        campaignRunId: opts.campaignRunId,
        status,
        toPhone: opts.to,
        message: opts.message,
        error,
      },
    })
  } catch {
    // non-critical
  }
}

export async function sendBulkSms(
  recipients: Array<{ contactId: string; phone: string }>,
  opts: Omit<SmsOptions, 'to' | 'contactId'>,
  campaignRunId?: string,
  rateLimitMs = 300
): Promise<{ sent: number; failed: number; errors: string[] }> {
  let sent = 0
  let failed = 0
  const errors: string[] = []

  for (const recipient of recipients) {
    const result = await sendSms({
      ...opts,
      to: recipient.phone,
      contactId: recipient.contactId,
      campaignRunId,
    })

    if (result.success) {
      sent++
    } else {
      failed++
      errors.push(`${recipient.phone}: ${result.error}`)
    }

    if (rateLimitMs > 0 && recipients.indexOf(recipient) < recipients.length - 1) {
      await new Promise((r) => setTimeout(r, rateLimitMs))
    }
  }

  return { sent, failed, errors }
}
