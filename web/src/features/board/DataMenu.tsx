import { useQueryClient } from '@tanstack/react-query'
import { Database } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'
import { ApiError, api } from '@/api/client'
import type { ImportSummary } from '@/api/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const counts = (c: ImportSummary['items']) => `新增 ${c.created}、更新 ${c.updated}、未变 ${c.unchanged}`

export function DataMenu({ onCatalog, onSnapshots }: { onCatalog: () => void; onSnapshots: () => void }) {
  const qc = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)

  const importFile = async (file: File) => {
    let doc: unknown
    try {
      doc = JSON.parse(await file.text())
    } catch {
      toast.error('导入失败：文件不是有效的 JSON')
      return
    }
    try {
      const sum = await api.importData(doc)
      toast.success('导入完成', { description: `条目：${counts(sum.items)}；关联：${counts(sum.relations)}` })
      qc.invalidateQueries({ queryKey: ['board'] })
      qc.invalidateQueries({ queryKey: ['item'] })
      qc.invalidateQueries({ queryKey: ['snapshots'] }) // an import that changed something saved one
    } catch (e) {
      const fields = e instanceof ApiError ? Object.entries(e.fields) : []
      toast.error(`导入失败：${e instanceof Error ? e.message : String(e)}`, {
        description: fields.length
          ? fields
              .slice(0, 5)
              .map(([k, m]) => `${k}：${m}`)
              .join('\n') + (fields.length > 5 ? `\n…共 ${fields.length} 处` : '')
          : undefined,
      })
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          <Database /> 数据
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem render={<a href={api.exportUrl} download />}>导出 JSON</DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileInput.current?.click()}>导入 JSON…</DropdownMenuItem>
          <DropdownMenuItem onClick={onSnapshots}>快照…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onCatalog}>从 models.dev 导入模型…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        aria-label="选择要导入的 JSON 文件"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // allow picking the same file again
          if (file) importFile(file)
        }}
      />
    </>
  )
}
