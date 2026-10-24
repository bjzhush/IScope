// How many leading tags fit in `avail` px, given each tag's width, when the
// tags past the cut collapse into one "+N" badge of `plusWidth`.
export function fitTags(widths: number[], plusWidth: number, gap: number, avail: number): number {
  let used = 0
  for (let k = 0; k < widths.length; k++) {
    used += (k > 0 ? gap : 0) + widths[k]
    const hidden = widths.length - k - 1
    if (used + (hidden > 0 ? gap + plusWidth : 0) > avail) return k
  }
  return widths.length
}
