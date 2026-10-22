import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import type { Item } from '@/api/types'
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
          {archived ? (
            <>
              <DropdownMenuItem onClick={() => actions.setStatus(item, 'watching')}>恢复</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                删除
              </DropdownMenuItem>
            </>
          ) : (
            <>
              {item.status !== 'in_use' && (
                <DropdownMenuItem onClick={() => actions.setStatus(item, 'in_use')}>设为使用中</DropdownMenuItem>
              )}
              {item.status !== 'watching' && (
                <DropdownMenuItem onClick={() => actions.setStatus(item, 'watching')}>设为关注中</DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => actions.togglePin(item)}>
                {item.pinned ? '取消置顶' : '置顶'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.edit(item)}>编辑</DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.link(item)}>编辑关联…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => actions.setStatus(item, 'archived')}>弃用</DropdownMenuItem>
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
