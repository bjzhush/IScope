import { X } from 'lucide-react'
import type { Item, Kind } from '@/api/types'
import { KindIcon } from '@/components/KindIcon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { relationSummary } from '@/lib/relations'
import { attrsFromForm, type FormAttrs } from '@/lib/schema'
import { cn } from '@/lib/utils'
import { FieldControl } from './DynamicField'
import { FormRow } from './FormRow'
import type { RelationDraft } from './relationDrafts'
import { RelationPicker } from './RelationPicker'

interface Props {
  kind: Kind // the other end's kind
  drafts: RelationDraft[]
  itemsById: Map<string, Item>
  candidates: Item[]
  errors: Map<string, Record<string, string>>
  onAdd: (targetId: string) => void
  onRemove: (targetId: string) => void
  onAttrsChange: (targetId: string, attrs: FormAttrs) => void
}

export function RelationGroup({ kind, drafts, itemsById, candidates, errors, onAdd, onRemove, onAttrsChange }: Props) {
  return (
    <div className="grid gap-2" role="group" aria-label={`关联的 ${kind.label}`}>
      {/* The add button sits right after the title, so it never moves as chips wrap. */}
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <KindIcon name={kind.icon} className="size-3.5 text-muted-foreground" />
        {kind.label}
        <RelationPicker kind={kind} candidates={candidates} onPick={onAdd} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {drafts.length === 0 && <span className="text-sm text-muted-foreground">未关联</span>}
        {drafts.map((d) => (
          <RelationChip
            key={d.targetId}
            draft={d}
            name={itemsById.get(d.targetId)?.name ?? '（未知条目）'}
            errors={errors.get(d.targetId)}
            onRemove={() => onRemove(d.targetId)}
            onAttrsChange={(attrs) => onAttrsChange(d.targetId, attrs)}
          />
        ))}
      </div>
    </div>
  )
}

interface ChipProps {
  draft: RelationDraft
  name: string
  errors?: Record<string, string>
  onRemove: () => void
  onAttrsChange: (attrs: FormAttrs) => void
}

function RelationChip({ draft, name, errors, onRemove, onAttrsChange }: ChipProps) {
  const fields = draft.type.fields
  const summary = relationSummary(fields, attrsFromForm(fields, draft.attrs))
  const label = (
    <>
      <span className="max-w-40 truncate">{name}</span>
      {summary && <span className="text-muted-foreground">{summary}</span>}
    </>
  )
  const chipClass = cn(
    'inline-flex h-7 items-center gap-1.5 rounded-l-md border border-r-0 bg-secondary px-2 text-xs',
    errors && 'border-destructive text-destructive',
  )

  return (
    <span className="inline-flex">
      {fields.length > 0 ? (
        <Popover>
          <PopoverTrigger render={<button type="button" className={cn(chipClass, 'hover:bg-secondary/70')} />}>
            {label}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <p className="font-medium">
              {draft.type.label} {name}
            </p>
            {fields.map((f) => {
              const id = `rel-${draft.targetId}-${f.key}`
              return (
                <FormRow key={f.key} id={id} label={f.label} required={f.required} error={errors?.[f.key]}>
                  <FieldControl
                    field={f}
                    id={id}
                    value={draft.attrs[f.key]}
                    invalid={!!errors?.[f.key]}
                    onChange={(v) => onAttrsChange({ ...draft.attrs, [f.key]: v })}
                  />
                </FormRow>
              )
            })}
          </PopoverContent>
        </Popover>
      ) : (
        <span className={chipClass}>{label}</span>
      )}
      <button
        type="button"
        aria-label={`解除与 ${name} 的关联`}
        className="inline-flex h-7 items-center rounded-r-md border bg-secondary px-1 hover:bg-destructive/10 hover:text-destructive"
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </span>
  )
}
