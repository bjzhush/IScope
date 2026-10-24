import { offscreen } from './offscreen'

test('counts targets whose middle is outside the viewport', () => {
  const view = { top: 100, bottom: 300 }
  const targets = [
    { top: 0, bottom: 40 }, // above
    { top: 80, bottom: 140 }, // middle 110: visible, though clipped
    { top: 60, bottom: 120 }, // middle 90: above
    { top: 200, bottom: 240 }, // visible
    { top: 280, bottom: 340 }, // middle 310: below
    { top: 500, bottom: 540 }, // below
  ]
  expect(offscreen(view, targets)).toEqual({ above: 2, below: 2 })
  expect(offscreen(view, [])).toEqual({ above: 0, below: 0 })
})
