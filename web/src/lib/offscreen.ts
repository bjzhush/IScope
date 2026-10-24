export interface Span {
  top: number
  bottom: number
}

// How many targets sit mostly outside the scroll viewport, above and below it.
// A target counts as off screen once its middle has scrolled out of view.
export function offscreen(view: Span, targets: Span[]): { above: number; below: number } {
  let above = 0
  let below = 0
  for (const t of targets) {
    const mid = (t.top + t.bottom) / 2
    if (mid < view.top) above++
    else if (mid > view.bottom) below++
  }
  return { above, below }
}
