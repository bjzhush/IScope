import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from './client'
import type { BoardView, CreateItemInput, ItemPatch, MoveInput, Relation, RelationLink } from './types'

export const queryKeys = {
  kinds: ['kinds'] as const,
  // Prefix ['board', key] matches every includeArchived variant.
  boardAll: (key: string) => ['board', key] as const,
  board: (key: string, includeArchived: boolean) => ['board', key, { includeArchived }] as const,
  item: (id: string) => ['item', id] as const,
}

export function useKinds() {
  return useQuery({ queryKey: queryKeys.kinds, queryFn: api.kinds, staleTime: Infinity })
}

export function useBoard(key: string, includeArchived: boolean) {
  return useQuery({
    queryKey: queryKeys.board(key, includeArchived),
    queryFn: () => api.board(key, includeArchived),
    // Keep cards on screen while a different board or archive setting loads.
    placeholderData: keepPreviousData,
  })
}

export function useItem(id: string | null) {
  return useQuery({
    queryKey: queryKeys.item(id ?? ''),
    queryFn: () => api.item(id!),
    enabled: !!id,
  })
}

function useInvalidateBoard(boardKey: string) {
  const qc = useQueryClient()
  return (itemId?: string) => {
    qc.invalidateQueries({ queryKey: queryKeys.boardAll(boardKey) })
    if (itemId) qc.invalidateQueries({ queryKey: queryKeys.item(itemId) })
  }
}

export function useCreateItem(boardKey: string) {
  const invalidate = useInvalidateBoard(boardKey)
  return useMutation({
    mutationFn: (input: CreateItemInput) => api.createItem(input),
    onSuccess: () => invalidate(),
  })
}

export function useUpdateItem(boardKey: string) {
  const invalidate = useInvalidateBoard(boardKey)
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ItemPatch }) => api.updateItem(id, patch),
    onSuccess: (_, { id }) => invalidate(id),
  })
}

export function useReplaceRelations(boardKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, links }: { id: string; links: RelationLink[] }) => api.replaceRelations(id, links),
    // Both ends change, so refresh every cached item detail as well as the board.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.boardAll(boardKey) })
      qc.invalidateQueries({ queryKey: ['item'] })
    },
  })
}

// Optimistic reorder within a column: the item takes its new sortOrder at once.
export function useMoveItem(boardKey: string) {
  const qc = useQueryClient()
  const invalidate = useInvalidateBoard(boardKey)
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MoveInput; sortOrder: number }) => api.moveItem(id, input),
    onMutate: async ({ id, sortOrder }) => {
      const prefix = queryKeys.boardAll(boardKey)
      await qc.cancelQueries({ queryKey: prefix })
      const snapshot = qc.getQueriesData<BoardView>({ queryKey: prefix })
      qc.setQueriesData<BoardView>({ queryKey: prefix }, (old) =>
        old && { ...old, items: old.items.map((it) => (it.id === id ? { ...it, sortOrder } : it)) },
      )
      return { snapshot }
    },
    onError: (e, _vars, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data))
      toast.error(`排序失败：${e.message}`)
    },
    onSettled: () => invalidate(),
  })
}

// Relation mode: replace the source's links with `targets`, updating the
// cached board relations at once.
export function useSetLinks(boardKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sourceId, targets }: { sourceId: string; targets: string[]; optimistic: Relation[] }) =>
      api.replaceRelations(
        sourceId,
        targets.map((targetId) => ({ targetId })),
      ),
    onMutate: async ({ sourceId, optimistic }) => {
      const prefix = queryKeys.boardAll(boardKey)
      await qc.cancelQueries({ queryKey: prefix })
      const snapshot = qc.getQueriesData<BoardView>({ queryKey: prefix })
      qc.setQueriesData<BoardView>({ queryKey: prefix }, (old) =>
        old && {
          ...old,
          relations: [...old.relations.filter((r) => r.fromId !== sourceId && r.toId !== sourceId), ...optimistic],
        },
      )
      return { snapshot }
    },
    onError: (e, _vars, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data))
      toast.error(`关联保存失败：${e.message}`)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.boardAll(boardKey) })
      qc.invalidateQueries({ queryKey: ['item'] })
    },
  })
}

export function useDeleteItem(boardKey: string) {
  const invalidate = useInvalidateBoard(boardKey)
  return useMutation({
    mutationFn: (id: string) => api.deleteItem(id),
    onSuccess: (_, id) => invalidate(id),
    onError: (e) => toast.error(`删除失败：${e.message}`),
  })
}

type QuickPatch = Pick<ItemPatch, 'status' | 'pinned'>

// Optimistic status / pin changes from the card menu; rolls back on failure.
export function useQuickUpdate(boardKey: string) {
  const qc = useQueryClient()
  const invalidate = useInvalidateBoard(boardKey)
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: QuickPatch }) => api.updateItem(id, patch),
    onMutate: async ({ id, patch }) => {
      const prefix = queryKeys.boardAll(boardKey)
      await qc.cancelQueries({ queryKey: prefix })
      const snapshot = qc.getQueriesData<BoardView>({ queryKey: prefix })
      qc.setQueriesData<BoardView>({ queryKey: prefix }, (old) =>
        old && { ...old, items: old.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) },
      )
      return { snapshot }
    },
    onError: (e, _vars, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data))
      toast.error(`更新失败：${e.message}`)
    },
    onSettled: (_data, _err, { id }) => invalidate(id),
  })
}
