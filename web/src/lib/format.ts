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

// Third card line: showOnCard fields in definition order.
export function cardMeta(fields: Field[], item: Item): string[] {
  return fields
    .filter((f) => f.showOnCard)
    .map((f) => formatFieldValue(f, item.attrs[f.key]))
    .filter((s): s is string => s !== null)
}
