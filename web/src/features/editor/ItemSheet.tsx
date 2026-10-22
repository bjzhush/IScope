import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FormProvider, useForm, type Path, type Resolver } from 'react-hook-form'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { useBoard, useCreateItem, useItem, useReplaceRelations, useUpdateItem } from '@/api/queries'
import type { Item, ItemDetail, Kind, RelationType, Status } from '@/api/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { relationTypeBetween } from '@/lib/relations'
import { buildItemSchema, diffPatch, itemToForm, toCreateInput, type ItemFormValues } from '@/lib/schema'
import { BasicFields } from './BasicFields'
import { DynamicField } from './DynamicField'
import { draftErrors, draftsFromRelations, newDraft, relationsPayload } from './relationDrafts'
import { RelationGroup } from './RelationGroup'

interface Props {
  boardKey: string
  kinds: Map<string, Kind>
  columns: string[]
  relationTypes: RelationType[]
  editingId: string | null
  newKind: string | null
  onClose: () => void
}

export function ItemSheet({ boardKey, kinds, columns, relationTypes, editingId, newKind, onClose }: Props) {
  const open = !!editingId || !!newKind
  const detail = useItem(editingId)
  // Names and candidates for relations, archived items included.
  const lookup = useBoard(boardKey, true)
  const dirty = useRef(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const close = () => {
    dirty.current = false
    setConfirmDiscard(false)
    onClose()
  }
  const requestClose = () => (dirty.current ? setConfirmDiscard(true) : close())

  const item = editingId ? detail.data : undefined
  const kind = kinds.get(editingId ? (item?.kind ?? '') : (newKind ?? ''))

  let body: React.ReactNode
  // Wait for a fetch made after opening: the cache may hold a version from
  // before another save, and the form only reads its data once.
  const stale = !!editingId && !detail.isFetchedAfterMount && !detail.error
  if (stale || lookup.isPending) body = <SheetMessage title="加载中…" />
  else if (editingId && detail.error) body = <SheetMessage title="无法打开条目" text={detail.error.message} />
  else if (!kind) body = <SheetMessage title="未知的类型" text={newKind ?? item?.kind} />
  else
    body = (
      <ItemForm
        key={editingId ?? `new:${newKind}`}
        boardKey={boardKey}
        kind={kind}
        kinds={kinds}
        columns={columns}
        relationTypes={relationTypes}
        boardItems={lookup.data?.items ?? []}
        item={item}
        onDirtyChange={(d) => {
          dirty.current = d
        }}
        onDone={close}
        onCancel={requestClose}
      />
    )

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && requestClose()}>
        <SheetContent className="w-full gap-0 p-0 data-[side=right]:sm:max-w-[480px]">{body}</SheetContent>
      </Sheet>
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
            <AlertDialogDescription>关闭后，本次在抽屉中的修改不会保存。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={close}>
              放弃修改
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function SheetMessage({ title, text }: { title: string; text?: string }) {
  return (
    <SheetHeader>
      <SheetTitle>{title}</SheetTitle>
      {text && <SheetDescription>{text}</SheetDescription>}
    </SheetHeader>
  )
}

const BASE_PATHS = new Set(['name', 'status', 'summary', 'tags', 'links', 'rating', 'notes'])

interface FormProps {
  boardKey: string
  kind: Kind
  kinds: Map<string, Kind>
  columns: string[]
  relationTypes: RelationType[]
  boardItems: Item[] // every item of the board, archived included
  item?: ItemDetail
  onDirtyChange: (dirty: boolean) => void
  onDone: () => void
  onCancel: () => void
}

function ItemForm(props: FormProps) {
  const { boardKey, kind, kinds, columns, relationTypes, boardItems, item, onDirtyChange, onDone, onCancel } = props
  const schema = useMemo(() => buildItemSchema(kind.fields), [kind.fields])
  const initial = useMemo(() => itemToForm(kind.fields, item), [kind.fields, item])
  const form = useForm<ItemFormValues>({
    resolver: zodResolver(schema) as Resolver<ItemFormValues>,
    defaultValues: initial,
  })
  const create = useCreateItem(boardKey)
  const update = useUpdateItem(boardKey)
  const replace = useReplaceRelations(boardKey)
  const [formError, setFormError] = useState<string | null>(null)
  const busy = create.isPending || update.isPending || replace.isPending

  // Relations are drawer-local until 保存. The baselines move forward after
  // each successful step so a retry only resends what is still unsaved.
  const initialDrafts = useMemo(
    () => (item ? draftsFromRelations(item.id, item.relations, relationTypes) : []),
    [item, relationTypes],
  )
  const [drafts, setDrafts] = useState(initialDrafts)
  const savedId = useRef(item?.id)
  const savedValues = useRef(initial)
  const savedDrafts = useRef(initialDrafts)
  const relErrors = useMemo(() => draftErrors(drafts), [drafts])

  const groups = useMemo(
    () =>
      columns.flatMap((col) => {
        const other = kinds.get(col)
        const type = col === kind.key ? undefined : relationTypeBetween(relationTypes, kind.key, col)
        return other && type ? [{ kind: other, type }] : []
      }),
    [columns, kinds, kind.key, relationTypes],
  )
  const itemsById = useMemo(() => new Map(boardItems.map((it) => [it.id, it])), [boardItems])

  const { isDirty } = form.formState
  const relationsDirty = relationsPayload(initialDrafts, drafts) !== null
  useEffect(() => {
    onDirtyChange(isDirty || relationsDirty)
  }, [onDirtyChange, isDirty, relationsDirty])

  // Field errors from the server land under the matching input; anything that
  // has no input in the form is shown at the bottom.
  const applyServerError = (e: unknown) => {
    if (!(e instanceof ApiError)) {
      setFormError(e instanceof Error ? e.message : String(e))
      return
    }
    const rest: string[] = []
    for (const [path, msg] of Object.entries(e.fields)) {
      const known =
        BASE_PATHS.has(path) ||
        /^links\.\d+\.(url|label)$/.test(path) ||
        (path.startsWith('attrs.') && kind.fields.some((f) => `attrs.${f.key}` === path))
      if (known) form.setError(path as Path<ItemFormValues>, { type: 'server', message: msg })
      else rest.push(`${path}：${msg}`)
    }
    setFormError(rest.length ? rest.join('；') : Object.keys(e.fields).length ? null : e.message)
  }

  const save = (status?: Status) =>
    form.handleSubmit(async (values) => {
      setFormError(null)
      if (relErrors.size) {
        setFormError('请检查标红的关联属性')
        return
      }
      const v = status ? { ...values, status } : values

      // Step 1: the item itself.
      let id = savedId.current
      try {
        if (!id) {
          id = (await create.mutateAsync(toCreateInput(kind.key, kind.fields, v))).id
          savedId.current = id
        } else {
          const patch = diffPatch(kind.fields, savedValues.current, v)
          if (Object.keys(patch).length) await update.mutateAsync({ id, patch })
        }
        savedValues.current = v
      } catch (e) {
        applyServerError(e)
        return
      }

      // Step 2: relations, only when they changed.
      const links = relationsPayload(savedDrafts.current, drafts)
      if (links) {
        try {
          await replace.mutateAsync({ id, links })
          savedDrafts.current = drafts
        } catch (e) {
          setFormError(`条目已保存，关联保存失败：${e instanceof Error ? e.message : String(e)}。可再次点击保存重试。`)
          return
        }
      }
      toast.success(item ? '已保存' : `已新增 ${v.name.trim()}`)
      onDone()
    })

  const archived = item?.status === 'archived'
  return (
    <FormProvider {...form}>
      <form className="flex h-full min-h-0 flex-col" onSubmit={(e) => save()(e)} noValidate>
        <SheetHeader className="border-b">
          <SheetTitle>{item ? `编辑 ${item.name}` : `新增 ${kind.label}`}</SheetTitle>
          <SheetDescription>{kind.label}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">基本信息</h3>
          <BasicFields />
          {kind.fields.length > 0 && (
            <>
              <Separator className="my-5" />
              <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{kind.label} 字段</h3>
              <div className="grid gap-4">
                {kind.fields.map((f) => (
                  <DynamicField key={f.key} field={f} />
                ))}
              </div>
            </>
          )}
          {groups.length > 0 && (
            <>
              <Separator className="my-5" />
              <h3 className="mb-3 text-sm font-semibold text-muted-foreground">关联</h3>
              <div className="grid gap-4">
                {groups.map(({ kind: other, type }) => {
                  const mine = drafts.filter((d) => itemsById.get(d.targetId)?.kind === other.key)
                  const linked = new Set(drafts.map((d) => d.targetId))
                  return (
                    <RelationGroup
                      key={other.key}
                      kind={other}
                      drafts={mine}
                      itemsById={itemsById}
                      candidates={boardItems.filter(
                        (it) => it.kind === other.key && it.status !== 'archived' && !linked.has(it.id),
                      )}
                      errors={relErrors}
                      onAdd={(targetId) => setDrafts((ds) => [...ds, newDraft(targetId, type)])}
                      onRemove={(targetId) => setDrafts((ds) => ds.filter((d) => d.targetId !== targetId))}
                      onAttrsChange={(targetId, attrs) =>
                        setDrafts((ds) => ds.map((d) => (d.targetId === targetId ? { ...d, attrs } : d)))
                      }
                    />
                  )
                })}
              </div>
            </>
          )}
        </div>

        <footer className="grid gap-2 border-t px-4 py-3">
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <div className="flex items-center gap-2">
            {item && (
              <Button type="button" variant="outline" disabled={busy} onClick={(e) => save(archived ? 'watching' : 'archived')(e)}>
                {archived ? '恢复' : '弃用'}
              </Button>
            )}
            <Button type="button" variant="ghost" className="ml-auto" onClick={onCancel}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '保存中…' : '保存'}
            </Button>
          </div>
        </footer>
      </form>
    </FormProvider>
  )
}
