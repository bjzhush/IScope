import type { AttrValue, Attrs, Field, Relation, RelationType } from '@/api/types'

// Direct neighbours of every item, built once per board load.
export function buildAdjacency(relations: Relation[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>()
  const add = (a: string, b: string) => {
    let s = adj.get(a)
    if (!s) adj.set(a, (s = new Set()))
    s.add(b)
  }
  for (const r of relations) {
    add(r.fromId, r.toId)
    add(r.toId, r.fromId)
  }
  return adj
}

// Focus mode: direct neighbours (layer 1) and their neighbours (layer 2). The
// second hop never lands in the focused item's own kind, so the chain runs
// outward across columns instead of back to the focused item's siblings.
export function focusLayers(
  adj: Map<string, Set<string>>,
  focusId: string,
  kindOf: (id: string) => string | undefined,
): Map<string, 1 | 2> {
  const layers = new Map<string, 1 | 2>()
  for (const id of adj.get(focusId) ?? []) layers.set(id, 1)
  const own = kindOf(focusId)
  for (const id of [...layers.keys()]) {
    for (const next of adj.get(id) ?? []) {
      if (next !== focusId && !layers.has(next) && kindOf(next) !== own) layers.set(next, 2)
    }
  }
  return layers
}

// The relation type linking two kinds, in either direction.
export function relationTypeBetween(types: RelationType[], a: string, b: string): RelationType | undefined {
  return types.find((t) => (t.fromKind === a && t.toKind === b) || (t.fromKind === b && t.toKind === a))
}

export const otherEnd = (r: Relation, id: string) => (r.fromId === id ? r.toId : r.fromId)

function chipValue(f: Field, v: AttrValue | undefined): string | null {
  if (v === undefined || v === null || v === '') return null
  switch (f.type) {
    case 'bool':
      return v === true ? (f.shortLabel ?? f.label) : null
    case 'number':
      return `${f.prefix ?? ''}${v}`
    case 'select':
      return f.options?.find((o) => o.value === v)?.label ?? String(v)
    case 'multiselect':
      return Array.isArray(v) && v.length ? v.join(', ') : null
    default:
      return String(v)
  }
}

// Compact summary of relation attrs for a chip, e.g. "$3 / $15" or "默认".
export function relationSummary(fields: Field[], attrs: Attrs): string {
  return fields
    .filter((f) => f.showOnCard)
    .map((f) => chipValue(f, attrs[f.key]))
    .filter((s): s is string => s !== null)
    .join(' / ')
}
