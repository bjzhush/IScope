import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { Item, Kind, RelationType } from '@/api/types'
import { draftErrors, newDraft, type RelationDraft } from './relationDrafts'
import { RelationGroup } from './RelationGroup'

const provider: Kind = { key: 'provider', label: 'Provider', icon: 'cloud', fields: [] }
const offered: RelationType = {
  key: 'offered_by', fromKind: 'model', toKind: 'provider', label: '可通过',
  fields: [
    { key: 'input_price', label: '输入价格', type: 'number', prefix: '$', min: 0, showOnCard: true },
    { key: 'output_price', label: '输出价格', type: 'number', prefix: '$', min: 0, showOnCard: true },
  ],
}
const mk = (id: string, name: string, status: Item['status'] = 'watching'): Item => ({
  id, kind: 'provider', name, slug: id, status, summary: '', tags: [], links: [], notes: '',
  rating: null, pinned: false, sortOrder: 0, attrs: {}, createdAt: '', updatedAt: '',
})
const all = [mk('p1', 'Anthropic API'), mk('p2', 'OpenRouter'), mk('p3', 'Old Cloud', 'archived')]

let latest: RelationDraft[] = []

function Harness({ initial }: { initial: RelationDraft[] }) {
  const [drafts, setDrafts] = useState(initial)
  latest = drafts
  const linked = new Set(drafts.map((d) => d.targetId))
  return (
    <RelationGroup
      kind={provider}
      drafts={drafts}
      itemsById={new Map(all.map((i) => [i.id, i]))}
      candidates={all.filter((i) => i.status !== 'archived' && !linked.has(i.id))}
      errors={draftErrors(drafts)}
      onAdd={(id) => setDrafts((ds) => [...ds, newDraft(id, offered)])}
      onRemove={(id) => setDrafts((ds) => ds.filter((d) => d.targetId !== id))}
      onAttrsChange={(id, attrs) => setDrafts((ds) => ds.map((d) => (d.targetId === id ? { ...d, attrs } : d)))}
    />
  )
}

test('picker lists only unlinked, non-archived items and adds the chosen one', async () => {
  const user = userEvent.setup()
  render(<Harness initial={[{ ...newDraft('p1', offered), attrs: { input_price: '3', output_price: '15' } }]} />)
  expect(screen.getByText('$3 / $15')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: /添加 Provider/ }))
  const options = await screen.findAllByRole('option')
  expect(options.map((o) => o.textContent)).toEqual(['OpenRouter'])
  await user.click(options[0])
  expect(latest.map((d) => d.targetId)).toEqual(['p1', 'p2'])

  // Everything linked: the picker says so.
  await user.click(screen.getByRole('button', { name: /添加 Provider/ }))
  expect(await screen.findByText('没有可添加的 Provider')).toBeInTheDocument()
})

test('× removes a relation', async () => {
  const user = userEvent.setup()
  render(<Harness initial={[newDraft('p1', offered), newDraft('p2', offered)]} />)
  await user.click(screen.getByRole('button', { name: '解除与 Anthropic API 的关联' }))
  expect(latest.map((d) => d.targetId)).toEqual(['p2'])
  expect(screen.queryByText('Anthropic API')).toBeNull()
})

test('chip popover edits relation attrs and shows validation errors', async () => {
  const user = userEvent.setup()
  render(<Harness initial={[newDraft('p1', offered)]} />)
  await user.click(screen.getByRole('button', { name: /^Anthropic API/ }))
  const pop = within(await screen.findByRole('dialog'))
  await user.type(pop.getByLabelText('输入价格'), '-1')
  expect(pop.getByText('不能小于 0')).toBeInTheDocument()
  await user.clear(pop.getByLabelText('输入价格'))
  await user.type(pop.getByLabelText('输入价格'), '3')
  expect(pop.queryByText('不能小于 0')).toBeNull()
  expect(latest[0].attrs.input_price).toBe('3')
})
