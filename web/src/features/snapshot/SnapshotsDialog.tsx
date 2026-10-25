import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { queryKeys } from '@/api/queries'
import type { SnapshotMeta } from '@/api/types'
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
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatLocalMinute } from '@/lib/format'

interface Props {
  boardKey: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SnapshotsDialog({ boardKey, open, onOpenChange }: Props) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [label, setLabel] = useState('')
  const [deleting, setDeleting] = useState<SnapshotMeta | null>(null)
  const list = useQuery({ queryKey: queryKeys.snapshots, queryFn: api.snapshots, enabled: open })

  const create = useMutation({
    mutationFn: () => api.createSnapshot(label),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: queryKeys.snapshots })
      setLabel('')
      toast.success(`已创建快照：${m.label}`)
    },
    onError: (e) => toast.error(`创建失败：${e.message}`),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSnapshot(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.snapshots }),
    onError: (e) => toast.error(`删除失败：${e.message}`),
  })

  const preview = (id: string) => {
    onOpenChange(false)
    navigate(`/boards/${encodeURIComponent(boardKey)}/snapshots/${encodeURIComponent(id)}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>快照</DialogTitle>
          <DialogDescription>
            快照保存整个看板当时的样子，可以只读预览，也可以下载 JSON 后用"导入 JSON"导回。导入 JSON 前会自动创建一份。
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <Input
            aria-label="快照说明"
            placeholder="说明（可选），如：改模型前"
            maxLength={100}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button type="submit" disabled={create.isPending}>
            <Camera /> 创建快照
          </Button>
        </form>

        <div className="min-h-32 flex-1 overflow-y-auto rounded-md border">
          {list.isPending && <p className="p-4 text-sm text-muted-foreground">加载中…</p>}
          {list.error && <p className="p-4 text-sm text-destructive">{list.error.message}</p>}
          {list.data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">还没有快照</p>}
          {!!list.data?.length && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-3 py-2 font-medium">时间</th>
                  <th className="px-3 py-2 font-medium">说明</th>
                  <th className="px-3 py-2 font-medium">内容</th>
                  <th className="px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((m) => (
                  <tr key={m.id} className="border-b last:border-b-0">
                    <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">{formatLocalMinute(m.createdAt)}</td>
                    <td className="max-w-56 truncate px-3 py-1.5" title={m.label}>
                      {m.label}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                      {m.itemCount} 张卡片 · {m.relationCount} 条关联
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => preview(m.id)}>
                        预览
                      </Button>
                      <a href={api.snapshotDownloadUrl(m.id)} download className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                        下载 JSON
                      </a>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleting(m)}
                      >
                        删除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除快照"{deleting?.label}"？</AlertDialogTitle>
              <AlertDialogDescription>
                {deleting && formatLocalMinute(deleting.createdAt)} 的这份快照删除后无法找回。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              {/* AlertDialogAction is a plain button here; it does not close the dialog. */}
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  if (deleting) remove.mutate(deleting.id)
                  setDeleting(null)
                }}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
