import '@testing-library/jest-dom/vitest'

// jsdom lacks these browser APIs; cmdk and the popovers call them.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Element.prototype.scrollIntoView ??= function () {}
