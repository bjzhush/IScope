import { ExternalLink, Plus, Star, X } from 'lucide-react'
import { Controller, useFieldArray, useFormContext, useWatch } from 'react-hook-form'
import type { Status } from '@/api/types'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { isHttpUrl, type ItemFormValues } from '@/lib/schema'
import { STATUSES } from '@/lib/status'
import { cn } from '@/lib/utils'
import { FormRow } from './FormRow'
import { FULL } from './layout'
import { TagInput } from './TagInput'

// Grid cells for the top of the drawer: name | status, summary, tags | rating.
export function CoreFields() {
  const { register, control, formState } = useFormContext<ItemFormValues>()
  const errors = formState.errors

  return (
    <>
      <FormRow id="field-name" label="名称" required error={errors.name?.message}>
        <Input id="field-name" aria-invalid={!!errors.name} {...register('name')} />
      </FormRow>

      <FormRow id="field-status" label="状态" error={errors.status?.message}>
        <Controller
          control={control}
          name="status"
          render={({ field }) => (
            <Select items={STATUSES} value={field.value} onValueChange={(v) => v && field.onChange(v as Status)}>
              <SelectTrigger id="field-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormRow>

      <FormRow id="field-summary" label="一句话描述" error={errors.summary?.message} className={FULL}>
        <Input id="field-summary" {...register('summary')} />
      </FormRow>

      <FormRow id="field-tags" label="标签" error={errors.tags?.message}>
        <Controller
          control={control}
          name="tags"
          render={({ field }) => <TagInput id="field-tags" value={field.value} onChange={field.onChange} />}
        />
      </FormRow>

      <FormRow id="field-rating" label="评分" error={errors.rating?.message}>
        <Controller
          control={control}
          name="rating"
          render={({ field }) => (
            <div id="field-rating" role="radiogroup" aria-label="评分" className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={field.value === n}
                  aria-label={`${n} 星`}
                  title={field.value === n ? '再次点击清除' : `${n} 星`}
                  onClick={() => field.onChange(field.value === n ? null : n)}
                >
                  <Star
                    className={cn(
                      'size-5',
                      field.value !== null && n <= field.value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40',
                    )}
                  />
                </button>
              ))}
            </div>
          )}
        />
      </FormRow>

    </>
  )
}

// Bottom of the drawer: links | notes.
export function LinksAndNotes() {
  const { register, control, formState } = useFormContext<ItemFormValues>()
  const errors = formState.errors
  const links = useFieldArray({ control, name: 'links' })
  const typed = useWatch({ control, name: 'links' })

  return (
    <>
      <div className="grid content-start gap-1.5">
        <span className="text-sm font-medium">链接</span>
        {links.fields.map((row, i) => {
          const err = errors.links?.[i]?.url?.message
          const url = (typed?.[i]?.url ?? '').trim()
          return (
            <div key={row.id} className="grid gap-1">
              <div className="flex gap-2">
                <Input aria-label={`链接 ${i + 1} 标签`} placeholder="标签" className="w-28" {...register(`links.${i}.label`)} />
                <Input
                  aria-label={`链接 ${i + 1} URL`}
                  placeholder="https://"
                  aria-invalid={!!err}
                  {...register(`links.${i}.url`)}
                />
                {/* Opens in a new tab; works on unsaved edits, greyed out until the URL is valid. */}
                {isHttpUrl(url) ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={url}
                    aria-label={`打开链接 ${i + 1}`}
                    className={buttonVariants({ variant: 'ghost', size: 'icon' })}
                  >
                    <ExternalLink />
                  </a>
                ) : (
                  <Button type="button" variant="ghost" size="icon" disabled aria-label={`打开链接 ${i + 1}`} title="填写 http 或 https 链接后可打开">
                    <ExternalLink />
                  </Button>
                )}
                <Button type="button" variant="ghost" size="icon" aria-label={`删除链接 ${i + 1}`} onClick={() => links.remove(i)}>
                  <X />
                </Button>
              </div>
              {err && (
                <p role="alert" className="text-xs text-destructive">
                  {err}
                </p>
              )}
            </div>
          )
        })}
        <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => links.append({ label: '', url: '' })}>
          <Plus /> 添加链接
        </Button>
      </div>

      <FormRow id="field-notes" label="笔记" error={errors.notes?.message}>
        <Textarea id="field-notes" rows={4} placeholder="支持 Markdown" {...register('notes')} />
      </FormRow>
    </>
  )
}
