import { Search } from 'lucide-react'
import type { Status } from '@/api/types'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { BoardFilter } from '@/lib/filter'
import { STATUSES, statusDotClass, statusToggleClass } from '@/lib/status'
import { cn } from '@/lib/utils'

interface Props {
  title: string
  filter: BoardFilter
  onQuery: (q: string) => void
  counts: Record<Status, number>
  onStatuses: (s: Status[]) => void
  extra?: React.ReactNode
}

export function Toolbar({ title, filter, onQuery, counts, onStatuses, extra }: Props) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <h1 className="mr-auto text-lg font-semibold">{title}</h1>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="搜索"
          placeholder="搜索名称、描述、标签、字段"
          className="w-64 pl-8"
          value={filter.q}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      <ToggleGroup
        multiple
        variant="outline"
        aria-label="状态筛选"
        value={filter.statuses}
        onValueChange={(v) => {
          // At least one status stays selected, so the board never goes blank.
          if (v.length) onStatuses(v as Status[])
        }}
      >
        {STATUSES.map((s) => (
          <ToggleGroupItem key={s.value} value={s.value} className={statusToggleClass[s.value]}>
            <span aria-hidden className={cn('size-2 rounded-full', statusDotClass[s.value])} />
            {s.label}
            <span className="tabular-nums opacity-70">{counts[s.value]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {extra}
    </header>
  )
}
