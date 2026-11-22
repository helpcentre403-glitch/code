import { NextRequest, NextResponse } from 'next/server'
import { getAllSettings, setSetting } from '@/lib/settings'

export async function GET() {
  const settings = await getAllSettings()
  return NextResponse.json({ settings })
}

export async function PUT(req: NextRequest) {
  const { settings } = await req.json() as { settings: Record<string, string> }

  if (!settings || typeof settings !== 'object') {
    return NextResponse.json({ error: 'Invalid settings' }, { status: 400 })
  }

  const allowedKeys = [
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
    'ELEVENLABS_API_KEY', 'ELEVENLABS_STT_MODEL', 'ANTHROPIC_API_KEY',
  ]

  for (const [key, value] of Object.entries(settings)) {
    if (allowedKeys.includes(key)) {
      await setSetting(key, value)
      // Also update process.env so current process uses them immediately
      process.env[key] = value
    }
  }

  return NextResponse.json({ ok: true })
}
