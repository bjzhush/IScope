import type { Field } from '@/api/types'

// The drawer lays fields out on a two-column grid. Short inputs take one
// column; wide ones span both (FULL).
export const FULL = 'sm:col-span-2'

// Grid width by field type: only multi-line text needs both columns.
export const fieldSpan = (f: Field) => (f.type === 'textarea' ? FULL : undefined)
