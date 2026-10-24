import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import type { Status } from '@/api/types'
import type { BoardFilter } from '@/lib/filter'

const isFilterStatus = (s: string | null): s is Status => s === 'in_use' || s === 'watching'

// Board filters and the open drawer live in the URL so a reload keeps them:
// ?q=&status=in_use|watching&archived=1&focus=<id>&item=<id>|new=<kind>
export function useBoardFilters() {
  const [params, setParams] = useSearchParams()

  const filter: BoardFilter = useMemo(() => {
    const status = params.get('status')
    return {
      q: params.get('q') ?? '',
      status: isFilterStatus(status) ? status : '',
      showArchived: params.get('archived') === '1',
    }
  }, [params])

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
    setStatus: (s: Status | '') => update({ status: s }),
    setShowArchived: (on: boolean) => update({ archived: on ? '1' : null }),
    focusId: params.get('focus'),
    setFocus: (id: string | null) => update({ focus: id }),
    editingId: params.get('item'),
    newKind: params.get('new'),
    openItem: (id: string) => update({ item: id, new: null }),
    openNew: (kind: string) => update({ new: kind, item: null }),
    closeSheet: () => update({ item: null, new: null }),
  }
}
