import type { Relation, RelationLink, RelationType } from '@/api/types'
import { otherEnd } from '@/lib/relations'
import { attrsFromForm, attrsToForm, buildAttrsSchema, type FormAttrs } from '@/lib/schema'

// Drawer-local state for one relation of the item being edited.
export interface RelationDraft {
  targetId: string
  type: RelationType
  attrs: FormAttrs
}

export function draftsFromRelations(
  itemId: string,
  relations: Relation[],
  types: RelationType[],
): RelationDraft[] {
  return relations.flatMap((r) => {
    const type = types.find((t) => t.key === r.type)
    return type ? [{ targetId: otherEnd(r, itemId), type, attrs: attrsToForm(type.fields, r.attrs) }] : []
  })
}

export function newDraft(targetId: string, type: RelationType): RelationDraft {
  return { targetId, type, attrs: attrsToForm(type.fields) }
}

// Field errors per relation, keyed by target id then attrs key.
export function draftErrors(drafts: RelationDraft[]): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>()
  for (const d of drafts) {
    const r = buildAttrsSchema(d.type.fields).safeParse(d.attrs)
    if (!r.success) {
      out.set(d.targetId, Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])))
    }
  }
  return out
}

const apiAttrs = (d: RelationDraft) => JSON.stringify(attrsFromForm(d.type.fields, d.attrs))

// PUT body: every current relation; attrs only where new or changed so the
// backend leaves untouched relations exactly as they are.
// Returns null when nothing changed.
export function relationsPayload(before: RelationDraft[], after: RelationDraft[]): RelationLink[] | null {
  const prev = new Map(before.map((d) => [d.targetId, apiAttrs(d)]))
  let changed = before.length !== after.length
  const links = after.map((d) => {
    const old = prev.get(d.targetId)
    const attrs = apiAttrs(d)
    if (old === attrs) return { targetId: d.targetId }
    changed = true
    return { targetId: d.targetId, attrs: attrsFromForm(d.type.fields, d.attrs) }
  })
  return changed ? links : null
}
