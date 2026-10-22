import '@testing-library/jest-dom/vitest'

// jsdom lacks these browser APIs; cmdk and the popovers call them.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Element.prototype.scrollIntoView ??= function () {}

// matchMedia stub; tests set `media.matches` to simulate a narrow viewport.
export const media = { matches: false }
window.matchMedia ??= (query: string) =>
  ({
    get matches() {
      return media.matches
    },
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList
