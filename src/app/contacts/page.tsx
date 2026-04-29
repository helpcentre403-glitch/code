'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Users, Trash2, Download, Upload, Search, Mail, Phone, Plus, AlertCircle, CheckCircle2, X
} from 'lucide-react'
import { parseEmails, parsePhones } from '@/lib/validators'

type ContactTab = 'emails' | 'phones'
type Contact = {
  id: string; email?: string | null; phone?: string | null; name?: string | null
  tags: string; createdAt: string
}

export default function ContactsPage() {
  const [tab, setTab] = useState<ContactTab>('emails')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [bulkText, setBulkText] = useState('')
  const [parseResult, setParseResult] = useState<null | { valid: string[]; invalid: string[]; duplicates: string[] }>(null)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const PER_PAGE = 50

  const fetchContacts = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/contacts?type=${tab}&search=${encodeURIComponent(search)}&page=${page}&limit=${PER_PAGE}`)
      const data = await r.json()
      setContacts(data.contacts ?? [])
    } finally {
      setLoading(false)
    }
  }, [tab, search, page])

  useEffect(() => { fetchContacts() }, [fetchContacts])

  function handleParse() {
    const result = tab === 'emails' ? parseEmails(bulkText) : parsePhones(bulkText)
    setParseResult(result)
  }

  async function handleImport() {
    if (!parseResult || parseResult.valid.length === 0) return
    setImporting(true)
    setImportMsg('')
    try {
      const res = await fetch('/api/contacts/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: tab, values: parseResult.valid }),
      })
      const data = await res.json()
      setImportMsg(`✓ Imported ${data.created} new, skipped ${data.skipped} duplicates.`)
      setBulkText('')
      setParseResult(null)
      fetchContacts()
    } catch {
      setImportMsg('Import failed. Please try again.')
    } finally {
      setImporting(false)
    }
  }

  async function deleteContact(id: string) {
    if (!confirm('Delete this contact?')) return
    await fetch(`/api/contacts/${id}`, { method: 'DELETE' })
    fetchContacts()
  }

  async function exportContacts() {
    const r = await fetch(`/api/contacts?type=${tab}&limit=999999`)
    const data = await r.json()
    const all: Contact[] = data.contacts ?? []
    const csv =
      tab === 'emails'
        ? 'email,name,tags\n' + all.map((c) => `${c.email ?? ''},${c.name ?? ''},${c.tags}`).join('\n')
        : 'phone,name,tags\n' + all.map((c) => `${c.phone ?? ''},${c.name ?? ''},${c.tags}`).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${tab}_contacts.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredContacts = contacts

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Contacts</h1>
          <p className="text-slate-500 mt-1">Manage your email and phone contact lists</p>
        </div>
        <button onClick={exportContacts} className="btn-secondary">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {(['emails', 'phones'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); setParseResult(null); setBulkText('') }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all ${
              tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'emails' ? <Mail className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
            {t === 'emails' ? 'Email Contacts' : 'Phone Contacts'}
          </button>
        ))}
      </div>

      {/* Bulk import */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4 text-slate-500" />
          <h2 className="font-semibold text-slate-800">Bulk Import</h2>
          <span className="text-xs text-slate-400">— paste comma or line-separated values</span>
        </div>
        <textarea
          value={bulkText}
          onChange={(e) => { setBulkText(e.target.value); setParseResult(null) }}
          placeholder={
            tab === 'emails'
              ? 'Paste emails here, one per line or comma-separated:\njohn@example.com\njane@example.com, alice@company.org\n...'
              : 'Paste phone numbers here:\n+1234567890\n+44 20 7946 0958\n+1 (555) 000-1234\n...'
          }
          rows={8}
          className="input font-mono text-xs resize-y"
          style={{ minHeight: 160 }}
        />
        <div className="flex items-center gap-3">
          <button onClick={handleParse} disabled={!bulkText.trim()} className="btn-secondary">
            <Search className="w-4 h-4" /> Validate & Preview
          </button>
          {parseResult && parseResult.valid.length > 0 && (
            <button onClick={handleImport} disabled={importing} className="btn-primary">
              <Plus className="w-4 h-4" />
              {importing ? 'Importing…' : `Import ${parseResult.valid.length} valid entries`}
            </button>
          )}
          {importMsg && (
            <span className={`text-sm flex items-center gap-1 ${importMsg.startsWith('✓') ? 'text-emerald-600' : 'text-red-500'}`}>
              {importMsg.startsWith('✓') ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {importMsg}
            </span>
          )}
        </div>

        {parseResult && (
          <div className="grid grid-cols-3 gap-3 pt-1">
            <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
              <p className="text-xs font-medium text-emerald-700">Valid ({parseResult.valid.length})</p>
              <div className="mt-1.5 max-h-24 overflow-y-auto space-y-0.5">
                {parseResult.valid.slice(0, 20).map((v) => (
                  <p key={v} className="text-xs text-emerald-800 font-mono truncate">{v}</p>
                ))}
                {parseResult.valid.length > 20 && (
                  <p className="text-xs text-emerald-500">…and {parseResult.valid.length - 20} more</p>
                )}
              </div>
            </div>
            <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-3">
              <p className="text-xs font-medium text-yellow-700">Duplicates ({parseResult.duplicates.length})</p>
              <div className="mt-1.5 max-h-24 overflow-y-auto space-y-0.5">
                {parseResult.duplicates.slice(0, 10).map((v) => (
                  <p key={v} className="text-xs text-yellow-800 font-mono truncate">{v}</p>
                ))}
              </div>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-lg p-3">
              <p className="text-xs font-medium text-red-700">Invalid ({parseResult.invalid.length})</p>
              <div className="mt-1.5 max-h-24 overflow-y-auto space-y-0.5">
                {parseResult.invalid.slice(0, 10).map((v) => (
                  <p key={v} className="text-xs text-red-800 font-mono truncate">{v}</p>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Contact list */}
      <div className="card">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search contacts…"
              className="input pl-9"
            />
          </div>
          <p className="text-sm text-slate-500 ml-auto">
            <Users className="w-4 h-4 inline mr-1" />
            {contacts.length} contacts
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No contacts yet. Paste some above to get started.</p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">
                    {tab === 'emails' ? 'Email' : 'Phone'}
                  </th>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium hidden md:table-cell">Name</th>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium hidden lg:table-cell">Added</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredContacts.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 group">
                    <td className="px-5 py-3 font-mono text-xs text-slate-700">
                      {tab === 'emails' ? c.email : c.phone}
                    </td>
                    <td className="px-5 py-3 text-slate-600 hidden md:table-cell">{c.name ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-400 text-xs hidden lg:table-cell">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => deleteContact(c.id)}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all p-1 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs text-slate-400">Page {page}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={contacts.length < PER_PAGE}
                className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
