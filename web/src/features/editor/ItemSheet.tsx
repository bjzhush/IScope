import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FormProvider, useForm, type Path, type Resolver } from 'react-hook-form'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { useCreateItem, useItem, useUpdateItem } from '@/api/queries'
import type { Item, Kind, Status } from '@/api/types'
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
import { buildItemSchema, diffPatch, itemToForm, toCreateInput, type ItemFormValues } from '@/lib/schema'
import { BasicFields } from './BasicFields'
import { DynamicField } from './DynamicField'

interface Props {
  boardKey: string
  kinds: Map<string, Kind>
  editingId: string | null
  newKind: string | null
  onClose: () => void
}

export function ItemSheet({ boardKey, kinds, editingId, newKind, onClose }: Props) {
  const open = !!editingId || !!newKind
  const detail = useItem(editingId)
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
  if (editingId && detail.isPending) body = <SheetMessage title="加载中…" />
  else if (editingId && detail.error) body = <SheetMessage title="无法打开条目" text={detail.error.message} />
  else if (!kind) body = <SheetMessage title="未知的类型" text={newKind ?? item?.kind} />
  else
    body = (
      <ItemForm
        key={editingId ?? `new:${newKind}`}
        boardKey={boardKey}
        kind={kind}
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
  item?: Item
  onDirtyChange: (dirty: boolean) => void
  onDone: () => void
  onCancel: () => void
}

function ItemForm({ boardKey, kind, item, onDirtyChange, onDone, onCancel }: FormProps) {
  const schema = useMemo(() => buildItemSchema(kind.fields), [kind.fields])
  const initial = useMemo(() => itemToForm(kind.fields, item), [kind.fields, item])
  const form = useForm<ItemFormValues>({
    resolver: zodResolver(schema) as Resolver<ItemFormValues>,
    defaultValues: initial,
  })
  const create = useCreateItem(boardKey)
  const update = useUpdateItem(boardKey)
  const [formError, setFormError] = useState<string | null>(null)
  const busy = create.isPending || update.isPending

  const { isDirty } = form.formState
  useEffect(() => {
    onDirtyChange(isDirty)
  }, [onDirtyChange, isDirty])

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
      const v = status ? { ...values, status } : values
      try {
        if (item) {
          const patch = diffPatch(kind.fields, initial, v)
          if (Object.keys(patch).length) await update.mutateAsync({ id: item.id, patch })
        } else {
          await create.mutateAsync(toCreateInput(kind.key, kind.fields, v))
        }
        toast.success(item ? '已保存' : `已新增 ${v.name.trim()}`)
        onDone()
      } catch (e) {
        applyServerError(e)
      }
    })

  const archived = item?.status === 'archived'
  return (
    <FormProvider {...form}>
      <form className="flex h-full min-h-0 flex-col" onSubmit={save()} noValidate>
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
        </div>

        <footer className="grid gap-2 border-t px-4 py-3">
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <div className="flex items-center gap-2">
            {item && (
              <Button type="button" variant="outline" disabled={busy} onClick={save(archived ? 'watching' : 'archived')}>
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
