import { Info } from 'lucide-react'
import type { Field, Item } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cardDetails } from '@/lib/format'
import { tagClass } from './TagStrip'

// Popups are portalled, but React events still bubble to the card through the
// component tree, so stop them here or a click would open the drawer.
const stop = (e: React.SyntheticEvent) => e.stopPropagation()

// Info button that shows the summary, card fields and all tags. It opens on hover over the
// button itself, and a click pins it open (the only way on touch screens).
export function CardDetails({ item, fields }: { item: Item; fields: Field[] }) {
  const details = cardDetails(fields, item)
  if (!item.summary && details.length === 0 && item.tags.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        aria-label={`${item.name} 详情`}
        onClick={stop}
        className="shrink-0 rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:text-foreground"
      >
        <Info className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-2" onClick={stop}>
        {item.summary && <p className="whitespace-pre-wrap break-words">{item.summary}</p>}
        {details.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {details.map((d) => (
              <div key={d.label} className="contents">
                <dt className="text-muted-foreground">{d.label}</dt>
                <dd className="break-words">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.map((t) => (
              <Badge key={t} variant="outline" className={tagClass}>
                {t}
              </Badge>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
