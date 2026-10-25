import { ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import type { CatalogProvider } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface Props {
  providers: CatalogProvider[]
  value: string // provider id, '' for all
  onChange: (id: string) => void
}

// Plain substring match on name and id ("anth" finds Anthropic), not cmdk's
// fuzzy score, which also ranks unrelated names that merely share letters.
const contains = (value: string, search: string) => (value.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0)

// The catalog has a couple of hundred providers, so the filter is searchable.
export function ProviderFilter({ providers, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const current = providers.find((p) => p.id === value)
  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" variant="outline" aria-label="按渠道筛选" className="w-48 justify-between font-normal" />}
      >
        <span className="truncate">{current ? `${current.name}（${current.count}）` : '全部渠道'}</span>
        <ChevronsUpDown className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="end">
        <Command filter={contains}>
          <CommandInput placeholder="搜索渠道" aria-label="搜索渠道" />
          <CommandList>
            <CommandEmpty>没有匹配的渠道</CommandEmpty>
            <CommandItem value="全部渠道" data-checked={value === ''} onSelect={() => pick('')}>
              全部渠道
            </CommandItem>
            {providers.map((p) => (
              <CommandItem key={p.id} value={`${p.name} ${p.id}`} data-checked={p.id === value} onSelect={() => pick(p.id)}>
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{p.count}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
