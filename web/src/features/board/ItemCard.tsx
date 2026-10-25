import { GripVertical, Pin } from 'lucide-react'
import type { Field, Item } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { statusBadgeClass, statusLabel } from '@/lib/status'
import type { ItemActions } from './actions'
import { CardDetails } from './CardDetails'
import { ItemMenu } from './ItemMenu'
import { TagStrip } from './TagStrip'

// Hover linking: the hovered card, its direct neighbours, and everything else.
// Relation and focus mode mark their source as selected; focus mode also shows
// second-hop items as indirect.
export type Emphasis = 'focus' | 'selected' | 'neighbor' | 'indirect' | 'dim' | undefined

// In relation mode a card of a relatable column is a checkbox.
export interface Selectable {
  checked: boolean
  onToggle: () => void
}

export interface ItemCardProps {
  item: Item
  fields: Field[]
  actions: ItemActions
  emphasis?: Emphasis
  onHover?: (id: string | null) => void
  select?: Selectable
  // Relation mode: no menu, no drawer, no dragging.
  linking?: boolean
  // Snapshot preview: not clickable, full details, and a menu with 聚焦关联 only.
  readOnly?: boolean
  // Supplied by the sortable wrapper.
  ref?: React.Ref<HTMLElement>
  style?: React.CSSProperties
  dragging?: boolean
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>
  // Why the card has no handle although sorting is on (alone in its group).
  dragHint?: string
}

export function ItemCard(props: ItemCardProps) {
  const { item, fields, actions, emphasis, onHover, select, linking, readOnly, ref, style, dragging, dragHandleProps, dragHint } =
    props
  const activate = () => {
    if (select) select.onToggle()
    else if (!linking && !readOnly) actions.edit(item)
  }

  return (
    <article
      ref={ref}
      style={style}
      role={select ? 'checkbox' : readOnly ? undefined : 'button'}
      aria-checked={select ? select.checked : undefined}
      tabIndex={readOnly || (linking && !select) ? -1 : 0}
      aria-label={item.name}
      data-emphasis={emphasis}
      data-item-id={item.id}
      onClick={activate}
      onMouseEnter={() => onHover?.(item.id)}
      onMouseLeave={() => onHover?.(null)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          activate()
        }
      }}
      className={cn(
        'group relative cursor-pointer rounded-lg border bg-card px-3 py-2 text-left shadow-xs transition-[opacity,border-color] outline-none hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring',
        emphasis === 'dim' ? 'opacity-30' : item.status === 'archived' && 'opacity-60',
        emphasis === 'neighbor' && 'border-primary ring-1 ring-primary',
        emphasis === 'selected' && 'border-primary ring-2 ring-primary',
        emphasis === 'indirect' && 'border-dashed border-primary/70',
        select?.checked && 'border-primary bg-primary/5',
        ((linking && !select) || readOnly) && 'cursor-default',
        dragging && 'z-10 opacity-80 shadow-lg',
      )}
    >
      <div className="flex items-center gap-2">
        {select ? (
          <Checkbox checked={select.checked} tabIndex={-1} aria-hidden className="pointer-events-none" />
        ) : dragHandleProps && !linking ? (
          <button
            type="button"
            aria-label={`拖动 ${item.name}`}
            className="-ml-1.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
            {...dragHandleProps}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="size-3.5" />
          </button>
        ) : dragHint ? (
          // A greyed-out handle that explains why this card cannot be dragged.
          <Tooltip>
            <TooltipTrigger
              render={<span data-handle="blocked" aria-label={dragHint} onClick={(e) => e.stopPropagation()} />}
              className="-ml-1.5 shrink-0 cursor-not-allowed rounded p-0.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100"
            >
              <GripVertical className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>{dragHint}</TooltipContent>
          </Tooltip>
        ) : (
          // Same footprint as the handle, so names line up whether or not a card can be dragged.
          <span aria-hidden data-handle="space" className="-ml-1.5 size-4.5 shrink-0" />
        )}
        <h3 className="min-w-0 flex-1 truncate font-medium">{item.name}</h3>
        <TagStrip tags={item.tags} />
        <CardDetails item={item} fields={fields} full={readOnly} />
        {item.pinned && <Pin aria-label="已置顶" className="size-3.5 shrink-0 text-muted-foreground" />}
        <Badge className={cn('shrink-0', statusBadgeClass[item.status])}>{statusLabel(item.status)}</Badge>
        {!linking && <ItemMenu item={item} actions={actions} readOnly={readOnly} />}
      </div>
    </article>
  )
}
