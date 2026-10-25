import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { Item, Kind } from '@/api/types'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface Props {
  kind: Kind
  candidates: Item[] // not yet linked, not archived
  onPick: (id: string) => void
}

// "+ 添加" next to a relation group's title: a searchable list of items that
// can still be linked. The group title names the kind, so the button does not.

export function RelationPicker({ kind, candidates, onPick }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="outline" size="xs" aria-label={`添加 ${kind.label}`} />}>
        <Plus /> 添加
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={`搜索 ${kind.label}`} />
          <CommandList>
            <CommandEmpty>没有可添加的 {kind.label}</CommandEmpty>
            <CommandGroup>
              {candidates.map((it) => (
                <CommandItem
                  key={it.id}
                  value={`${it.name} ${it.id}`}
                  onSelect={() => {
                    onPick(it.id)
                    setOpen(false)
                  }}
                >
                  {it.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
