import type { Field, Item, Status } from '@/api/types'
import { formatStatuses, matchesFilter, parseStatuses, statusCounts } from './filter'
import { cardDetails, formatFieldValue } from './format'
import { compareItems } from './sort'

const mk = (over: Partial<Item>): Item => ({
  id: 'x', kind: 'k', name: 'N', slug: 'n', status: 'watching', summary: '', tags: [], links: [],
  notes: '', rating: null, pinned: false, sortOrder: 1, attrs: {}, createdAt: '', updatedAt: '',
  ...over,
})

const fields: Field[] = [
  { key: 'form', label: '形态', type: 'select', showOnCard: true, options: [{ value: 'desktop', label: '桌面' }] },
  { key: 'open_source', label: '开源', type: 'bool', showOnCard: true },
  { key: 'ctx', label: '上下文', type: 'number', unit: 'tokens', showOnCard: true },
  { key: 'compat', label: '兼容', type: 'multiselect', options: [{ value: 'openai', label: 'OpenAI' }] },
  { key: 'vendor', label: '出品方', type: 'text' },
]

test('compareItems: pinned, then status, then sortOrder', () => {
  const items = [
    mk({ id: 'a', status: 'watching', sortOrder: 1 }),
    mk({ id: 'b', status: 'in_use', sortOrder: 5 }),
    mk({ id: 'c', status: 'archived', sortOrder: 0 }),
    mk({ id: 'd', status: 'watching', sortOrder: 9, pinned: true }),
    mk({ id: 'e', status: 'in_use', sortOrder: 2 }),
  ]
  expect(items.sort(compareItems).map((i) => i.id)).toEqual(['d', 'e', 'b', 'a', 'c'])
})

test('formatFieldValue and cardDetails follow field types', () => {
  expect(formatFieldValue(fields[0], 'desktop')).toBe('桌面')
  expect(formatFieldValue(fields[1], true)).toBe('开源')
  expect(formatFieldValue(fields[1], false)).toBeNull()
  expect(formatFieldValue(fields[2], 200000)).toBe('200,000 tokens')
  const it = mk({ attrs: { form: 'desktop', open_source: true, ctx: 1000, vendor: 'X' } })
  expect(cardDetails(fields, it)).toEqual([
    { label: '形态', value: '桌面' },
    { label: '开源', value: '是' },
    { label: '上下文', value: '1,000 tokens' },
  ])
  expect(cardDetails(fields, mk({ attrs: { open_source: false } }))).toEqual([])
})

describe('matchesFilter', () => {
  const it = mk({ name: 'Claude Code', summary: '终端 agent', tags: ['CLI'], attrs: { form: 'desktop', compat: ['openai'], vendor: 'Anthropic' } })
  const f = { q: '', statuses: ['in_use', 'watching'] as Status[] }

  test.each([
    ['claude', true],
    ['终端', true],
    ['cli', true],
    ['anthropic', true], // text attr
    ['桌面', true], // select label
    ['OPENAI', true], // multiselect value
    ['nothing', false],
  ])('q=%s → %s', (q, want) => {
    expect(matchesFilter(it, fields, { ...f, q })).toBe(want)
  })

  test('statuses', () => {
    expect(matchesFilter(it, fields, { ...f, statuses: ['in_use'] })).toBe(false)
    expect(matchesFilter(it, fields, { ...f, statuses: ['watching'] })).toBe(true)
    const archived = mk({ status: 'archived' })
    expect(matchesFilter(archived, fields, f)).toBe(false)
    expect(matchesFilter(archived, fields, { ...f, statuses: ['in_use', 'archived'] })).toBe(true)
  })
})

test.each([
  [null, false, ['in_use', 'watching'], null],
  ['archived,in_use', false, ['in_use', 'archived'], 'in_use,archived'], // canonical order
  ['in_use,watching,archived', false, ['in_use', 'watching', 'archived'], 'in_use,watching,archived'],
  ['in_use', false, ['in_use'], 'in_use'], // older single-status link
  [null, true, ['in_use', 'watching', 'archived'], 'in_use,watching,archived'], // older ?archived=1
  ['watching', true, ['watching'], 'watching'], // ?archived=1 only widens the default
  ['bogus', false, ['in_use', 'watching'], null],
] as const)('parseStatuses(%s, %s) → %j, written as %s', (param, legacy, want, written) => {
  const got = parseStatuses(param, legacy)
  expect(got).toEqual(want)
  expect(formatStatuses(got)).toBe(written)
})

test('statusCounts counts search matches per status, only for board kinds', () => {
  const items = [
    mk({ id: 'a', status: 'in_use', name: 'Claude' }),
    mk({ id: 'b', status: 'archived', name: 'Claude Old' }),
    mk({ id: 'c', status: 'watching', name: 'Other' }),
    mk({ id: 'd', kind: 'elsewhere', status: 'in_use', name: 'Claude' }),
  ]
  const fieldsOf = (k: string) => (k === 'k' ? fields : undefined)
  expect(statusCounts(items, fieldsOf, '')).toEqual({ in_use: 1, watching: 1, archived: 1 })
  expect(statusCounts(items, fieldsOf, 'claude')).toEqual({ in_use: 1, watching: 0, archived: 1 })
})
