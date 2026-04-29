export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export function isValidPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-().+]/g, '')
  return /^\d{7,15}$/.test(cleaned)
}

export function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-()]/g, '')
  if (!cleaned.startsWith('+')) return '+' + cleaned
  return cleaned
}

export function parseEmails(raw: string): {
  valid: string[]
  invalid: string[]
  duplicates: string[]
} {
  const lines = raw
    .split(/[\n,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

  const seen = new Set<string>()
  const valid: string[] = []
  const invalid: string[] = []
  const duplicates: string[] = []

  for (const line of lines) {
    if (!isValidEmail(line)) {
      invalid.push(line)
    } else if (seen.has(line)) {
      duplicates.push(line)
    } else {
      seen.add(line)
      valid.push(line)
    }
  }

  return { valid, invalid, duplicates }
}

export function parsePhones(raw: string): {
  valid: string[]
  invalid: string[]
  duplicates: string[]
} {
  const lines = raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const seen = new Set<string>()
  const valid: string[] = []
  const invalid: string[] = []
  const duplicates: string[] = []

  for (const line of lines) {
    if (!isValidPhone(line)) {
      invalid.push(line)
    } else {
      const normalized = normalizePhone(line)
      if (seen.has(normalized)) {
        duplicates.push(line)
      } else {
        seen.add(normalized)
        valid.push(normalized)
      }
    }
  }

  return { valid, invalid, duplicates }
}
