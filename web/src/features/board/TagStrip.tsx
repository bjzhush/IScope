import { useLayoutEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { fitTags } from '@/lib/fitTags'

// Tags may take up to this share of the card's title row.
const SHARE = 0.3
const GAP = 4 // gap-1

export const tagClass = 'h-4 px-1.5 text-[11px] font-normal text-muted-foreground'

// Right-aligned tags in the card's title row. Tags that do not fit collapse
// into "+N"; the details popover lists them all. An invisible copy of every
// tag is measured, and the fit is recomputed whenever the row resizes.
export function TagStrip({ tags }: { tags: string[] }) {
  const box = useRef<HTMLDivElement>(null)
  const measure = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(tags.length)

  useLayoutEffect(() => {
    const row = box.current?.parentElement
    const copies = measure.current
    if (!row || !copies) return
    const update = () => {
      const avail = row.clientWidth * SHARE
      // Not laid out (jsdom, hidden tab): show everything.
      if (avail <= 0) return setCount(tags.length)
      const els = Array.from(copies.children) as HTMLElement[]
      const plus = els.pop()!
      setCount(fitTags(els.map((e) => e.offsetWidth), plus.offsetWidth, GAP, avail))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(row)
    return () => ro.disconnect()
  }, [tags])

  if (tags.length === 0) return null
  const hidden = tags.length - count

  return (
    <div ref={box} className="flex max-w-[30%] shrink-0 justify-end gap-1 overflow-hidden">
      {tags.slice(0, count).map((t) => (
        <Badge key={t} variant="outline" className={tagClass}>
          {t}
        </Badge>
      ))}
      {hidden > 0 && (
        <Badge variant="outline" className={tagClass} aria-label={`另有 ${hidden} 个标签`}>
          +{hidden}
        </Badge>
      )}
      {/* Clipped to zero height so a long row never widens the column. */}
      <div aria-hidden className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden">
        <div ref={measure} className="flex w-max gap-1">
          {tags.map((t) => (
            <Badge key={t} variant="outline" className={tagClass}>
              {t}
            </Badge>
          ))}
          <Badge variant="outline" className={tagClass}>
            +{tags.length}
          </Badge>
        </div>
      </div>
    </div>
  )
}
