import { Pin } from 'lucide-react'
import type { Field, Item } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { cardMeta } from '@/lib/format'
import { statusBadgeClass, statusLabel } from '@/lib/status'
import type { ItemActions } from './actions'
import { ItemMenu } from './ItemMenu'

const MAX_TAGS = 3

// Hover linking: the hovered card, its direct neighbours, and everything else.
export type Emphasis = 'focus' | 'neighbor' | 'dim' | undefined

interface Props {
  item: Item
  fields: Field[]
  actions: ItemActions
  emphasis?: Emphasis
  onHover?: (id: string | null) => void
}

export function ItemCard({ item, fields, actions, emphasis, onHover }: Props) {
  const meta = cardMeta(fields, item)
  const extraTags = item.tags.length - MAX_TAGS

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={item.name}
      data-emphasis={emphasis}
      onClick={() => actions.edit(item)}
      onMouseEnter={() => onHover?.(item.id)}
      onMouseLeave={() => onHover?.(null)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          actions.edit(item)
        }
      }}
      className={cn(
        'group cursor-pointer rounded-lg border bg-card p-3 text-left shadow-xs transition-[opacity,border-color] outline-none hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring',
        emphasis === 'dim' ? 'opacity-30' : item.status === 'archived' && 'opacity-60',
        emphasis === 'neighbor' && 'border-primary ring-1 ring-primary',
      )}
    >
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate font-medium">{item.name}</h3>
        {item.pinned && <Pin aria-label="已置顶" className="size-3.5 shrink-0 text-muted-foreground" />}
        <Badge className={cn('shrink-0', statusBadgeClass[item.status])}>{statusLabel(item.status)}</Badge>
        <ItemMenu item={item} actions={actions} />
      </div>
      {item.summary && <p className="mt-1 truncate text-sm text-muted-foreground">{item.summary}</p>}
      {meta.length > 0 && <p className="mt-1 truncate text-xs text-muted-foreground">{meta.join(' · ')}</p>}
      {item.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.tags.slice(0, MAX_TAGS).map((t) => (
            <Badge key={t} variant="outline" className="font-normal">
              {t}
            </Badge>
          ))}
          {extraTags > 0 && (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              +{extraTags}
            </Badge>
          )}
        </div>
      )}
    </article>
  )
}
