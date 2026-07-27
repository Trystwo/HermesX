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

/** 持仓监控时间列：2026/7/24 10:45:01 */
export function formatPositionTime(v: string | number | Date | null | undefined): string {
  if (!v) return '--'
  const d = v instanceof Date ? v : typeof v === 'number' ? new Date(v) : new Date(v)
  if (Number.isNaN(d.getTime())) return '--'
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
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

/** 相对时间；悬停可用 formatTime 看完整本地时间 */
export function formatRelativeTime(v: string | number | Date | null | undefined): string {
  if (!v) return '--'
  const d = v instanceof Date ? v : typeof v === 'number' ? new Date(v) : new Date(v)
  if (Number.isNaN(d.getTime())) return '--'
  const diffMs = Date.now() - d.getTime()
  const future = diffMs < 0
  const abs = Math.abs(diffMs)
  const sec = Math.floor(abs / 1000)
  const min = Math.floor(sec / 60)
  const hour = Math.floor(min / 60)
  const day = Math.floor(hour / 24)

  let label: string
  if (sec < 45) label = '刚刚'
  else if (min < 60) label = `${min}m`
  else if (hour < 24) label = `${hour}h`
  else if (day < 30) label = `${day}d`
  else label = formatTimeShort(d.toISOString())

  if (label === '刚刚') return label
  return future ? `${label}后` : `${label}前`
}

export function pnlColor(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return 'text-fg'
  return v > 0 ? 'text-up' : 'text-down'
}
