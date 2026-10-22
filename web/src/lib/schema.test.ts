import type { Field, Item } from '@/api/types'
import { attrsFromForm, attrsToForm, buildAttrsSchema, buildItemSchema, diffPatch, itemToForm } from './schema'

// Same cases as internal/kind/validate_test.go, in form representation.
const fields: Field[] = [
  { key: 't', label: 't', type: 'text' },
  { key: 'n', label: 'n', type: 'number' },
  { key: 'ni', label: 'ni', type: 'number', integer: true, min: 1 },
  { key: 'b', label: 'b', type: 'bool' },
  { key: 's', label: 's', type: 'select', options: [{ value: 'a', label: 'A' }] },
  { key: 'ms', label: 'ms', type: 'multiselect', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] },
  { key: 'd', label: 'd', type: 'date' },
  { key: 'u', label: 'u', type: 'url' },
  { key: 'req', label: 'req', type: 'text', required: true },
  { key: 'reqms', label: 'reqms', type: 'multiselect', required: true, options: [{ value: 'x', label: 'X' }] },
]

const base = attrsToForm(fields, { req: 'r', reqms: ['x'] })
const schema = buildAttrsSchema(fields)
const errorKeys = (attrs: Record<string, unknown>) => {
  const r = schema.safeParse({ ...base, ...attrs })
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'))
}

describe('buildAttrsSchema', () => {
  it.each([
    ['text ok', { t: 'hello' }],
    ['number float', { n: '3.5' }],
    ['number negative', { n: '-2' }],
    ['integer at min', { ni: '1' }],
    ['bool', { b: true }],
    ['select', { s: 'a' }],
    ['multiselect', { ms: ['x', 'y'] }],
    ['date', { d: '2026-10-21' }],
    ['url http', { u: 'http://localhost:11434' }],
    ['empty optional', { u: '', n: '', s: '', ms: [] }],
  ])('accepts %s', (_, attrs) => {
    expect(errorKeys(attrs)).toEqual([])
  })

  it.each([
    ['number text', { n: 'abc' }, 'n'],
    ['integer float', { ni: '1.5' }, 'ni'],
    ['integer below min', { ni: '0' }, 'ni'],
    ['select unknown', { s: 'z' }, 's'],
    ['multiselect unknown', { ms: ['z'] }, 'ms'],
    ['multiselect duplicate', { ms: ['x', 'x'] }, 'ms'],
    ['date format', { d: '2026/10/21' }, 'd'],
    ['date invalid day', { d: '2026-02-30' }, 'd'],
    ['url ftp', { u: 'ftp://example.com' }, 'u'],
    ['url no scheme', { u: 'example.com' }, 'u'],
    ['required blank', { req: '  ' }, 'req'],
    ['required multiselect empty', { reqms: [] }, 'reqms'],
    ['unknown key', { nope: 'x' }, ''],
  ])('rejects %s', (_, attrs, key) => {
    expect(errorKeys(attrs)).toEqual([key])
  })

  it('uses the backend messages', () => {
    const r = schema.safeParse({ ...base, ni: '1.5', req: '' })
    expect(r.success).toBe(false)
    const msgs = Object.fromEntries(r.error!.issues.map((i) => [i.path.join('.'), i.message]))
    expect(msgs).toEqual({ ni: '必须是整数', req: '必填' })
  })
})

describe('item schema', () => {
  it('validates top-level fields', () => {
    const s = buildItemSchema([])
    const v = { ...itemToForm([]), name: ' ', links: [{ label: '', url: 'javascript:x' }] }
    const r = s.safeParse(v)
    expect(r.error?.issues.map((i) => i.path.join('.')).sort()).toEqual(['links.0.url', 'name'])
  })
})

describe('conversions and diff', () => {
  const item: Item = {
    id: '1', kind: 'k', name: 'A', slug: 'a', status: 'watching', summary: '', tags: ['x'], links: [],
    notes: '', rating: 3, pinned: false, sortOrder: 1, createdAt: '', updatedAt: '',
    attrs: { t: 'hi', ni: 128000, ms: ['y'], b: true },
  }

  it('round-trips attrs, omitting unset values', () => {
    const form = attrsToForm(fields, item.attrs)
    expect(form.ni).toBe('128000')
    expect(form.s).toBe('')
    expect(attrsFromForm(fields, form)).toEqual({ t: 'hi', ni: 128000, ms: ['y'], b: true })
  })

  it('patches only changed fields and nulls cleared attrs', () => {
    const before = itemToForm(fields, item)
    const after = {
      ...before,
      summary: 'new',
      rating: null,
      attrs: { ...before.attrs, t: '', n: '2.5', ms: ['y'] },
    }
    expect(diffPatch(fields, before, after)).toEqual({ summary: 'new', rating: null, attrs: { t: null, n: 2.5 } })
    expect(diffPatch(fields, before, itemToForm(fields, item))).toEqual({})
  })
})
