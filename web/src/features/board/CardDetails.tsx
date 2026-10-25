import { ExternalLink, Info } from 'lucide-react'
import type { Field, Item } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cardDetails } from '@/lib/format'
import { isHttpUrl } from '@/lib/schema'
import { tagClass } from './TagStrip'

// Popups are portalled, but React events still bubble to the card through the
// component tree, so stop them here or a click would open the drawer.
const stop = (e: React.SyntheticEvent) => e.stopPropagation()

// Info button that shows the summary, card fields, all tags and the links. It opens on hover over the
// button itself, and a click pins it open (the only way on touch screens). With full (snapshot
// preview, where the drawer cannot open) it lists every field with a value and the notes too.
export function CardDetails({ item, fields, full = false }: { item: Item; fields: Field[]; full?: boolean }) {
  const details = cardDetails(fields, item, full)
  const links = item.links.filter((l) => isHttpUrl(l.url))
  const notes = full ? item.notes.trim() : ''
  if (!item.summary && details.length === 0 && item.tags.length === 0 && links.length === 0 && !notes) return null

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
        {links.length > 0 && (
          <ul className="grid gap-1 text-xs">
            {links.map((l, i) => (
              <li key={i}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={l.url}
                  className="inline-flex max-w-full items-center gap-1 text-primary underline-offset-2 hover:underline"
                >
                  <ExternalLink className="size-3 shrink-0" />
                  <span className="truncate">{l.label.trim() || l.url}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        {notes && (
          <div className="grid gap-0.5 border-t pt-2 text-xs">
            <span className="text-muted-foreground">笔记</span>
            <p className="whitespace-pre-wrap break-words">{notes}</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
