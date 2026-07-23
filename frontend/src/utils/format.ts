export function formatNumber(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '--'
  return v.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '--'
  const digits = v >= 100 ? 2 : v >= 1 ? 4 : 6
  return formatNumber(v, digits)
}

export function formatCurrency(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '--'
  const sign = v < 0 ? '-' : ''
  return `${sign}$${formatNumber(Math.abs(v), digits)}`
}

export function formatPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '--'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}%`
}

export function formatSignedPnl(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '--'
  const sign = v > 0 ? '+' : ''
  return `${sign}${formatNumber(v, digits)}`
}

export function formatTime(v: string | number | null | undefined): string {
  if (!v) return '--'
  const d = typeof v === 'number' ? new Date(v) : new Date(v)
  if (Number.isNaN(d.getTime())) return '--'
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function formatDate(v: string | number | null | undefined): string {
  if (!v) return '--'
  const d = typeof v === 'number' ? new Date(v) : new Date(v)
  if (Number.isNaN(d.getTime())) return '--'
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatTimeShort(v: string | number | null | undefined): string {
  if (!v) return '--'
  const d = typeof v === 'number' ? new Date(v) : new Date(v)
  if (Number.isNaN(d.getTime())) return '--'
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function pnlColor(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return 'text-fg'
  return v > 0 ? 'text-up' : 'text-down'
}
