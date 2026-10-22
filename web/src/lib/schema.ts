// Builds the drawer's zod schema from field definitions and converts between
// API items and form values. Rules mirror internal/kind/validate.go and the
// top-level checks in internal/item/service.go, with the same messages.
import { z } from 'zod'
import type { AttrValue, Attrs, CreateItemInput, Field, Item, ItemPatch, Link, Status } from '@/api/types'

// Form representation: number/date/url/text/select are strings ('' = unset),
// bool is boolean, multiselect is string[].
export type FormAttrValue = string | boolean | string[]
export type FormAttrs = Record<string, FormAttrValue>

export interface ItemFormValues {
  name: string
  status: Status
  summary: string
  tags: string[]
  links: Link[]
  rating: number | null
  notes: string
  attrs: FormAttrs
}

const MSG = {
  required: '必填',
  number: '必须是数字',
  integer: '必须是整数',
  url: '必须是 http 或 https 链接',
  date: '日期格式应为 YYYY-MM-DD',
  option: '不是有效的选项',
  rating: '必须是 1 到 5 之间的整数',
} as const

const blank = (s: string) => s.trim() === ''

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== ''
  } catch {
    return false
  }
}

export function isDateOnly(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

function stringField(f: Field, check?: (s: string) => string | null) {
  return z.string().superRefine((s, ctx) => {
    if (blank(s)) {
      if (f.required) ctx.addIssue({ code: 'custom', message: MSG.required })
      return
    }
    const msg = check?.(s)
    if (msg) ctx.addIssue({ code: 'custom', message: msg })
  })
}

export function fieldSchema(f: Field): z.ZodType<FormAttrValue> {
  const hasOption = (v: string) => f.options?.some((o) => o.value === v) ?? false
  switch (f.type) {
    case 'text':
    case 'textarea':
      return stringField(f)
    case 'url':
      return stringField(f, (s) => (isHttpUrl(s.trim()) ? null : MSG.url))
    case 'date':
      return stringField(f, (s) => (isDateOnly(s) ? null : MSG.date))
    case 'select':
      return stringField(f, (s) => (hasOption(s) ? null : MSG.option))
    case 'number':
      return stringField(f, (s) => {
        const n = Number(s)
        if (!Number.isFinite(n)) return MSG.number
        if (f.integer && !Number.isInteger(n)) return MSG.integer
        if (f.min !== undefined && n < f.min) return `不能小于 ${f.min}`
        return null
      })
    case 'bool':
      return z.boolean()
    case 'multiselect':
      return z.array(z.string()).superRefine((list, ctx) => {
        if (list.length === 0) {
          if (f.required) ctx.addIssue({ code: 'custom', message: MSG.required })
          return
        }
        const bad = list.find((v) => !hasOption(v))
        if (bad !== undefined) ctx.addIssue({ code: 'custom', message: `包含无效的选项 "${bad}"` })
        else if (new Set(list).size !== list.length) ctx.addIssue({ code: 'custom', message: '选项重复' })
      })
  }
}

export function buildAttrsSchema(fields: Field[]) {
  return z.strictObject(Object.fromEntries(fields.map((f) => [f.key, fieldSchema(f)])))
}

export function buildItemSchema(fields: Field[]) {
  return z.object({
    name: z.string().refine((s) => !blank(s), MSG.required),
    status: z.enum(['in_use', 'watching', 'archived']),
    summary: z.string(),
    tags: z.array(z.string()),
    links: z.array(
      z.object({
        label: z.string(),
        url: z.string().refine((s) => isHttpUrl(s.trim()), MSG.url),
      }),
    ),
    rating: z.number().int().min(1, MSG.rating).max(5, MSG.rating).nullable(),
    notes: z.string(),
    attrs: buildAttrsSchema(fields),
  })
}

// --- conversions ---

function emptyFormValue(f: Field): FormAttrValue {
  return f.type === 'bool' ? false : f.type === 'multiselect' ? [] : ''
}

export function attrsToForm(fields: Field[], attrs: Attrs = {}): FormAttrs {
  const out: FormAttrs = {}
  for (const f of fields) {
    const v = attrs[f.key]
    if (v === undefined || v === null) out[f.key] = emptyFormValue(f)
    else if (f.type === 'bool') out[f.key] = v === true
    else if (f.type === 'multiselect') out[f.key] = Array.isArray(v) ? [...v] : []
    else out[f.key] = String(v)
  }
  return out
}

// Form attrs to API attrs; unset values are omitted.
export function attrsFromForm(fields: Field[], form: FormAttrs): Attrs {
  const out: Attrs = {}
  for (const f of fields) {
    const v = form[f.key]
    if (v === undefined) continue
    if (f.type === 'bool') out[f.key] = v === true
    else if (f.type === 'multiselect') {
      if (Array.isArray(v) && v.length) out[f.key] = v
    } else if (typeof v === 'string' && !blank(v)) {
      out[f.key] = f.type === 'number' ? Number(v) : f.type === 'textarea' ? v : v.trim()
    }
  }
  return out
}

export function itemToForm(fields: Field[], item?: Item): ItemFormValues {
  return {
    name: item?.name ?? '',
    status: item?.status ?? 'watching',
    summary: item?.summary ?? '',
    tags: item ? [...item.tags] : [],
    links: item ? item.links.map((l) => ({ ...l })) : [],
    rating: item?.rating ?? null,
    notes: item?.notes ?? '',
    attrs: attrsToForm(fields, item?.attrs),
  }
}

export function toCreateInput(kind: string, fields: Field[], v: ItemFormValues): CreateItemInput {
  return {
    kind,
    name: v.name.trim(),
    status: v.status,
    summary: v.summary,
    tags: v.tags,
    links: v.links,
    rating: v.rating,
    notes: v.notes,
    attrs: attrsFromForm(fields, v.attrs),
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// PATCH body with only the fields that changed; removed attrs become null.
export function diffPatch(fields: Field[], before: ItemFormValues, after: ItemFormValues): ItemPatch {
  const patch: ItemPatch = {}
  if (after.name.trim() !== before.name.trim()) patch.name = after.name.trim()
  if (after.status !== before.status) patch.status = after.status
  if (after.summary !== before.summary) patch.summary = after.summary
  if (!same(after.tags, before.tags)) patch.tags = after.tags
  if (!same(after.links, before.links)) patch.links = after.links
  if (after.rating !== before.rating) patch.rating = after.rating
  if (after.notes !== before.notes) patch.notes = after.notes

  const a = attrsFromForm(fields, before.attrs)
  const b = attrsFromForm(fields, after.attrs)
  const attrs: Record<string, AttrValue | null> = {}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(k in b)) attrs[k] = null
    else if (!same(a[k], b[k])) attrs[k] = b[k]
  }
  if (Object.keys(attrs).length) patch.attrs = attrs
  return patch
}
