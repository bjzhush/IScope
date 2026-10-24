import { render, screen } from '@testing-library/react'
import { TagStrip } from './TagStrip'

// Fake layout: every badge is 30px wide and the title row is 300px, so tags
// get 90px: one tag (30) + gap (4) + "+3" (30) = 64 fits, two tags + "+2" = 98 do not.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(30)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
})

afterEach(() => vi.restoreAllMocks())

const visible = () =>
  Array.from(screen.getByTestId('row').firstElementChild!.children)
    .filter((el) => !el.hasAttribute('aria-hidden'))
    .map((el) => el.textContent)

test('tags past 30% of the row collapse into +N', () => {
  render(
    <div data-testid="row">
      <TagStrip tags={['a', 'b', 'c', 'd']} />
    </div>,
  )
  expect(visible()).toEqual(['a', '+3'])
  expect(screen.getByLabelText('另有 3 个标签')).toBeInTheDocument()
})

test('tags that fit show without +N', () => {
  render(
    <div data-testid="row">
      <TagStrip tags={['a', 'b']} />
    </div>,
  )
  expect(visible()).toEqual(['a', 'b'])
})

test('no tags renders nothing', () => {
  render(
    <div data-testid="row">
      <TagStrip tags={[]} />
    </div>,
  )
  expect(screen.getByTestId('row')).toBeEmptyDOMElement()
})
