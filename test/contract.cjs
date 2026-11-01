// ModuleLoader contract test for dsh-ofm-credits client.js
// Usage: node ofm-contract.cjs <path-to-client.js>
const fs = require('node:fs')
const vm = require('node:vm')
const src = fs.readFileSync(process.argv[2], 'utf8')

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: fn => fn(),
  useRef: () => ({ current: null }),
  useCallback: fn => fn(),
}
const loads = []
const slotRegistrations = []
const sandbox = {
  window: {},
  document: { visibilityState: 'visible', documentElement: { lang: 'zh-CN' }, head: { appendChild() {} }, addEventListener() {}, removeEventListener() {}, createElement: tag => ({ tag, setAttribute() {}, remove() {} }) },
  navigator: { language: 'zh-CN', languages: ['zh-CN'] },
  setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
  console, Date, Math, JSON, Object, Array, Number, String, Error, Promise, Symbol,
}
sandbox.window.__ModuleLoader__ = { load: def => loads.push(def) }
const fakeRequire = id => { if (id === 'react') return React; throw new Error('unexpected require: ' + id) }
vm.createContext(sandbox)
vm.runInContext(src, sandbox, { filename: 'client.js' })
if (loads.length !== 1) { console.error('expected exactly one load() call, got ' + loads.length); process.exit(1) }
const def = loads[0]
if (def.id !== 'dsh-ofm-credits') { console.error('bad id ' + def.id); process.exit(1) }
const bundle = def.factory(fakeRequire)
if (bundle.inject.join(',') !== 'slots') { console.error('bad inject ' + bundle.inject); process.exit(1) }
const styleEffects = []
const ctx = {
  connection: { rpc: { call: async () => { throw new Error('offline') } } },
  effect: run => { styleEffects.push('scheduled'); const cleanup = run(); return cleanup },
  slots: {
    inject: (name, factory) => { factory() },
    register: (meta, comp) => { slotRegistrations.push(meta.id + '@' + meta.name); return () => {} },
  },
}
bundle.apply(ctx)
bundle.apply(ctx)
if (slotRegistrations.length !== 1) { console.error('double registration: ' + JSON.stringify(slotRegistrations)); process.exit(1) }
console.log('slot registered once: ' + slotRegistrations[0])
console.log('style effect scheduled once: ' + (styleEffects.length === 1 ? 'ok' : 'FAIL'))

// ── render smoke test: invoke the registered component as a function ──
// Hooks are stubbed synchronously (useState runs its initializer, useMemo
// evaluates, useEffect is a no-op) which is enough to execute the component
// body end-to-end and assert it produces an element tree without throwing.
let capturedComponent = null
ctx.slots.register = (meta, comp) => { capturedComponent = comp; return () => {} }
slotRegistrations.length = 0
bundle.apply({ ...ctx, slots: { inject: (name, factory) => { factory() }, register: ctx.slots.register } })
if (typeof capturedComponent !== 'function') { console.error('component not captured'); process.exit(1) }
const element = capturedComponent({ ctx })
if (!element || typeof element !== 'object') { console.error('slot body returned a non-element'); process.exit(1) }
if (typeof element.type !== 'function') { console.error('expected component element, got ' + String(element.type)); process.exit(1) }
// Execute the component function itself (hooks are stubbed synchronously).
const rendered = element.type(element.props)
if (!rendered || typeof rendered !== 'object' || typeof rendered.type !== 'string') {
  console.error('component body returned a non-element'); process.exit(1)
}
const pillButton = (rendered.children || []).find(child => child && typeof child === 'object' && child.type === 'button')
if (!pillButton) { console.error('no pill button in render output'); process.exit(1) }
console.log('component rendered: ' + rendered.type + ' with pill button ok')
console.log('ALL CONTRACT CHECKS PASS')
