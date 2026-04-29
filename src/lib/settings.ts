import { prisma } from './prisma'

export async function getSetting(key: string): Promise<string | null> {
  try {
    const row = await prisma.appSettings.findUnique({ where: { key } })
    return row?.value ?? null
  } catch {
    return null
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSettings.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await prisma.appSettings.findMany()
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}
