import type { AttrValue, Field, Item } from '@/api/types'

const optionLabel = (f: Field, v: string) => f.options?.find((o) => o.value === v)?.label ?? v

// Card text for one attrs value, or null when there is nothing to show.
export function formatFieldValue(f: Field, v: AttrValue | undefined): string | null {
  if (v === undefined || v === null || v === '') return null
  switch (f.type) {
    case 'bool':
      return v === true ? f.label : null
    case 'select':
      return optionLabel(f, String(v))
    case 'multiselect':
      return Array.isArray(v) && v.length ? v.map((x) => optionLabel(f, x)).join(' / ') : null
    case 'number': {
      const n = typeof v === 'number' ? v : Number(v)
      const s = Number.isFinite(n) ? n.toLocaleString('en-US') : String(v)
      return f.unit ? `${s} ${f.unit}` : s
    }
    default:
      return String(v)
  }
}

export interface CardDetail {
  label: string
  value: string
}

// Detail popover rows: the same showOnCard fields, each with its label.
// With all, every field with a value is listed, not just the ShowOnCard ones.
export function cardDetails(fields: Field[], item: Item, all = false): CardDetail[] {
  return fields
    .filter((f) => all || f.showOnCard)
    .map((f) => {
      const v = item.attrs[f.key]
      const value = f.type === 'bool' ? (v === true ? '是' : null) : formatFieldValue(f, v)
      return value === null ? null : { label: f.label, value }
    })
    .filter((d): d is CardDetail => d !== null)
}

// RFC 3339 -> local "2026-10-26 14:30".
export function formatLocalMinute(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
