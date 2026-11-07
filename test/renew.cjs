// Behavior test for the「一键续期」button in dsh-ofm-credits client.js
// Usage: node renew.cjs <path-to-client.js>
//
// 每个场景跑在一个全新 vm realm 里（client.js 的模块级 cache 不能跨场景残留）。
// 驱动真实代码路径：渲染面板 → 点「刷新」填好 cache.active → 点「一键续期」，
// 断言 RPC 序列、账号过滤，以及「换发 / 未到期 no-op / 失败 / 跳过」四种收尾。
//
// 假宿主模拟 channel-pack 的真实语义：account.refresh 只在令牌进入续期窗口时
// 才推进 expiresAt，否则原样返回（no-op）—— 这正是按钮必须区分开的两种结果。
const fs = require('node:fs')
const vm = require('node:vm')
const src = fs.readFileSync(process.argv[2], 'utf8')

const T0 = 1_793_600_000_000
const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1) } }
const settle = (times = 5) => new Promise(r => setTimeout(r, 120 * times))

/**
 * @param opts {advance?: Record<string, boolean>, refreshThrows?: string,
 *              listAfterRefreshFails?: boolean, rpcDown?: boolean}
 */
function makeRealm(opts = {}) {
  const advance = opts.advance ?? {}
  const store = {
    codearts: [
      { id: 'codearts-aaa', enabled: true, refreshable: true, expiresAt: T0 },
      { id: 'codearts-bbb', enabled: false, refreshable: true, expiresAt: T0 },
      { id: 'codearts-ccc', enabled: true, refreshable: false, expiresAt: T0 },
    ],
    buddy: [{ id: 'buddy-xxx', enabled: true, refreshable: true, expiresAt: T0 }],
    opencode: [{ id: 'opencode-1', enabled: true, refreshable: true, expiresAt: T0 }],
  }

  const calls = []
  const canned = {
    'provider.status': () => ({
      statuses: {
        codearts: { accounts: { total: 3, enabled: 1 } },
        buddy: { accounts: { total: 1, enabled: 1 } },
        opencode: { accounts: { total: 1, enabled: 1 } },
      },
    }),
    'account.list': p => {
      // 只打掉「codearts 续期之后的那一次回读」，其余列表调用照常：
      // 这才对应真实故障（回读挂了，但下一个渠道仍能正常处理）。
      if (opts.listAfterRefreshFails && p.provider === 'codearts'
        && calls.some(c => c.method === 'account.refresh' && c.accountId === 'codearts-aaa')) {
        throw new Error('回读账号列表失败')
      }
      return { accounts: (store[p.provider] ?? []).map(a => ({ ...a })) }
    },
    'account.refresh': p => {
      if (opts.refreshThrows) throw new Error(opts.refreshThrows)
      let hit = null
      for (const list of Object.values(store)) {
        const found = list.find(a => a.id === p.accountId)
        if (found) { hit = found; break }
      }
      if (!hit) throw new Error('Account ' + p.accountId + ' not found')
      if (advance[p.accountId] === true) hit.expiresAt = T0 + 3 * 3600_000
      return { success: true }
    },
    'usage.badge': () => ({ accounts: [] }),
  }

  let hookIndex = 0
  const renewWrites = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    // OfmCreditsBar 的 useState 顺序：data, busy, renew, open → 第 4 个是 open
    useState: initial => {
      hookIndex += 1
      const mine = hookIndex
      const value = mine === 4 ? true : (typeof initial === 'function' ? initial() : initial)
      return [value, next => { if (mine === 3) renewWrites.push(typeof next === 'function' ? next(value) : next) }]
    },
    useEffect: () => {},
    useMemo: fn => fn(),
    useRef: () => ({ current: null }),
    useCallback: fn => fn,
  }

  const sandbox = {
    window: {},
    document: { visibilityState: 'visible', documentElement: { lang: 'zh-CN' }, head: { appendChild() {} }, addEventListener() {}, removeEventListener() {}, createElement: () => ({ setAttribute() {}, remove() {} }) },
    navigator: { language: 'zh-CN', languages: ['zh-CN'] },
    setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
    console, Date, Math, JSON, Object, Array, Number, String, Error, Promise, Symbol,
  }
  const loads = []
  sandbox.window.__ModuleLoader__ = { load: def => loads.push(def) }
  sandbox.window.addEventListener = () => {}
  sandbox.window.dispatchEvent = () => {}
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: 'client.js' })
  const bundle = loads[0].factory(id => { if (id === 'react') return React; throw new Error('unexpected require: ' + id) })

  let captured = null
  const ctx = {
    connection: {
      rpc: {
        call: async (prefix, endpoint, body) => {
          const { method, payload } = body
          calls.push({ method, provider: payload?.provider, accountId: payload?.accountId, force: payload?.force === true })
          if (opts.rpcDown) throw new Error('channel-pack 未就绪')
          const fn = canned[method]
          if (!fn) throw new Error('unexpected rpc method: ' + method)
          return { ok: true, value: fn(payload) }
        },
      },
    },
    effect: () => () => {},
    slots: { inject: (name, factory) => { factory() }, register: (meta, comp) => { captured = comp; return () => {} } },
  }
  bundle.apply(ctx)
  assert(captured, 'component not captured')

  const walk = (node, out = [], depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 12) return out
    if (Array.isArray(node)) { for (const c of node) walk(c, out, depth); return out }
    out.push(node)
    if (typeof node.type === 'function' && node.props) {
      try { walk(node.type(node.props), out, depth + 1) } catch { /* 子树尽力而为 */ }
      return out
    }
    if (Array.isArray(node.children)) for (const c of node.children) walk(c, out, depth + 1)
    return out
  }
  const render = () => { hookIndex = 0; return walk(captured({ ctx })) }
  const lastRenew = () => renewWrites[renewWrites.length - 1]
  const forcedBadge = () => r.calls.some(c => c.method === 'usage.badge' && c.force === true)
  const r = { calls, render, renewWrites, lastRenew, forcedBadge }
  return r
}

// 通用前置：渲染 → 点「刷新」（填 cache.active）→ 清调用记录 → 返回最新闭包里的续期按钮
async function prime(realm) {
  const tree = realm.render()
  const refreshBtn = tree.find(n => n.props?.className === 'ofmq_refresh')
  const renewBtn = tree.find(n => n.props?.className === 'ofmq_renew')
  assert(refreshBtn, 'no 刷新 button in popover')
  assert(renewBtn, 'no 一键续期 button in popover')
  refreshBtn.props.onClick()
  await settle(2)
  assert(realm.calls.some(c => c.method === 'provider.status'), '刷新 did not call provider.status')
  realm.calls.length = 0
  return realm.render().find(n => n.props?.className === 'ofmq_renew')
}

;(async () => {
  // ── 场景 1：一个真换发 + 一个未到期 no-op ─────────────────────────
  {
    const realm = makeRealm({ advance: { 'codearts-aaa': true, 'buddy-xxx': false } })
    const btn = await prime(realm)
    console.log('[1] label: ' + JSON.stringify(btn.children))
    btn.props.onClick()
    await settle()

    const lists = [...new Set(realm.calls.filter(c => c.method === 'account.list').map(c => c.provider))]
    const refreshed = realm.calls.filter(c => c.method === 'account.refresh')
    console.log('[1] list providers : ' + lists.join(', '))
    console.log('[1] refreshed ids  : ' + refreshed.map(c => c.accountId).join(', '))
    assert(lists.includes('codearts') && lists.includes('buddy'), 'active renewable providers missing: ' + lists)
    assert(!lists.includes('opencode'), 'opencode must never be renewed (channel-pack has no branch for it)')
    assert(!lists.includes('lobsterai'), 'provider without accounts must not be queried')
    assert(refreshed.length === 2, `expected 2 refresh calls, got ${refreshed.length}`)
    assert(refreshed.some(c => c.accountId === 'codearts-aaa'), 'enabled+refreshable account not renewed')
    assert(refreshed.some(c => c.accountId === 'buddy-xxx'), 'buddy account not renewed')
    assert(!refreshed.some(c => c.accountId === 'codearts-bbb'), 'disabled account must be skipped')
    assert(!refreshed.some(c => c.accountId === 'codearts-ccc'), 'refreshable=false account must be skipped')

    const last = realm.lastRenew()
    console.log('[1] summary: ' + last.text + '  (busy=' + last.busy + ' error=' + last.error + ')')
    assert(last.busy === false, 'renew state not released')
    assert(/已换发 1 个/.test(last.text), 'must count only the real re-issue: ' + last.text)
    assert(/1 个未到期/.test(last.text), 'must surface the host-side no-op separately: ' + last.text)
    assert(/跳过 2 个/.test(last.text), 'disabled + non-refreshable both count as skipped: ' + last.text)
    assert(realm.forcedBadge(), 'a re-issue must force a balance re-query')
  }

  // ── 场景 2：全部未到期 → 不许谎称「已换发」，也不强刷余额 ──────────
  {
    const realm = makeRealm({ advance: {} })
    const btn = await prime(realm)
    btn.props.onClick()
    await settle()
    const last = realm.lastRenew()
    console.log('[2] summary: ' + last.text + '  (error=' + last.error + ')')
    assert(!/已换发/.test(last.text), 'must NOT claim re-issue when expiresAt never moved: ' + last.text)
    assert(/2 个未到期/.test(last.text), 'both accounts should read as not-due: ' + last.text)
    assert(last.error === false, 'not-due is not an error')
    assert(!realm.forcedBadge(), 'no re-issue ⇒ no forced badge query')
  }

  // ── 场景 3：refresh 全部抛错 → 失败计数 + 上游原文 ────────────────
  {
    const realm = makeRealm({ refreshThrows: '无 refresh_token，请重新登录' })
    const btn = await prime(realm)
    btn.props.onClick()
    await settle()
    const last = realm.lastRenew()
    console.log('[3] summary: ' + last.text + '  (error=' + last.error + ')')
    assert(last.error === true, 'a failing renew must surface as error')
    assert(/失败 2 个/.test(last.text), 'failure count missing: ' + last.text)
    assert(/无 refresh_token/.test(last.text), 'upstream reason not surfaced: ' + last.text)
    assert(!/已换发/.test(last.text), 'must not claim success: ' + last.text)
    assert(!realm.forcedBadge(), 'nothing re-issued ⇒ no forced badge query')
  }

  // ── 场景 4：RPC 整体不可用 → 报原因，绝不报「没有账号」 ───────────
  {
    const realm = makeRealm({ rpcDown: true })
    const tree = realm.render()
    tree.find(n => n.props?.className === 'ofmq_renew').props.onClick()
    await settle()
    const last = realm.lastRenew()
    console.log('[4] summary: ' + last.text + '  (error=' + last.error + ')')
    assert(/续期出错/.test(last.text), 'must report the failure reason: ' + last.text)
    assert(!/没有可续期的账号/.test(last.text), 'must not misreport RPC outage as "no accounts"')
    assert(last.error === true, 'rpcDown must surface as error')
  }

  // ── 场景 5：续期发出去了但回读列表挂 → 保守计入换发，不误报失败 ───
  {
    const realm = makeRealm({ advance: { 'codearts-aaa': true, 'buddy-xxx': true }, listAfterRefreshFails: true })
    const btn = await prime(realm)
    btn.props.onClick()
    await settle()
    const last = realm.lastRenew()
    console.log('[5] summary: ' + last.text + '  (error=' + last.error + ')')
    assert(/已换发 2 个/.test(last.text), 'read-back failure must fall back to counting attempted: ' + last.text)
    assert(last.error === false, 'read-back failure alone is not an error: ' + last.text)
  }

  console.log('ALL RENEW CHECKS PASS')
})().catch(e => { console.error('threw: ' + (e && e.stack || e)); process.exit(1) })
