import { fitTags } from './fitTags'

// Tags 30, 40, 50 wide, gap 4, "+N" 20 wide.
const w = [30, 40, 50]

test.each([
  ['all fit exactly', 128, 3], // 30+4+40+4+50
  ['one px short drops the last and leaves room for +N', 127, 2], // 30+4+40+4+20 = 98
  ['room for the first tag and +N', 54, 1], // 30+4+20
  ['not even one tag next to +N', 53, 0],
  ['nothing fits', 0, 0],
])('%s', (_, avail, want) => {
  expect(fitTags(w, 20, 4, avail)).toBe(want)
})

test('no tags', () => {
  expect(fitTags([], 20, 4, 100)).toBe(0)
})
