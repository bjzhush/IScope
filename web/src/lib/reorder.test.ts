import type { Item } from '@/api/types'
import { compareItems } from './sort'
import { planMove } from './reorder'

const mk = (id: string, sortOrder: number, over: Partial<Item> = {}): Item => ({
  id, kind: 'k', name: id, slug: id, status: 'watching', summary: '', tags: [], links: [], notes: '',
  rating: null, pinned: false, sortOrder, attrs: {}, createdAt: '', updatedAt: '', ...over,
})

// Displayed order: pinned P, in_use U1 U2, watching A B C, archived Z.
const column = [
  mk('P', 9, { pinned: true }),
  mk('U1', 1, { status: 'in_use' }),
  mk('U2', 2, { status: 'in_use' }),
  mk('A', 1),
  mk('B', 2),
  mk('C', 4),
  mk('Z', 0, { status: 'archived' }),
].sort(compareItems)

test('moving down places the card between its new neighbours', () => {
  expect(planMove(column, 'A', 'B')).toEqual({ input: { beforeId: 'B', afterId: 'C' }, sortOrder: 3 })
})

test('moving up to the top of its group', () => {
  expect(planMove(column, 'C', 'A')).toEqual({ input: { beforeId: null, afterId: 'A' }, sortOrder: 0 })
})

test('moving to the bottom of its group', () => {
  expect(planMove(column, 'A', 'C')).toEqual({ input: { beforeId: 'C', afterId: null }, sortOrder: 5 })
})

test('the planned sortOrder keeps the displayed order consistent', () => {
  const plan = planMove(column, 'C', 'B')!
  const after = column.map((it) => (it.id === 'C' ? { ...it, sortOrder: plan.sortOrder } : it)).sort(compareItems)
  expect(after.map((it) => it.id)).toEqual(['P', 'U1', 'U2', 'A', 'C', 'B', 'Z'])
})

test.each([
  ['across status groups', 'A', 'U1'],
  ['onto a pinned card', 'B', 'P'],
  ['onto an archived card', 'C', 'Z'],
  ['onto itself', 'A', 'A'],
  ['alone in its group', 'P', 'P'],
])('no move %s', (_, a, b) => {
  expect(planMove(column, a, b)).toBeNull()
})
