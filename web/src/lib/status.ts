import type { Status } from '@/api/types'

export const STATUSES: { value: Status; label: string }[] = [
  { value: 'in_use', label: '使用中' },
  { value: 'watching', label: '关注中' },
  { value: 'archived', label: '已弃用' },
]

export const statusLabel = (s: Status) => STATUSES.find((x) => x.value === s)?.label ?? s

export const statusBadgeClass: Record<Status, string> = {
  in_use: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  watching: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  archived: 'bg-muted text-muted-foreground',
}

// Toolbar filter: every pressed toggle looks the same (dark fill and a check),
// so pressed vs not reads at a glance. Only the dot carries the status color.
export const statusDotClass: Record<Status, string> = {
  in_use: 'bg-emerald-500',
  watching: 'bg-sky-500',
  archived: 'bg-zinc-400',
}

export const statusToggleClass =
  'text-muted-foreground aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/85 aria-pressed:hover:text-primary-foreground'
