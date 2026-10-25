import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import type { Status } from '@/api/types'
import { type BoardFilter, formatStatuses, parseStatuses } from '@/lib/filter'

// Board filters and the open drawer live in the URL so a reload keeps them:
// ?q=&status=<comma-separated statuses>&focus=<id>&item=<id>|new=<kind>
export function useBoardFilters() {
  const [params, setParams] = useSearchParams()

  const filter: BoardFilter = useMemo(
    () => ({
      q: params.get('q') ?? '',
      statuses: parseStatuses(params.get('status'), params.get('archived') === '1'),
    }),
    [params],
  )

  const update = useCallback(
    (changes: Record<string, string | null>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(changes)) {
            if (v) next.set(k, v)
            else next.delete(k)
          }
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  return {
    filter,
    setQuery: (q: string) => update({ q }),
    setStatuses: (s: Status[]) => update({ status: formatStatuses(s), archived: null }),
    focusId: params.get('focus'),
    setFocus: (id: string | null) => update({ focus: id }),
    editingId: params.get('item'),
    newKind: params.get('new'),
    openItem: (id: string) => update({ item: id, new: null }),
    openNew: (kind: string) => update({ new: kind, item: null }),
    closeSheet: () => update({ item: null, new: null }),
  }
}
