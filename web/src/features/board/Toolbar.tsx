import { Search } from 'lucide-react'
import type { Status } from '@/api/types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { BoardFilter } from '@/lib/filter'

const STATUS_FILTERS: { value: Status | ''; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'in_use', label: '使用中' },
  { value: 'watching', label: '关注中' },
]

interface Props {
  title: string
  filter: BoardFilter
  onQuery: (q: string) => void
  onStatus: (s: Status | '') => void
  onShowArchived: (on: boolean) => void
}

export function Toolbar({ title, filter, onQuery, onStatus, onShowArchived }: Props) {
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
        variant="outline"
        aria-label="状态筛选"
        value={[filter.status]}
        onValueChange={(v) => {
          // Single choice: clicking the pressed item again keeps it selected.
          if (v.length) onStatus(v[v.length - 1] as Status | '')
        }}
      >
        {STATUS_FILTERS.map((s) => (
          <ToggleGroupItem key={s.value} value={s.value}>
            {s.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="flex items-center gap-2">
        <Switch id="show-archived" checked={filter.showArchived} onCheckedChange={onShowArchived} />
        <Label htmlFor="show-archived">显示已弃用</Label>
      </div>
    </header>
  )
}
