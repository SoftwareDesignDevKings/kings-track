import { getAccessToken } from './auth'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export async function downloadFile(path: string, fallbackFilename: string): Promise<void> {
  const token = await getAccessToken()

  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Download failed (${res.status}): ${text}`)
  }

  const blob = await res.blob()

  // Extract filename from Content-Disposition header if present
  const disposition = res.headers.get('Content-Disposition')
  let filename = fallbackFilename
  if (disposition) {
    const match = disposition.match(/filename="?([^";\n]+)"?/)
    if (match) filename = match[1]
  }

  // Trigger browser download
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** @deprecated Use downloadFile instead */
export const downloadCsv = downloadFile

export async function previewPdf(path: string, title?: string): Promise<void> {
  const token = await getAccessToken()
  const separator = path.includes('?') ? '&' : '?'
  const res = await fetch(`${API_BASE}${path}${separator}preview=1&format=pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Preview failed (${res.status}): ${text}`)
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const w = window.open('', '_blank')
  if (w) {
    w.document.title = title || 'Report Preview'
    w.document.body.style.margin = '0'
    const iframe = w.document.createElement('iframe')
    iframe.src = url
    iframe.style.cssText = 'width:100%;height:100%;border:none'
    w.document.body.appendChild(iframe)
  }
}
