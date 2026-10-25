import type { AttrValue, CatalogPriceChange, CatalogUpdateResult, Field } from '@/api/types'
import { formatFieldValue } from '@/lib/format'
import { cn } from '@/lib/utils'

const EMPTY = '（空）'

const fmtPrices = (attrs: Record<string, AttrValue>) => {
  const { input_price: i, output_price: o } = attrs
  return i === undefined && o === undefined ? '无价格' : `$${i ?? '?'} / $${o ?? '?'}`
}

function priceNote(p: CatalogPriceChange) {
  if (p.status === 'not_found') return p.source ? `${p.source} 没有这个模型，保留旧价格` : '未找到对应渠道，保留旧价格'
  return `匹配 ${p.source}${p.status === 'unchanged' ? '，价格不变' : ''}`
}

// What 从链接更新 will change, from a dry run of the same update.
export function UpdatePreview({ result, fields }: { result: CatalogUpdateResult; fields: Field[] }) {
  const label = (key: string) => (key === 'name' ? '名称' : (fields.find((f) => f.key === key)?.label ?? key))
  const value = (key: string, v: AttrValue | null) => {
    if (v === null || v === undefined) return EMPTY
    const f = fields.find((x) => x.key === key)
    return (f ? formatFieldValue(f, v) : String(v)) ?? EMPTY
  }

  return (
    <div aria-label="更新预览" role="region" className="grid gap-3 rounded-md border p-3 text-sm">
      {result.changes.length === 0 ? (
        <p className="text-muted-foreground">名称和模型字段与所选模型一致，没有要覆盖的内容。</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {result.changes.map((c) => (
            <div key={c.key} className="contents">
              <dt className="text-muted-foreground">{label(c.key)}</dt>
              <dd className="break-words">
                <span className="text-muted-foreground line-through">{value(c.key, c.old)}</span> → {value(c.key, c.new)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {result.prices.length > 0 && (
        <div className="grid gap-1">
          <p className="text-xs font-medium text-muted-foreground">渠道价格</p>
          <ul className="grid gap-1">
            {result.prices.map((p) => (
              <li key={p.providerId} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{p.providerName}</span>
                <span>
                  {p.status === 'updated' ? (
                    <>
                      <span className="text-muted-foreground line-through">{fmtPrices(p.old)}</span> → {fmtPrices(p.new)}
                    </>
                  ) : (
                    fmtPrices(p.old)
                  )}
                </span>
                <span className={cn('text-xs', p.status === 'not_found' ? 'text-amber-600' : 'text-muted-foreground')}>
                  {priceNote(p)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        关联、描述、标签、评分、笔记保持不变。更新前会自动保存快照，可在"数据 → 快照…"里查看旧版本。
      </p>
    </div>
  )
}
