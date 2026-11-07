// 模型状态计算 + 重新登录顺序 的行为测试
// 用法: node models.cjs <path-to-client.js>
//
// 覆盖两件事：
//  A. modelStatus 的判据（判死 > 关闭 > 无启用账号 > 全员限流 > 全员令牌过期 > 可用），
//     以及「只有一个账号被限流但还有别的号可用」必须是可用 —— 这是换号语义的核心。
//  B. 重新登录的调用顺序：account.create → login.poll 若干轮 → 成功后才停用旧账号
//     → 再 force 重取余额。登录没成之前动旧号是致命错误（会一个可用号都不剩）。
const fs = require('node:fs')
const vm = require('node:vm')
const src = fs.readFileSync(process.argv[2], 'utf8')

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1) } }
const settle = (ms = 600) => new Promise(r => setTimeout(r, ms))
// NOW 跟着真实时钟走：modelStatus 默认拿 Date.now() 比较，写死一个常量
// 过了几天就会把「刚换发的新令牌」判成已过期（B4 曾经这样假失败）。
const NOW = Date.now()
const DAY = 86_400_000

// ── A. 直接从源码里取 modelStatus 函数跑真表 ────────────────────────
const fnStart = src.indexOf('function modelStatus(')
const fnEnd = src.indexOf('\n    }', fnStart)
if (fnStart < 0 || fnEnd < 0) { console.error('FAIL: 取不到 modelStatus'); process.exit(1) }
const modelStatus = new Function('return ' + src.slice(fnStart, fnEnd + 6))()

const acct = (o = {}) => ({ id: 'a', enabled: true, expiresAt: NOW + DAY, modelRateLimits: {}, ...o })
const cases = [
  [{ id: 'm' }, [acct()], { key: 'ok' }, '正常账号 + 无标记'],
  [{ id: 'm', dead: true }, [acct()], { key: 'dead' }, '判死优先于一切'],
  [{ id: 'm', disabled: true }, [acct()], { key: 'off' }, '手动关闭'],
  [{ id: 'm', dead: true, disabled: true }, [acct()], { key: 'dead' }, '判死优先于关闭'],
  [{ id: 'm' }, [], { key: 'noAccount' }, '零账号'],
  [{ id: 'm' }, [acct({ enabled: false })], { key: 'noAccount' }, '只有停用账号'],
  [{ id: 'm' }, [acct({ modelRateLimits: { m: NOW + 3600_000 } })], { key: 'limited' }, '唯一账号被限流'],
  [{ id: 'm' }, [acct({ id: 'a1', modelRateLimits: { m: NOW + 3600_000 } }), acct({ id: 'a2' })], { key: 'ok' }, '一个限流但另一个可用 ⇒ 可用'],
  [{ id: 'm' }, [acct({ modelRateLimits: { m: NOW - 1000 } })], { key: 'ok' }, '限流标记已过期 ⇒ 可用'],
  [{ id: 'm' }, [acct({ expiresAt: NOW - 1000 })], { key: 'expired' }, '令牌过期'],
  [{ id: 'm' }, [acct({ modelRateLimits: { m: NOW + 3600_000 } }), acct({ id: 'b', expiresAt: NOW - 1000 })], { key: 'limited' }, '限流判定先于过期'],
  [{ id: 'm' }, [acct({ expiresAt: undefined })], { key: 'ok' }, '缺 expiresAt 视为未知，不当过期'],
]
for (const [model, accounts, expect, label] of cases) {
  const got = modelStatus(model, accounts, NOW)
  assert(got.key === expect.key, `${label}: 期望 ${expect.key}，得到 ${got.key}`)
  if (expect.key === 'limited') assert(Number.isFinite(got.until), `${label}: limited 必须带 until`)
}
console.log(`[A] modelStatus ${cases.length} 条判据全对`)

// ── B. 重新登录的 RPC 顺序 ──────────────────────────────────────────
function makeRealm(opts = {}) {
  // 夹具刻意把旧账号造成「令牌已过期」—— 正是用户遇到的 CodeArts 403 形态，
  // 于是重登前该渠道所有模型都是「令牌过期」，重登成功后才转「可用」。
  const store = {
    codearts: [
      { id: 'codearts-old', enabled: true, refreshable: true, expiresAt: NOW - 1000 },
    ],
  }
  const calls = []
  let pollCount = 0
  const canned = {
    'provider.status': () => ({ statuses: { codearts: { accounts: { total: store.codearts.length, enabled: 1 } } } }),
    'model.list': () => ({ models: [{ id: 'glm-5.3', name: 'GLM-5.3' }, { id: 'kimi-k3', name: 'Kimi K3', dead: true }] }),
    'account.list': p => ({ accounts: (store[p.provider] ?? []).map(a => ({ ...a })) }),
    'account.create': () => {
      // 宿主真实行为：create 先往池里塞一个**占位账号**（无凭据、无 expiresAt、
      // refreshable=false），授权完成后才 updateAccount 回填。少了这一步，
      // 客户端的「账号是否还在池里」检测会在第一轮就误判成已被回收。
      store.codearts.push({ id: 'codearts-new', enabled: true, refreshable: false })
      return { accountId: 'codearts-new', loginUrl: 'https://codearts.huaweicloud.com/portal/authorize?x=1' }
    },
    'login.poll': () => {
      pollCount += 1
      if (opts.loginNeverDone) return { done: false }
      if (opts.loginFails) {
        // 宿主失败分支：写 pendingLoginFailures（gemini 系）或直接删号（codearts）
        if (opts.loginFailsRemoves) store.codearts = store.codearts.filter(a => a.id !== 'codearts-new')
        return { done: true, success: false, error: '用户取消了授权' }
      }
      if (pollCount < 2) return { done: false }
      const placeholder = store.codearts.find(a => a.id === 'codearts-new')
      if (placeholder) Object.assign(placeholder, { refreshable: true, expiresAt: NOW + 3 * DAY })
      return { done: true, success: true }
    },
    'account.delete': p => {
      store.codearts = store.codearts.filter(a => a.id !== p.accountId)
      return {}
    },
    'account.update': p => {
      const hit = store.codearts.find(a => a.id === p.accountId)
      if (hit && p.patch && p.patch.enabled === false) hit.enabled = false
      return {}
    },
    'account.refresh': () => ({ success: true }),
    'usage.badge': () => ({ accounts: [] }),
    'account.test': () => (opts.probeFails ? { ok: false, message: '无法确认：HTTP 403' } : { ok: true }),
    'model.clearDead': () => ({ removed: 1 }),
  }
  let hookIndex = 0
  const hookWrites = []
  // 只有 expanded（第 6 个 useState）需要跨渲染保存：展开按钮点完必须真的处于
  // 展开态，否则测不到模型行。其余 hook 每次渲染重算 initial，正好能反映
  // 模块级 modelCache 的变化。
  // useState 顺序：data, busy, renew, open, models, expanded（Popover 的 pos 在其后）
  const saved = {}
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => {
      hookIndex += 1
      const mine = hookIndex
      const fallback = typeof initial === 'function' ? initial() : initial
      const value = mine === 4 ? true : (mine in saved ? saved[mine] : fallback)
      return [value, next => {
        hookWrites.push({ i: mine, v: typeof next === 'function' ? next(value) : next })
        if (mine === 6) saved[mine] = typeof next === 'function' ? next(value) : next
      }]
    },
    useEffect: () => {},
    useMemo: fn => fn(),
    useRef: () => ({ current: null }),
    useCallback: fn => fn,
  }
  const opened = []
  const sandbox = {
    window: { open: u => { opened.push(u) }, addEventListener() {}, dispatchEvent() {} },
    document: { visibilityState: 'visible', documentElement: { lang: 'zh-CN' }, head: { appendChild() {} }, addEventListener() {}, removeEventListener() {}, createElement: () => ({ setAttribute() {}, remove() {} }) },
    navigator: { language: 'zh-CN', languages: ['zh-CN'] },
    setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
    console, Date, Math, JSON, Object, Array, Number, String, Error, Promise, Symbol,
  }
  const loads = []
  sandbox.window.__ModuleLoader__ = { load: d => loads.push(d) }
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: 'client.js' })
  const bundle = loads[0].factory(id => { if (id === 'react') return React; throw new Error('bad require ' + id) })
  let captured = null
  const ctx = {
    connection: {
      rpc: {
        call: async (prefix, endpoint, body) => {
          const { method, payload } = body
          calls.push({ method, accountId: payload?.accountId, provider: payload?.provider, modelId: payload?.modelId, force: payload?.force === true })
          const fn = canned[method]
          if (!fn) throw new Error('unexpected rpc method: ' + method)
          return { ok: true, value: fn(payload) }
        },
      },
    },
    effect: () => () => {},
    slots: { inject: (n, f) => f(), register: (m, c) => { captured = c; return () => {} } },
  }
  bundle.apply(ctx)
  assert(captured, 'component not captured')
  const walk = (node, out = [], depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 14) return out
    if (Array.isArray(node)) { for (const c of node) walk(c, out, depth); return out }
    out.push(node)
    if (typeof node.type === 'function' && node.props) { try { walk(node.type(node.props), out, depth + 1) } catch { } ; return out }
    if (Array.isArray(node.children)) for (const c of node.children) walk(c, out, depth + 1)
    return out
  }
  const render = () => { hookIndex = 0; return walk(captured({ ctx })) }
  return { calls, render, store, opened, hookWrites }
}

;(async () => {
  // 展开某渠道 → 读模型 → 探测 → 判死复活 → 重新登录，全程断言顺序
  {
    const realm = makeRealm({})
    let tree = realm.render()
    tree.find(n => n.props?.className === 'ofmq_refresh').props.onClick()
    await settle(400)
    realm.calls.length = 0

    tree = realm.render()
    const expandBtn = tree.find(n => n.props?.className === 'ofmq_expandbtn')
    assert(expandBtn, '没有「模型状态」展开按钮')
    console.log('[B1] 展开按钮文案: ' + JSON.stringify(expandBtn.children))
    expandBtn.props.onClick()
    await settle(400)
    const listCalls = realm.calls.filter(c => c.method === 'model.list' || c.method === 'account.list')
    assert(listCalls.length === 2, '展开应只读目录+账号两次，得到 ' + listCalls.length)
    assert(realm.calls.every(c => c.method !== 'account.test'), '展开绝不能触发探测（花钱）')
    console.log('[B1] 展开读取: ' + listCalls.map(c => c.method).join(' + '))

    // 展开后模型行必须出现，且带状态胶囊与两个按钮
    tree = realm.render()
    const rows = tree.filter(n => n.props?.className === 'ofmq_mrow')
    assert(rows.length === 2, '期望 2 个模型行，得到 ' + rows.length)
    const chips = tree.filter(n => typeof n.props?.className === 'string' && n.props.className.startsWith('ofmq_chip'))
    assert(chips.length >= 2, '状态胶囊缺失')
    const chipTexts = chips.map(c => String(c.children))
    console.log('[B1] 胶囊: ' + JSON.stringify(chipTexts))
    // 夹具的旧账号令牌已过期 ⇒ 重登前该模型必须显示「令牌过期」，
    // 而不是「可用」—— 这正是这颗按钮存在的理由。
    assert(chipTexts.some(t => /令牌过期/.test(t)), '过期账号上的模型应显示令牌过期: ' + chipTexts)
    assert(chipTexts.some(t => /已判死/.test(t)), 'dead 模型应显示已判死: ' + chipTexts)
    const loginBtns = tree.filter(n => n.props?.className === 'ofmq_mini login')
    assert(loginBtns.length === 2, '每个模型行都要有一颗重新登录按钮，得到 ' + loginBtns.length)
    const probeBtns = tree.filter(n => n.props?.className === 'ofmq_mini' && String(n.children) === '探测')
    assert(probeBtns.length === 2, '每个模型行要有探测按钮，得到 ' + probeBtns.length)
    const reviveBtns = tree.filter(n => n.props?.className === 'ofmq_mini' && String(n.children) === '复活')
    assert(reviveBtns.length === 1, '只有判死行有复活按钮，得到 ' + reviveBtns.length)

    // 探测
    realm.calls.length = 0
    probeBtns[0].props.onClick()
    await settle(400)
    const probeCall = realm.calls.find(c => c.method === 'account.test')
    assert(probeCall, '探测未发 account.test')
    assert(probeCall.accountId === 'codearts-old', '探测应打第一个启用账号，得到 ' + probeCall.accountId)
    console.log('[B2] account.test accountId=' + probeCall.accountId + ' modelId=' + probeCall.modelId)

    // 复活
    realm.calls.length = 0
    const tree3 = realm.render()
    const revive = tree3.filter(n => n.props?.className === 'ofmq_mini' && String(n.children) === '复活')[0]
    revive.props.onClick()
    await settle(600)
    assert(realm.calls.some(c => c.method === 'model.clearDead'), '复活未发 model.clearDead')
    console.log('[B3] model.clearDead 已发出')

    // 重新登录：create → poll×n → 停用旧号
    realm.calls.length = 0
    const tree4 = realm.render()
    const login = tree4.filter(n => n.props?.className === 'ofmq_mini login')[0]
    login.props.onClick()
    await settle(6000)
    const seq = realm.calls.map(c => c.method)
    console.log('[B4] 登录调用序列: ' + seq.join(' → '))
    assert(seq[0] === 'account.create', '第一步必须是 account.create')
    assert(realm.opened.length === 1 && realm.opened[0].startsWith('https://codearts'), '应打开宿主返回的授权页：' + realm.opened[0])
    assert(seq.includes('login.poll'), '必须轮询 login.poll')
    const firstUpdate = seq.indexOf('account.update')
    const lastPoll = seq.lastIndexOf('login.poll')
    assert(firstUpdate > lastPoll, '停用旧号必须发生在登录确认之后（否则一次失败就清空所有可用号）')
    const update = realm.calls.find(c => c.method === 'account.update')
    assert(update.accountId === 'codearts-old', '应停用旧账号 ' + update.accountId)
    // 旧号「停用 + 令牌已过期」正好命中自动清理，所以这里可能是被停用、
    // 也可能是已经直接被删掉 —— 两种都算治好（用户要求：过期账号自动删）。
    const oldRow = realm.store.codearts.find(a => a.id === 'codearts-old')
    if (oldRow) assert(oldRow.enabled === false, '旧账号未真的停用')
    else assert(realm.calls.some(c => c.method === 'account.delete'), '旧账号既不在池中也没被 delete，状态不明')
    console.log('[B4] 旧账号结局: ' + (oldRow ? '已停用' : '已自动清理（停用+过期）'))
    assert(seq.includes('usage.badge'), '登录成功后应重取余额')

    // 治愈曲线：新号进池、旧号停用后，同一模型必须从「令牌过期」翻成「可用」。
    const afterChips = realm.render()
      .filter(n => typeof n.props?.className === 'string' && n.props.className.startsWith('ofmq_chip'))
      .map(n => String(n.children))
    console.log('[B4] 重登后胶囊: ' + JSON.stringify(afterChips))
    assert(afterChips.some(t => /^可用$/.test(t)), '重登成功后应出现「可用」: ' + afterChips)
    assert(!afterChips.some(t => /令牌过期/.test(t)), '旧号已停用，不该再报令牌过期: ' + afterChips)
  }

  // 登录失败：绝不能停用旧账号
  {
    const realm = makeRealm({ loginFails: true })
    let tree = realm.render()
    tree.find(n => n.props?.className === 'ofmq_refresh').props.onClick()
    await settle(400)
    tree = realm.render()
    tree.find(n => n.props?.className === 'ofmq_expandbtn').props.onClick()
    await settle(400)
    realm.calls.length = 0
    tree = realm.render()
    tree.filter(n => n.props?.className === 'ofmq_mini login')[0].props.onClick()
    await settle(4500)
    assert(!realm.calls.some(c => c.method === 'account.update'), '登录失败时不得停用旧账号')
    assert(realm.store.codearts[0].enabled === true, '旧账号必须仍然可用')
    // note 走 models（第 6 个 useState）→ patchEntry 同时写了模块级 modelCache，
    // 所以重新渲染就能读到；查 DOM 比查 hook 写入序列更贴近用户所见。
    const notes = realm.render()
      .filter(n => typeof n.props?.className === 'string' && n.props.className.startsWith('ofmq_modelnote'))
      .map(n => String(n.children))
      .join(' | ')
    assert(/登录失败|用户取消了授权/.test(notes), '失败原因必须显示出来: ' + notes)
    assert(realm.render().some(n => n.props?.className === 'ofmq_modelnote err'), '失败提示应为红色样式')
    console.log('[B5] 登录失败：旧号保持可用，原因已显示 → ' + notes.slice(0, 80))
  }

  // ── 场景 6：清理死号 —— 只删「已停用 且（无续期材料 或 已过期）」，
  //     并且绝不把渠道删空（还剩 0 个启用账号时一个都不动）。
  {
    const realm = makeRealm({})
    // 手动摆三种停用账号 + 一个健康启用账号
    realm.store.codearts.push(
      { id: 'dead-refreshless', enabled: false, refreshable: false },
      { id: 'dead-expired', enabled: false, refreshable: true, expiresAt: NOW - 5000 },
      { id: 'alive-disabled-usable', enabled: false, refreshable: true, expiresAt: NOW + 5 * DAY },
    )
    const before = realm.store.codearts.length
    // 与 prime() 同理：先点刷新把 cache.active 填好，**重新渲染**才有渠道行
    let tree = realm.render()
    tree.find(n => n.props?.className === 'ofmq_refresh').props.onClick()
    await settle(2)
    tree = realm.render()
    tree.find(n => n.props?.className === 'ofmq_expandbtn').props.onClick()
    await settle(4)
    const survivors = realm.store.codearts.map(a => a.id)
    console.log(`[C] 清理前 ${before} 个 → 现存 ${survivors.length} 个: ${survivors.join(', ')}`)
    assert(survivors.includes('codearts-old'), '启用账号必须保留')
    assert(!survivors.includes('dead-refreshless'), '停用+无续期材料应被清理')
    assert(!survivors.includes('dead-expired'), '停用+已过期应被清理')
    assert(survivors.includes('alive-disabled-usable'), '停用但令牌仍有效的不该删（还能重新启用）')
    assert(realm.calls.some(c => c.method === 'account.delete'), '应发出 account.delete')
  }

  // ── 场景 7：整渠道都在“死”状态时不许删空（必须留一个）
  {
    const realm = makeRealm({})
    realm.store.codearts = [
      { id: 'only-dead-1', enabled: false, refreshable: false },
      { id: 'only-dead-2', enabled: false, refreshable: true, expiresAt: NOW - 1 },
    ]
    let tree2 = realm.render()
    tree2.find(n => n.props?.className === 'ofmq_refresh').props.onClick()
    await settle(2)
    tree2 = realm.render()
    tree2.find(n => n.props?.className === 'ofmq_expandbtn').props.onClick()
    await settle(4)
    assert(realm.store.codearts.length === 2, '没有启用账号时不得清理，否则渠道被删空')
    assert(!realm.calls.some(c => c.method === 'account.delete'), '不该发 account.delete')
    console.log('[C2] 无启用账号 ⇒ 一个都没删（避免把渠道清空）')
  }

  console.log('ALL MODEL/RELOGIN CHECKS PASS')
})().catch(e => { console.error('threw: ' + (e && e.stack || e)); process.exit(1) })
