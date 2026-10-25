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

// Toolbar filter: a dot in the status color, and the badge colors when pressed
// (archived a shade darker than its badge, so pressed reads as pressed).
export const statusDotClass: Record<Status, string> = {
  in_use: 'bg-emerald-500',
  watching: 'bg-sky-500',
  archived: 'bg-zinc-400',
}

export const statusToggleClass: Record<Status, string> = {
  in_use:
    'aria-pressed:border-emerald-300 aria-pressed:bg-emerald-100 aria-pressed:text-emerald-800 aria-pressed:hover:bg-emerald-200 dark:aria-pressed:border-emerald-800 dark:aria-pressed:bg-emerald-950 dark:aria-pressed:text-emerald-300',
  watching:
    'aria-pressed:border-sky-300 aria-pressed:bg-sky-100 aria-pressed:text-sky-800 aria-pressed:hover:bg-sky-200 dark:aria-pressed:border-sky-800 dark:aria-pressed:bg-sky-950 dark:aria-pressed:text-sky-300',
  archived:
    'aria-pressed:border-zinc-400 aria-pressed:bg-zinc-200 aria-pressed:text-zinc-800 aria-pressed:hover:bg-zinc-300 dark:aria-pressed:border-zinc-600 dark:aria-pressed:bg-zinc-800 dark:aria-pressed:text-zinc-200',
}
