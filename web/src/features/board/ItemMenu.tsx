import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import type { Item, Status } from '@/api/types'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ItemActions } from './actions'

const STATUS_ITEMS: { status: Status; label: string }[] = [
  { status: 'in_use', label: '设为使用中' },
  { status: 'watching', label: '设为关注中' },
  { status: 'archived', label: '设为弃用' },
]

export function ItemMenu({ item, actions }: { item: Item; actions: ItemActions }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const archived = item.status === 'archived'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-xs" aria-label={`${item.name} 菜单`} onClick={(e) => e.stopPropagation()} />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36" onClick={(e) => e.stopPropagation()}>
          {/* Groups: pin | the other two statuses | edit | relations. An archived
              item can only be moved back to a status or deleted. */}
          {!archived && (
            <>
              <DropdownMenuItem onClick={() => actions.togglePin(item)}>
                {item.pinned ? '取消置顶' : '置顶'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {STATUS_ITEMS.filter((s) => s.status !== item.status).map((s) => (
            <DropdownMenuItem key={s.status} onClick={() => actions.setStatus(item, s.status)}>
              {s.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {archived ? (
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
              删除
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onClick={() => actions.edit(item)}>编辑</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => actions.link(item)}>编辑关联…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.focus(item)}>聚焦关联</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>删除“{item.name}”？</AlertDialogTitle>
            <AlertDialogDescription>删除后该条目将不再出现，无法在页面中恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => actions.remove(item)}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
