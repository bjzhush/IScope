import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { CatalogEntry, Item } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Every board item; the catalog response says which kind can take prices.
  items: Item[]
  onImported: (itemId: string) => void
}

const fmtTokens = (n?: number) =>
  !n ? null : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n)

const fmtPrice = (e: CatalogEntry) =>
  e.inputPrice !== undefined || e.outputPrice !== undefined ? `$${e.inputPrice ?? '?'} / $${e.outputPrice ?? '?'}` : null

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// The board provider whose name best matches the catalog provider, if any.
function guessProvider(providers: Item[], e: CatalogEntry): string {
  const want = norm(e.providerName)
  const hit = providers.find((p) => {
    const have = norm(p.name)
    return have === want || have.includes(want) || want.includes(have)
  })
  return hit?.id ?? ''
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function CatalogDialog({ open, onOpenChange, items, onImported }: Props) {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [provider, setProvider] = useState('')
  const [selected, setSelected] = useState<CatalogEntry | null>(null)
  const [linkTo, setLinkTo] = useState('')
  const query = useDebounced(q, 250)

  const search = useQuery({
    queryKey: ['catalog', query, provider],
    queryFn: () => api.catalog(query, provider),
    enabled: open,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  })

  const importer = useMutation({
    mutationFn: (e: CatalogEntry) =>
      api.catalogImport({ providerId: e.providerId, modelId: e.modelId, linkTo: linkTo || undefined }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['board'] })
      qc.invalidateQueries({ queryKey: ['item'] })
      toast.success(`${res.created ? '已新增' : '已更新'} ${res.item.name}`)
      onOpenChange(false)
      onImported(res.item.id)
    },
    onError: (e) => toast.error(`导入失败：${e.message}`),
  })

  const linkKind = search.data?.linkKind
  const providers = items.filter((it) => it.kind === linkKind && it.status !== 'archived')

  const pick = (e: CatalogEntry) => {
    setSelected(e)
    setLinkTo(guessProvider(providers, e))
  }

  const providerItems = [{ value: '', label: '全部渠道' }, ...(search.data?.providers ?? []).map((p) => ({ value: p.id, label: `${p.name}（${p.count}）` }))]
  const linkItems = [{ value: '', label: '不关联渠道' }, ...providers.map((p) => ({ value: p.id, label: p.name }))]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>从 models.dev 导入模型</DialogTitle>
          <DialogDescription>
            选择一个模型，写入或更新它的出品方、模型 ID、上下文窗口、最大输出、输入模态和发布日期。已有条目的其他字段保持不变。
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="搜索模型"
              placeholder="搜索模型名称或 ID"
              className="pl-8"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select items={providerItems} value={provider} onValueChange={(v) => setProvider((v as string) ?? '')}>
            <SelectTrigger aria-label="按渠道筛选" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {providerItems.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div role="listbox" aria-label="模型" className="min-h-48 flex-1 overflow-y-auto rounded-md border">
          {search.isPending && <p className="p-4 text-sm text-muted-foreground">正在获取模型目录…</p>}
          {search.error && <p className="p-4 text-sm text-destructive">{search.error.message}</p>}
          {search.data?.entries.length === 0 && <p className="p-4 text-sm text-muted-foreground">没有匹配的模型</p>}
          {search.data?.entries.map((e) => {
            const active = selected?.providerId === e.providerId && selected.modelId === e.modelId
            const meta = [e.vendor, fmtTokens(e.context) && `上下文 ${fmtTokens(e.context)}`, fmtPrice(e)].filter(Boolean)
            return (
              <button
                key={`${e.providerId}/${e.modelId}`}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => pick(e)}
                className={cn(
                  'flex w-full items-baseline gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted',
                  active && 'bg-primary/10',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{e.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{e.modelId}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{e.providerName}</span>
                <span className="w-48 shrink-0 truncate text-right text-xs text-muted-foreground">{meta.join(' · ')}</span>
              </button>
            )
          })}
          {search.data && search.data.total > search.data.entries.length && (
            <p className="p-2 text-center text-xs text-muted-foreground">
              共 {search.data.total} 个结果，只显示前 {search.data.entries.length} 个，请输入关键词缩小范围
            </p>
          )}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="catalog-link">同时把价格记录到渠道</Label>
          <Select items={linkItems} value={linkTo} onValueChange={(v) => setLinkTo((v as string) ?? '')}>
            <SelectTrigger id="catalog-link" className="w-full" disabled={!selected}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {linkItems.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && linkTo && (
            <p className="text-xs text-muted-foreground">
              会建立或更新与该渠道的关联，写入 {selected.providerName} 的价格{fmtPrice(selected) ? `（${fmtPrice(selected)}）` : '（目录中无价格）'}。
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={!selected || importer.isPending} onClick={() => selected && importer.mutate(selected)}>
            {importer.isPending ? '导入中…' : '导入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
