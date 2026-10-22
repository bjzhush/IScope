import { X } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

interface Props {
  id: string
  value: string[]
  onChange: (tags: string[]) => void
}

// Enter adds a tag; Backspace on an empty input removes the last one.
export function TagInput({ id, value, onChange }: Props) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const t = draft.trim()
    if (t && !value.includes(t)) onChange([...value, t])
    setDraft('')
  }

  return (
    <div className="grid gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((t) => (
            <Badge key={t} variant="secondary" className="gap-1 pr-1">
              {t}
              <button
                type="button"
                aria-label={`移除标签 ${t}`}
                className="rounded-sm hover:bg-foreground/10"
                onClick={() => onChange(value.filter((x) => x !== t))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        id={id}
        placeholder="输入后回车添加"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            add()
          } else if (e.key === 'Backspace' && draft === '' && value.length) {
            onChange(value.slice(0, -1))
          }
        }}
      />
    </div>
  )
}
