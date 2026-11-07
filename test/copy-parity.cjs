// 校验 COPY 的中英两块键集完全一致（缺键会在另一种语言下渲染出 undefined）
// 用法: node copy-parity.cjs <path-to-client.js>
const fs = require('node:fs')
const src = fs.readFileSync(process.argv[2], 'utf8')

// 从 `const COPY = zh ? ` 之后扫出两个平衡的对象字面量。
// 字符串里的 {n}/{ago} 之类占位符都是成对大括号，计数不受影响。
const start = src.indexOf('const COPY = zh ?')
if (start < 0) { console.error('FAIL: 找不到 COPY 三元'); process.exit(1) }
let cursor = src.indexOf('{', start)
const readObject = () => {
  if (src[cursor] !== '{') throw new Error('期望 {，位置 ' + cursor)
  let depth = 0
  const from = cursor
  for (let i = cursor; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) { cursor = i + 1; return src.slice(from, cursor) } }
  }
  throw new Error('大括号未闭合')
}
const zhText = readObject()
const colon = src.indexOf(':', cursor)
cursor = src.indexOf('{', colon)
const enText = readObject()

const zhObj = new Function('return ' + zhText)()
const enObj = new Function('return ' + enText)()
const zhKeys = Object.keys(zhObj)
const enKeys = Object.keys(enObj)

const missing = zhKeys.filter(k => !enKeys.includes(k))
const extra = enKeys.filter(k => !zhKeys.includes(k))
console.log(`zh keys=${zhKeys.length} en keys=${enKeys.length}`)
if (missing.length) console.error('  en 缺: ' + missing.join(', '))
if (extra.length) console.error('  zh 缺: ' + extra.join(', '))

// 值必须是字符串，且 {x} 占位符集合要两边一致
const ph = s => [...String(s).matchAll(/\{([a-zA-Z]+)\}/g)].map(m => m[1]).sort().join(',')
for (const k of zhKeys.filter(k => enKeys.includes(k))) {
  if (typeof zhObj[k] !== 'string' || typeof enObj[k] !== 'string') { console.error(`FAIL: ${k} 不是字符串`); process.exit(1) }
  if (ph(zhObj[k]) !== ph(enObj[k])) { console.error(`FAIL: ${k} 占位符不一致 zh{${ph(zhObj[k])}} en{${ph(enObj[k])}}`); process.exit(1) }
}

// 所有 COPY.<key> 引用都必须有声明（两块都已验证一致，取 zh 即可）
const refs = [...new Set([...src.matchAll(/COPY\.([A-Za-z][A-Za-z0-9]*)/g)].map(m => m[1]))]
const undeclared = refs.filter(k => !zhKeys.includes(k))
console.log(`引用键=${refs.length}`)
if (undeclared.length) { console.error('  未声明就被引用: ' + undeclared.join(', ')); process.exit(1) }

if (missing.length || extra.length) process.exit(1)
console.log('COPY PARITY OK')
