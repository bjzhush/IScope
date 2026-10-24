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
export function cardDetails(fields: Field[], item: Item): CardDetail[] {
  return fields
    .filter((f) => f.showOnCard)
    .map((f) => {
      const v = item.attrs[f.key]
      const value = f.type === 'bool' ? (v === true ? '是' : null) : formatFieldValue(f, v)
      return value === null ? null : { label: f.label, value }
    })
    .filter((d): d is CardDetail => d !== null)
}
