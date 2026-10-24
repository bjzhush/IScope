import type { Field, Relation, RelationType } from '@/api/types'
import { draftsFromRelations, newDraft, relationsPayload } from '@/features/editor/relationDrafts'
import { buildAdjacency, focusLayers, relationSummary, relationTypeBetween } from './relations'

const rel = (id: string, fromId: string, toId: string, type = 'offered_by', attrs = {}): Relation => ({
  id, type, fromId, toId, attrs, createdAt: '', updatedAt: '',
})

const offered: RelationType = {
  key: 'offered_by', fromKind: 'model', toKind: 'provider', label: '可通过',
  fields: [
    { key: 'provider_model_id', label: '渠道内模型 ID', type: 'text' },
    { key: 'input_price', label: '输入价格', type: 'number', prefix: '$', showOnCard: true },
    { key: 'output_price', label: '输出价格', type: 'number', prefix: '$', showOnCard: true },
  ],
}
const uses: RelationType = {
  key: 'uses', fromKind: 'harness', toKind: 'model', label: '使用',
  fields: [{ key: 'is_default', label: '默认模型', type: 'bool', shortLabel: '默认', showOnCard: true }],
}

test('buildAdjacency links both directions', () => {
  const adj = buildAdjacency([rel('1', 'm', 'p'), rel('2', 'h', 'm', 'uses')])
  expect([...adj.get('m')!].sort()).toEqual(['h', 'p'])
  expect([...adj.get('p')!]).toEqual(['m'])
  expect(adj.get('x')).toBeUndefined()
})

test('focusLayers: direct neighbours, then one more hop outward', () => {
  // Harnesses h1 h2, models m1 m2, providers p1 p2.
  // h1 uses m1; h2 uses m1 and m2; m1 offered by p1; m2 offered by p2.
  const adj = buildAdjacency([
    rel('1', 'h1', 'm1', 'uses'), rel('2', 'h2', 'm1', 'uses'), rel('3', 'h2', 'm2', 'uses'),
    rel('4', 'm1', 'p1'), rel('5', 'm2', 'p2'),
  ])
  const kindOf = (id: string) => ({ h: 'harness', m: 'model', p: 'provider' })[id[0]]
  const layers = (id: string) => Object.fromEntries(focusLayers(adj, id, kindOf))

  // h2 shares m1 but is a harness like h1, so it is not pulled in.
  expect(layers('h1')).toEqual({ m1: 1, p1: 2 })
  // From a model both sides are direct; their other models are the focus's kind.
  expect(layers('m1')).toEqual({ h1: 1, h2: 1, p1: 1 })
  expect(layers('p2')).toEqual({ m2: 1, h2: 2 })
  expect(layers('lonely')).toEqual({})
})

test('relationTypeBetween works from either end', () => {
  expect(relationTypeBetween([offered, uses], 'provider', 'model')?.key).toBe('offered_by')
  expect(relationTypeBetween([offered, uses], 'model', 'harness')?.key).toBe('uses')
  expect(relationTypeBetween([offered, uses], 'model', 'model')).toBeUndefined()
})

test('relationSummary uses field definitions', () => {
  expect(relationSummary(offered.fields, { input_price: 3, output_price: 15, provider_model_id: 'x' })).toBe('$3 / $15')
  expect(relationSummary(uses.fields as Field[], { is_default: true })).toBe('默认')
  expect(relationSummary(uses.fields as Field[], { is_default: false })).toBe('')
})

describe('relationsPayload', () => {
  const before = draftsFromRelations('m', [rel('1', 'm', 'p1', 'offered_by', { input_price: 3 }), rel('2', 'm', 'p2')], [offered])

  test('unchanged → null', () => {
    expect(relationsPayload(before, before.map((d) => ({ ...d, attrs: { ...d.attrs } })))).toBeNull()
  })

  test('sends attrs only for new or changed relations', () => {
    const after = [
      { ...before[0], attrs: { ...before[0].attrs, output_price: '15' } }, // changed
      before[1], // untouched
      newDraft('p3', offered), // new
    ]
    expect(relationsPayload(before, after)).toEqual([
      { targetId: 'p1', attrs: { input_price: 3, output_price: 15 } },
      { targetId: 'p2' },
      { targetId: 'p3', attrs: {} },
    ])
  })

  test('removal alone is a change', () => {
    expect(relationsPayload(before, [before[1]])).toEqual([{ targetId: 'p2' }])
  })
})
