/**
 * dsh-ofm-credits — browser face.
 *
 * 在输入框下方的状态栏（conversation.composer.dock）放一颗「免费积分」胶囊，
 * 实时显示 our free model（dsh-our-free-model）channel-pack 里各渠道账号的
 * 余额汇总；点击胶囊弹出明细面板，逐渠道、逐账号展示积分包明细。
 *
 * 数据路径与 our-free-model 自己的设置页完全一致：通过 shell 的 connection
 * 服务调用 channel-pack 在 `/api/channel-pack` 上注册的 RPC——
 *   - `provider.status`：轻量本地读，判断哪些渠道有账号；
 *   - `usage.badge`：服务端带 120 秒缓存的余额快照（失败 15 秒），
 *     只含启用账号，正是为「常驻徽标」设计的端点。
 * 客户端每 30 秒轮询一次：稳态下几乎全部命中服务端缓存，不打上游；
 * 「刷新」按钮带 force 越过缓存直查上游。
 * 「一键续期」按钮逐账号走 channel-pack 的 `account.refresh`（与 our-free-model
 * 设置页那颗「续期」按钮同一条 RPC），成功后自动 force 重取余额。
 *
 * 手写 ModuleLoader bundle：无构建步骤，依赖是 shell 提供的 react 与平台种子
 * 模块 react-dom（只为把浮层 portal 到 document.body；取不到则就地渲染）。
 * 颜色全部走主题变量（--dsw-alias-*），跟随明暗主题。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ofm-credits',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useMemo, useRef, useCallback } = React
    const h = React.createElement
    // 宿主契约（slot `conversation.composer.dock` 的 doc 与 ConversationRoot 设计
    // 说明）：粘滞 composer 有自己的合成层（`will-change:transform` + sticky），
    // 因此它是 fixed 后代的**包含块**——注册进这个槽位的浮层必须 portal 到
    // document.body，否则 left/top 会被解析在 composer 座层的坐标空间里，
    // 视口坐标与钳制全线失效（面板右侧溢出窗口、上下翻转算错）。
    // `react-dom` 是 shell 启动图里的平台种子词（react / react/jsx-runtime /
    // react-dom / react-dom/client），所以无构建步骤也能 require。取不到就
    // 退回就地渲染（旧宿主 / headless lint），至少面板还能用。
    let createPortal = null
    try {
      const reactDom = require('react-dom')
      if (typeof reactDom?.createPortal === 'function') createPortal = reactDom.createPortal
    } catch { createPortal = null }

    // ── 语言：应用文档语言优先，回落浏览器语言 ────────────────────
    const detectZh = (documentLanguage, browserLanguage) => {
      const tag = typeof documentLanguage === 'string' ? documentLanguage : ''
      if (/^zh(-|$)/i.test(tag)) return true
      if (tag !== '' && !/^en(-|$)/i.test(tag)) return false
      const first = Array.isArray(browserLanguage) ? browserLanguage[0] : browserLanguage
      return typeof first === 'string' && /^zh(-|$)/i.test(first)
    }
    const documentLanguage = typeof document !== 'undefined' ? document?.documentElement?.lang : ''
    const browserLanguage = typeof navigator !== 'undefined' ? navigator.languages || navigator.language : ''
    const zh = detectZh(documentLanguage, browserLanguage)

    const COPY = zh ? {
      label: '免费积分',
      pill: '免费积分',
      total: '可确认积分合计',
      loading: '查询中…',
      noAccounts: 'OFM 无账号',
      unavailable: 'OFM 未就绪',
      failed: '读取失败',
      refresh: '刷新',
      refreshing: '查询中…',
      renew: '一键续期',
      renewing: '续期中…',
      renewProgress: '续期中…已换发 {n} 个',
      renewRenewed: '已换发 {n} 个',
      renewNoop: '{n} 个未到期（无需换发）',
      renewFailSuffix: '失败 {fail} 个',
      renewSkipSuffix: '跳过 {skip} 个（停用或无续期材料）',
      renewNone: '没有可续期的账号',
      renewSep: '，',
      renewError: '续期出错：{reason}',
      renewHint: '逐个启用账号走 our-free-model 的续期入口（与设置页每行那颗「续期」同一条 RPC）。令牌已到续期窗口的会真的向鉴权端点换新；未到期的由宿主跳过，这里按有效期是否推后来区分显示。跑完若有换发，自动强刷余额。',
      updated: '更新于 {ago}',
      autoNote: '每 30 秒自动刷新 · 服务端徽标缓存 2 分钟',
      accounts: '{n} 个账号',
      disabledMore: ' · 另有 {n} 个停用',
      empty: '还没有任何渠道账号。到设置 → Our Free Model → 渠道账号里登录后，这里就会显示余额。',
      provError: '查询失败：{reason}',
      creditsUnit: '积分',
      tokensUnit: 'Token',
      quotaUnit: '配额',
      channelUnit: '通道',
      laneOpen: '可用',
      laneNone: '无可用通道',
      expiresAt: '到期 {date}',
      expired: '已失效 {date}',
      plan: '套餐',
      footerNote: '合计只计入积分制渠道；Cline（美元）、ZCode（Token）、Gemini（配额）、OpenCode（通道）在各自渠道行单独显示。',
      noPackHint: 'channel-pack 未应答：请确认 our-free-model 插件已启用，稍后自动重试。',
      close: '关闭',
      modelsLoad: '模型状态',
      modelsHide: '收起模型',
      modelsLoading: '读取中…',
      modelsNone: '该渠道没有可列出的模型',
      modelsError: '模型状态读取失败：{reason}',
      statusOk: '可用',
      statusOff: '已关闭',
      statusDead: '已判死',
      statusLimited: '限流至 {time}',
      statusExpired: '令牌过期',
      statusNoAccount: '无启用账号',
      probe: '探测',
      probing: '探测中…',
      probeHint: '真的发一次最小请求（花该渠道的积分/额度），确认这个模型此刻能不能用。',
      liveOk: '实测可用',
      liveFail: '实测不可用',
      relogin: '重新登录',
      reloginHint: '发起一次新登录（浏览器打开授权页），成功后自动停用同渠道的旧账号。适配器只取「第一个启用且凭据可用」的账号，旧号不停用，新令牌就用不上。',
      reloginStarted: '已打开授权页，等待你在浏览器完成登录…',
      reloginDone: '登录成功，旧账号已停用',
      reloginTimeout: '等待登录超时，授权链接可能已失效，可重试',
      reloginFailed: '登录失败：{reason}',
      reloginNoUrl: '该渠道的登录不走浏览器授权页，请到 our-free-model 设置页操作',
      clearDead: '复活',
      clearDeadHint: '把该模型从「已判死」名单移除。误判一次会被藏 30 天且没有自愈路径，这个按钮就是那把钥匙。',
      reviveDone: '已移出判死名单',
      pruneDone: '已自动清理 {n} 个失效账号（停用且令牌已过期／无续期材料）',
    } : {
      label: 'Free credits',
      pill: 'Free credits',
      total: 'Confirmed credits total',
      loading: 'querying…',
      noAccounts: 'OFM: no accounts',
      unavailable: 'OFM not ready',
      failed: 'read failed',
      refresh: 'Refresh',
      refreshing: 'querying…',
      renew: 'Renew all',
      renewing: 'renewing…',
      renewProgress: 'renewing… {n} renewed',
      renewRenewed: '{n} renewed',
      renewNoop: '{n} not yet due (no-op)',
      renewFailSuffix: '{fail} failed',
      renewSkipSuffix: '{skip} skipped (disabled / no refresh token)',
      renewNone: 'No accounts to renew',
      renewSep: ', ',
      renewError: 'Renew failed: {reason}',
      renewHint: 'Calls account.refresh once per enabled account — the same entry point the Our Free Model settings page uses. Tokens inside the renewal window are actually re-issued; ones that are not due yet are skipped by the host, and this panel tells the two apart by watching expiresAt move. Force-refreshes balances when anything was re-issued.',
      updated: 'updated {ago}',
      autoNote: 'auto-refresh every 30s · server badge cache 2 min',
      accounts: '{n} account(s)',
      disabledMore: ' · {n} disabled',
      empty: 'No channel accounts yet. Log in via Settings → Our Free Model → channel accounts and balances appear here.',
      provError: 'query failed: {reason}',
      creditsUnit: 'credits',
      tokensUnit: 'tokens',
      quotaUnit: 'quota',
      channelUnit: 'lanes',
      laneOpen: 'open',
      laneNone: 'no open lane',
      expiresAt: 'expires {date}',
      expired: 'expired {date}',
      plan: 'plan',
      footerNote: 'The total counts credit-based channels only; Cline (USD), ZCode (tokens), Gemini (quota) and OpenCode (lanes) are shown on their own rows.',
      noPackHint: 'channel-pack did not answer: make sure the our-free-model plugin is enabled; retried automatically.',
      close: 'Close',
      modelsLoad: 'Models',
      modelsHide: 'Hide models',
      modelsLoading: 'loading…',
      modelsNone: 'No models listed for this channel',
      modelsError: 'model status read failed: {reason}',
      statusOk: 'usable',
      statusOff: 'turned off',
      statusDead: 'dead-listed',
      statusLimited: 'limited until {time}',
      statusExpired: 'token expired',
      statusNoAccount: 'no enabled account',
      probe: 'Probe',
      probing: 'probing…',
      probeHint: 'Sends one real minimal request (spends this channel’s credits/quota) to confirm the model is usable right now.',
      liveOk: 'probed usable',
      liveFail: 'probed unusable',
      relogin: 'Re-login',
      reloginHint: 'Starts a fresh login (opens the authorization page in your browser) and disables this channel’s old accounts once it succeeds. The adapter takes the first enabled account whose credential resolves, so leaving a stale one enabled keeps shadowing the new token.',
      reloginStarted: 'Authorization page opened — finish the login in your browser…',
      reloginDone: 'Logged in; old accounts disabled',
      reloginTimeout: 'Timed out waiting for the login; the link may have expired — try again',
      reloginFailed: 'Login failed: {reason}',
      reloginNoUrl: 'This channel’s login does not use an authorization URL — use the Our Free Model settings page',
      clearDead: 'Revive',
      clearDeadHint: 'Removes this model from the dead list. One false positive hides the model for 30 days with no self-healing path — this is the way out.',
      reviveDone: 'removed from the dead list',
      pruneDone: 'pruned {n} dead account(s) (disabled and expired / no refresh material)',
    }

    // ── 渠道静态表（身份是产品事实，不随读数变化）──────────────────
    // unit 决定数字的口径与是否计入「可确认积分合计」。
    const PROVIDERS = [
      { id: 'codearts', name: 'CodeArts', org: '华为云', accent: '#C7000B', unit: 'credits' },
      { id: 'buddy', name: 'WorkBuddy 国内版', org: '腾讯', accent: '#0A7AFF', unit: 'credits' },
      { id: 'workbuddy', name: 'WorkBuddy 国际版', org: '腾讯', accent: '#0B63CE', unit: 'credits' },
      { id: 'lobsterai', name: 'LobsterAI', org: '有道', accent: '#FF6A00', unit: 'credits' },
      { id: 'qoder', name: 'Qoder', org: '阿里系', accent: '#615CED', unit: 'credits' },
      { id: 'qodercn', name: 'Qoder 中国版', org: '阿里系', accent: '#7A6CF0', unit: 'credits' },
      { id: 'trae', name: 'TRAE', org: '字节', accent: '#00BFA6', unit: 'credits' },
      { id: 'loomy', name: 'Loomy', org: '讯飞', accent: '#2F6BFF', unit: 'credits' },
      { id: 'raccoon', name: 'Raccoon', org: '商汤', accent: '#00A6A6', unit: 'credits' },
      { id: 'minimax', name: 'MiniMax Code', org: 'MiniMax', accent: '#E4007F', unit: 'credits' },
      { id: 'cline', name: 'Cline', org: 'Cline', accent: '#5B5BD6', unit: 'dollars' },
      { id: 'zcode', name: 'ZCode', org: '智谱', accent: '#3B6EF6', unit: 'tokens' },
      { id: 'gemini', name: 'Gemini', org: 'Google Code Assist', accent: '#4285F4', unit: 'quota' },
      { id: 'opencode', name: 'OpenCode 免费车道', org: 'OpenCode', accent: '#10B981', unit: 'channels' },
    ]
    const PROVIDER_IDS = PROVIDERS.map(entry => entry.id)

    const POLL_MS = 30_000
    const STATUS_TIMEOUT_MS = 30_000
    const BADGE_TIMEOUT_MS = 90_000
    const RENEW_TIMEOUT_MS = 90_000
    const PROBE_TIMEOUT_MS = 150_000
    // 宿主的 codearts 授权回调超时是 180 秒，之后它会直接删掉那个账号。
    // 等 4 分钟足够覆盖「宿主删号 + 我们下一轮回读发现」，再久就只是空转。
    const RELOGIN_WAIT_MS = 4 * 60_000
    const RELOGIN_POLL_MS = 2_000
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    // channel-pack 的 `account.refresh` 只认这 13 个 provider（OpenCode 匿名车道
    // 没有令牌可续，落到 default 分支会抛 "Unknown provider"）。
    const RENEWABLE_PROVIDERS = new Set([
      'codearts', 'buddy', 'workbuddy', 'lobsterai', 'qoder', 'qodercn',
      'trae', 'cline', 'loomy', 'raccoon', 'minimax', 'zcode', 'gemini',
    ])

    // ── channel-pack RPC（与 our-free-model 设置页同一条路径）─────
    function channelRpc(ctx) {
      let connection
      try { connection = ctx?.connection } catch { connection = undefined }
      if (connection === undefined && typeof ctx?.get === 'function') {
        try { connection = ctx.get('connection') } catch { connection = undefined }
      }
      const rpc = async (method, payload, timeoutMs = 60_000) => {
        if (connection?.rpc?.call === undefined) throw new Error('no-connection')
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
          const result = await connection.rpc.call('/api', 'channel-pack', { method, payload }, controller.signal)
          if (result?.ok === true) return result.value
          if (result?.ok === false) throw new Error(result.error?.message ?? result.error?.code ?? 'rpc-failed')
          return result
        } finally { clearTimeout(timer) }
      }
      return { available: connection?.rpc?.call !== undefined, rpc }
    }

    // ── 模块级缓存：切会话/重挂载先渲染旧读数，绝不闪空白 ──────────
    let cache = { statuses: null, badges: {}, errors: {}, at: 0, ready: false, active: [], fatal: '', models: {} }
    // 逐渠道的模型状态：`model.list`（目录，含 disabled/dead）+ `account.list`
    // （账号，含 modelRateLimits/expiresAt）都是**本地读**，所以状态可以常显、
    // 零上游成本。live 里存的是「探测」的真请求结论，按模型 id 累积。
    let modelCache = {}
    const modelEntry = pid => modelCache[pid] ?? { loading: false, error: '', at: 0, models: [], accounts: [], live: {}, busy: { probe: null, login: false, revive: null }, note: '', noteError: false }

    // ── 格式化 ─────────────────────────────────────────────────────
    function fmtNum(value) {
      const n = Number(value)
      if (!Number.isFinite(n)) return '—'
      return n.toLocaleString(zh ? 'zh-CN' : 'en-US', { maximumFractionDigits: 2 })
    }
    function kilo(value) {
      const n = Number(value)
      if (!Number.isFinite(n)) return '—'
      if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
      return String(Math.round(n))
    }
    function agoText(at) {
      if (!Number.isFinite(at) || at <= 0) return ''
      const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000))
      if (seconds < 10) return zh ? '刚刚' : 'just now'
      if (seconds < 60) return zh ? `${seconds} 秒前` : `${seconds}s ago`
      if (seconds < 3600) return zh ? `${Math.floor(seconds / 60)} 分钟前` : `${Math.floor(seconds / 60)}m ago`
      if (seconds < 86400) return zh ? `${Math.floor(seconds / 3600)} 小时前` : `${Math.floor(seconds / 3600)}h ago`
      return zh ? `${Math.floor(seconds / 86400)} 天前` : `${Math.floor(seconds / 86400)}d ago`
    }
    function dateText(raw) {
      if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
        const d = new Date(raw)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }
      if (typeof raw === 'string' && raw.length >= 8) return raw.slice(0, 10)
      return ''
    }
    function pkgExpiry(pkg) {
      if (Number.isFinite(pkg?.deductionEndTime) && pkg.deductionEndTime > 0) return dateText(pkg.deductionEndTime)
      return dateText(pkg?.expiredTime)
    }
    function unitLabel(unit) {
      if (unit === 'dollars') return 'USD'
      if (unit === 'tokens') return COPY.tokensUnit
      if (unit === 'quota') return COPY.quotaUnit
      if (unit === 'channels') return COPY.channelUnit
      return COPY.creditsUnit
    }
    /** 账号行右侧的主读数。 */
    function balanceMain(unit, balance) {
      if (!balance || !Number.isFinite(balance.total)) return null
      if (unit === 'dollars') return '$' + Number(balance.total).toFixed(2)
      if (unit === 'tokens') return kilo(balance.total)
      if (unit === 'quota') {
        const pkgs = (Array.isArray(balance.packages) ? balance.packages : []).filter(pkg => pkg?.active !== false)
        return pkgs.length ? pkgs.map(pkg => `${fmtNum(pkg.remaining)}%`).join(' · ') : '—'
      }
      if (unit === 'channels') return Number(balance.total) > 0 ? COPY.laneOpen : COPY.laneNone
      return fmtNum(balance.total)
    }
    /** 渠道行右侧的汇总读数。 */
    function providerTotal(provider, badge) {
      const accounts = Array.isArray(badge?.accounts) ? badge.accounts : []
      if (provider.unit === 'quota') return COPY.quotaUnit
      if (provider.unit === 'channels') {
        const open = accounts.filter(row => Number.isFinite(row?.balance?.total) && row.balance.total > 0).length
        return `${open}/${accounts.length} ${COPY.laneOpen}`
      }
      let sum = 0
      let known = 0
      for (const row of accounts) {
        if (Number.isFinite(row?.balance?.total)) { sum += Number(row.balance.total); known++ }
      }
      if (known === 0) return '—'
      if (provider.unit === 'dollars') return '$' + sum.toFixed(2)
      if (provider.unit === 'tokens') return kilo(sum)
      return fmtNum(sum)
    }
    /** 可确认积分合计：只加积分制渠道里读得出的账号余额。 */
    function sumCredits(badges) {
      let sum = 0
      let known = 0
      for (const provider of PROVIDERS) {
        if (provider.unit !== 'credits') continue
        const badge = badges?.[provider.id]
        if (!badge) continue
        for (const row of Array.isArray(badge.accounts) ? badge.accounts : []) {
          if (Number.isFinite(row?.balance?.total)) { sum += Number(row.balance.total); known++ }
        }
      }
      return { sum, known }
    }
    /**
     * 单个模型的可用状态 —— 不发推理请求，输入全部来自本地/缓存读。
     *
     * 输入是 `model.list` 的条目（`disabled` / `dead` 由宿主照实透传）与该渠道的
     * `account.list` 账号行（带 `modelRateLimits` / `expiresAt` / `enabled`）。
     *
     * 判据是**逐账号**算「此刻能不能用」：限流未到点不能用，令牌已过期不能用，
     * 两者都没沾上才能用。只要有一个能用就是可用；全不能用时，若其中有「只是
     * 在等限流解封」的号，报「限流至 X」（到点会自愈，值得等）；否则才是
     * 「令牌过期」（必须重新登录）。这两个动作对用户完全不同，不能混。
     */
    function modelStatus(model, accounts, now = Date.now()) {
      if (model?.dead === true) return { key: 'dead' }
      if (model?.disabled === true) return { key: 'off' }
      const live = (Array.isArray(accounts) ? accounts : []).filter(a => a?.enabled !== false)
      if (live.length === 0) return { key: 'noAccount' }
      let usable = false
      let waiting = 0
      for (const a of live) {
        const resetAt = a?.modelRateLimits?.[model.id]
        const limited = Number.isFinite(resetAt) && resetAt > now
        // 缺 expiresAt 视为未知（宿主对某些渠道不写该字段），不当过期。
        const expired = Number.isFinite(a?.expiresAt) && a.expiresAt <= now
        if (!limited && !expired) { usable = true; continue }
        if (limited && !expired) waiting = waiting === 0 ? resetAt : Math.min(waiting, resetAt)
      }
      if (usable) return { key: 'ok' }
      if (waiting > 0) return { key: 'limited', until: waiting }
      return { key: 'expired' }
    }
    const STATUS_TONE = { ok: 'ok', off: 'muted', dead: 'err', limited: 'warn', expired: 'err', noAccount: 'err' }
    /** 限流解禁时刻：当天只写 HH:mm，跨天带上日期。 */
    function clockText(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return '—'
      const d = new Date(ms)
      const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      const now = new Date()
      const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
      return sameDay ? hm : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`
    }
    /** 状态 → 文案（限流带上解禁时刻，读起来是「等到几点」而不是「坏了」）。 */
    function statusText(status) {
      switch (status.key) {
        case 'off': return COPY.statusOff
        case 'dead': return COPY.statusDead
        case 'limited': return replace(COPY.statusLimited, { time: clockText(status.until) })
        case 'expired': return COPY.statusExpired
        case 'noAccount': return COPY.statusNoAccount
        default: return COPY.statusOk
      }
    }
    function replace(text, pairs) {
      let out = text
      for (const [key, value] of Object.entries(pairs)) out = out.split(`{${key}}`).join(String(value))
      return out
    }

    // ── 样式 ───────────────────────────────────────────────────────
    const CSS = [
      '.ofmq_pill{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:11px;line-height:1.5;padding:2px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,#d5d9e0);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#f6f7f9) 72%,transparent);color:var(--dsw-alias-label-secondary,#5a6472);cursor:pointer;white-space:nowrap;user-select:none;transition:border-color .16s ease,color .16s ease}',
      '.ofmq_pill:hover{color:var(--dsw-alias-label-primary,#1a2230);border-color:var(--dsw-alias-border-l2,#c3c9d4)}',
      '.ofmq_pill b{font-variant-numeric:tabular-nums;font-weight:640;color:var(--dsw-alias-label-primary,#1a2230)}',
      '.ofmq_pill .ofmq_muted{font-weight:400;color:var(--dsw-alias-label-tertiary,#8a93a2)}',
      '.ofmq_dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary,#8a93a2)}',
      '.ofmq_dot.ok{background:var(--dsw-alias-state-success-primary,#12b76a)}',
      '.ofmq_dot.warn{background:var(--dsw-alias-state-warning-primary,#f0a441)}',
      '.ofmq_dot.err{background:var(--dsw-alias-state-error-primary,#f04438)}',
      '.ofmq_caret{font-size:9px;opacity:.7}',
      '.ofmq_pop{position:fixed;z-index:1300;width:min(432px,94vw);max-height:min(68vh,600px);display:flex;flex-direction:column;border-radius:14px;border:1px solid var(--dsw-alias-border-l2,#c3c9d4);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#ffffff) 96%,transparent);box-shadow:0 18px 50px rgb(0 0 0 / 30%),inset 0 1px 0 rgb(255 255 255 / 7%);overflow:hidden;animation:ofmq-in .18s ease}',
      // 动画只动 opacity：CSS 动画的优先级高于内联样式，若这里写
      // `to{transform:none}`，会把定位用的 translateY(-100%) 在动画期间整个吃掉
      // （面板先向下挂、动画结束再跳上去）。翻转靠 top/bottom，不靠 transform 之外的东西。
      '@keyframes ofmq-in{from{opacity:0}to{opacity:1}}',
      '.ofmq_pophead{display:flex;align-items:flex-start;gap:8px;padding:12px 14px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#d5d9e0)}',
      '.ofmq_poptitle{font-size:12.5px;font-weight:700;color:var(--dsw-alias-label-primary,#1a2230);line-height:1.3}',
      '.ofmq_popsub{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a93a2);margin-top:2px}',
      '.ofmq_refresh{flex:none;font:inherit;font-size:11px;font-weight:560;padding:4px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#c3c9d4);background:color-mix(in srgb,var(--dsw-alias-bg-layer-3,#eef0f4) 80%,transparent);color:var(--dsw-alias-label-secondary,#5a6472);cursor:pointer;transition:color .14s ease,border-color .14s ease}',
      '.ofmq_headbtns{margin-left:auto;flex:none;display:flex;align-items:center;gap:6px}',
      '.ofmq_refresh:hover:not(:disabled){color:var(--dsw-alias-label-primary,#1a2230);border-color:var(--dsw-alias-state-business-primary,#3b82f6)}',
      '.ofmq_refresh[disabled]{opacity:.55;cursor:default}',
      '.ofmq_renew{flex:none;font:inherit;font-size:11px;font-weight:560;padding:4px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#c3c9d4);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#12b76a) 12%,transparent);color:var(--dsw-alias-state-success-primary,#12b76a);cursor:pointer;transition:border-color .14s ease,background .14s ease}',
      '.ofmq_renew:hover:not(:disabled){border-color:var(--dsw-alias-state-success-primary,#12b76a);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#12b76a) 20%,transparent)}',
      '.ofmq_renew[disabled]{opacity:.55;cursor:default}',
      '.ofmq_popnote{font-size:10.5px;line-height:1.5;padding:6px 14px 0;color:var(--dsw-alias-label-tertiary,#8a93a2)}',
      '.ofmq_popnote.err{color:var(--dsw-alias-state-error-primary,#f04438)}',
      '.ofmq_popbody{overflow:auto;padding:8px;display:flex;flex-direction:column;gap:6px}',
      '.ofmq_prov{position:relative;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1,#d5d9e0) 82%,transparent);border-radius:11px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#f6f7f9) 55%,transparent);padding:8px 10px 8px 12px;display:flex;flex-direction:column;gap:6px}',
      '.ofmq_prov::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:2.5px;border-radius:99px;background:var(--prov-accent,#3b82f6);opacity:.9}',
      '.ofmq_provhead{display:flex;align-items:center;gap:8px}',
      '.ofmq_provlogo{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;flex:none;font-size:10.5px;font-weight:800;color:#fff;background:linear-gradient(150deg,var(--prov-accent,#3b82f6),color-mix(in srgb,var(--prov-accent,#3b82f6) 45%,#101828))}',
      '.ofmq_provname{display:flex;flex-direction:column;min-width:0}',
      '.ofmq_provname b{font-size:12px;font-weight:650;color:var(--dsw-alias-label-primary,#1a2230);line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ofmq_provname span{font-size:10px;color:var(--dsw-alias-label-tertiary,#8a93a2)}',
      '.ofmq_provmeta{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-tertiary,#8a93a2);white-space:nowrap}',
      '.ofmq_provtotal{font-size:12px;font-weight:660;font-variant-numeric:tabular-nums;color:var(--dsw-alias-state-success-primary,#12b76a);white-space:nowrap;margin-left:8px}',
      '.ofmq_prov.err .ofmq_provtotal{color:var(--dsw-alias-state-error-primary,#f04438)}',
      '.ofmq_proverr{font-size:10.5px;color:var(--dsw-alias-state-error-primary,#f04438);overflow-wrap:anywhere}',
      '.ofmq_acct{display:flex;align-items:baseline;flex-wrap:wrap;gap:3px 8px;padding:4px 8px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#f6f7f9) 40%,transparent);font-size:11.5px}',
      '.ofmq_acctname{color:var(--dsw-alias-label-secondary,#5a6472);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:48%}',
      '.ofmq_acctval{margin-left:auto;font-weight:650;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#1a2230);white-space:nowrap}',
      '.ofmq_accterr{flex-basis:100%;color:var(--dsw-alias-state-error-primary,#f04438);font-size:10.5px;overflow-wrap:anywhere}',
      '.ofmq_pkgs{flex-basis:100%;display:flex;flex-wrap:wrap;gap:2px 10px}',
      '.ofmq_pkg{font-size:10px;color:var(--dsw-alias-label-tertiary,#8a93a2);font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.ofmq_pkg.off{opacity:.55;text-decoration:line-through}',
      '.ofmq_plan{font-size:10px;color:var(--dsw-alias-label-tertiary,#8a93a2);font-variant-numeric:tabular-nums}',
      '.ofmq_expandbtn{font:inherit;font-size:10.5px;padding:2px 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1,#d5d9e0);background:transparent;color:var(--dsw-alias-label-tertiary,#8a93a2);cursor:pointer;white-space:nowrap}',
      '.ofmq_expandbtn:hover{color:var(--dsw-alias-label-primary,#1a2230);border-color:var(--dsw-alias-border-l2,#c3c9d4)}',
      '.ofmq_models{display:flex;flex-direction:column;gap:3px;padding:5px 2px 2px 12px;border-top:1px dashed color-mix(in srgb,var(--dsw-alias-border-l1,#d5d9e0) 70%,transparent)}',
      '.ofmq_modelnote{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a93a2);padding:2px 6px;line-height:1.5}',
      '.ofmq_modelnote.err{color:var(--dsw-alias-state-error-primary,#f04438)}',
      '.ofmq_mrow{display:flex;align-items:center;gap:6px;font-size:11px;padding:3px 6px;border-radius:7px}',
      '.ofmq_mrow:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-3,#eef0f4) 55%,transparent)}',
      '.ofmq_mname{color:var(--dsw-alias-label-secondary,#5a6472);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:44%}',
      '.ofmq_chip{font-size:9.5px;font-weight:600;padding:1px 7px;border-radius:99px;border:1px solid currentColor;white-space:nowrap}',
      '.ofmq_chip.ok{color:var(--dsw-alias-state-success-primary,#12b76a)}',
      '.ofmq_chip.warn{color:var(--dsw-alias-state-warning-primary,#f0a441)}',
      '.ofmq_chip.err{color:var(--dsw-alias-state-error-primary,#f04438)}',
      '.ofmq_chip.muted{color:var(--dsw-alias-label-tertiary,#8a93a2);opacity:.8}',
      '.ofmq_macts{margin-left:auto;display:flex;align-items:center;gap:5px;flex:none}',
      '.ofmq_mini{font:inherit;font-size:10px;padding:1px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,#d5d9e0);background:transparent;color:var(--dsw-alias-label-tertiary,#8a93a2);cursor:pointer}',
      '.ofmq_mini:hover:not(:disabled){color:var(--dsw-alias-label-primary,#1a2230);border-color:var(--dsw-alias-border-l2,#c3c9d4)}',
      '.ofmq_mini.login{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f04438) 50%,transparent);color:var(--dsw-alias-state-error-primary,#f04438)}',
      '.ofmq_mini.login:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f04438) 10%,transparent);border-color:var(--dsw-alias-state-error-primary,#f04438);color:var(--dsw-alias-state-error-primary,#f04438)}',
      '.ofmq_mini[disabled]{opacity:.5;cursor:default}',
      '.ofmq_mreason{flex-basis:100%;font-size:10px;color:var(--dsw-alias-label-tertiary,#8a93a2);overflow-wrap:anywhere;line-height:1.45}',
      '.ofmq_popfoot{padding:9px 14px;border-top:1px solid var(--dsw-alias-border-l1,#d5d9e0);font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a93a2);display:flex;align-items:center;gap:8px;flex-wrap:wrap;line-height:1.5}',
      '.ofmq_popfoot b{color:var(--dsw-alias-label-secondary,#5a6472);font-variant-numeric:tabular-nums}',
      '.ofmq_empty{padding:18px 14px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a93a2);text-align:center;line-height:1.6}',
    ].join('\n')

    // ── 渠道行 ─────────────────────────────────────────────────────
    function PackageLines(props) {
      const { unit, balance } = props
      const packages = Array.isArray(balance?.packages) ? balance.packages : []
      if (packages.length === 0) return null
      const shown = packages.slice(0, 6)
      const lines = shown.map(pkg => {
        const active = pkg?.active !== false
        const expiry = pkgExpiry(pkg)
        const suffix = unit === 'quota'
          ? `${fmtNum(pkg.remaining)}%`
          : `${fmtNum(pkg.remaining)}${Number.isFinite(pkg.total) && pkg.total > 0 ? ' / ' + fmtNum(pkg.total) : ''}`
        const when = expiry ? (active ? ' ' + replace(COPY.expiresAt, { date: expiry }) : ' ' + replace(COPY.expired, { date: expiry })) : ''
        return { key: String(pkg?.name ?? Math.random()), active, text: `${String(pkg?.name ?? '—')} ${suffix}${when}` }
      })
      return h('div', { className: 'ofmq_pkgs' },
        lines.map(line => h('span', { key: line.key, className: 'ofmq_pkg' + (line.active ? '' : ' off') }, line.text)),
        packages.length > shown.length ? h('span', { className: 'ofmq_pkg' }, `+${packages.length - shown.length}`) : null)
    }

    /**
     * 逐模型行：状态胶囊 + 探测 + 重新登录（判死时再加复活）。
     *
     * 探测是四个动作里**唯一**打上游、要花积分的，所以它只由手点触发，
     * 绝不进 30 秒自动轮询；状态胶囊本身来自纯本地读，可以常显。
     * 「重新登录」挂在每个模型上是用户要的就近入口，但它做的是渠道级动作
     * （一次 account.create 起该渠道的新登录），title 里写明。
     */
    function ModelRows(props) {
      const { provider, entry } = props
      if (entry.loading && entry.models.length === 0) {
        return h('div', { className: 'ofmq_models' }, h('div', { className: 'ofmq_modelnote' }, COPY.modelsLoading))
      }
      if (entry.error !== '') {
        return h('div', { className: 'ofmq_models' }, h('div', { className: 'ofmq_modelnote err' }, replace(COPY.modelsError, { reason: entry.error })))
      }
      const models = Array.isArray(entry.models) ? entry.models : []
      if (models.length === 0) {
        return h('div', { className: 'ofmq_models' }, h('div', { className: 'ofmq_modelnote' }, COPY.modelsNone))
      }
      // 探测要显式指定账号：取第一个启用账号，与适配器选号同一判据，
      // 测的正是平时一直在用的那个号。
      const probeAccount = (entry.accounts ?? []).find(a => a?.enabled !== false)
      // 忙碌状态按动作分类：登录在途（最长 4 分钟）不该锁死探测与复活，
      // 否则「打开授权页又关掉」的那段时间里整排按钮看起来全卡住了。
      const note = entry.note ?? ''
      const busyProbe = entry.busy?.probe ?? null
      const busyLogin = entry.busy?.login === true
      const busyRevive = entry.busy?.revive ?? null
      return h('div', { className: 'ofmq_models' },
        models.map(model => {
          const id = model.id
          const status = modelStatus(model, entry.accounts)
          const live = entry.live?.[id]
          return h('div', { className: 'ofmq_mrow', key: id },
            h('span', { className: 'ofmq_mname', title: id }, String(model.name ?? id)),
            h('span', { className: 'ofmq_chip ' + (STATUS_TONE[status.key] ?? 'muted') }, statusText(status)),
            live ? h('span', { className: 'ofmq_chip ' + (live.ok ? 'ok' : 'err') }, live.ok ? COPY.liveOk : COPY.liveFail) : null,
            h('span', { className: 'ofmq_macts' },
              status.key === 'dead' ? h('button', {
                type: 'button', className: 'ofmq_mini', disabled: busyRevive !== null,
                onClick: () => props.onRevive(provider.id, id), title: COPY.clearDeadHint,
              }, COPY.clearDead) : null,
              h('button', {
                type: 'button', className: 'ofmq_mini',
                disabled: busyProbe !== null || probeAccount === undefined,
                onClick: () => props.onProbe(provider.id, id), title: COPY.probeHint,
              }, busyProbe === id ? COPY.probing : COPY.probe),
              h('button', {
                type: 'button', className: 'ofmq_mini login', disabled: busyLogin,
                onClick: () => props.onRelogin(provider.id, id),
                title: busyLogin ? (entry.note ?? '') : COPY.reloginHint,
              }, busyLogin ? '…' : COPY.relogin)),
            (live?.message ?? '') !== '' ? h('span', { className: 'ofmq_mreason' }, live.message) : null)
        }),
        // 登录/复活的进行中与结果提示整块只写一次，不逐行重复。
        note !== '' ? h('div', { className: 'ofmq_modelnote' + (entry.noteError ? ' err' : '') }, note) : null)
    }

    function ProviderRow(props) {
      const { provider, badge, error } = props
      const accounts = Array.isArray(badge?.accounts) ? badge.accounts : []
      const disabledCount = Number.isFinite(badge?.disabledCount) ? badge.disabledCount : 0
      const failed = error !== undefined && error !== '' || accounts.length === 0
      const meta = replace(COPY.accounts, { n: accounts.length }) +
        (disabledCount > 0 ? replace(COPY.disabledMore, { n: disabledCount }) : '')
      const subscription = badge?.subscription
      const planRows = subscription?.kind === 'plan' && Array.isArray(subscription.accounts)
        ? subscription.accounts.filter(row => row?.plan != null) : []
      const entry = props.entries?.[provider.id] ?? modelEntry(provider.id)
      const expanded = props.expanded?.[provider.id] === true
      return h('div', {
        className: 'ofmq_prov' + (failed ? ' err' : ''),
        style: { '--prov-accent': provider.accent },
      },
        h('div', { className: 'ofmq_provhead' },
          h('span', { className: 'ofmq_provlogo', 'aria-hidden': 'true' }, provider.name.slice(0, 1)),
          h('span', { className: 'ofmq_provname' },
            h('b', null, provider.name),
            h('span', null, provider.org)),
          h('span', { className: 'ofmq_provmeta' }, meta),
          h('span', { className: 'ofmq_provtotal' }, failed ? (error ? COPY.failed : '0') : providerTotal(provider, badge)),
          h('button', {
            type: 'button', className: 'ofmq_expandbtn',
            onClick: () => props.onToggle(provider.id), 'aria-expanded': expanded ? 'true' : 'false',
          }, expanded ? COPY.modelsHide : COPY.modelsLoad)),
        error ? h('div', { className: 'ofmq_proverr' }, replace(COPY.provError, { reason: error })) : null,
        accounts.map(row => h('div', { className: 'ofmq_acct', key: String(row?.accountId ?? Math.random()) },
          h('span', { className: 'ofmq_acctname', title: String(row?.nickname ?? row?.accountId ?? '') },
            String(row?.nickname ?? row?.accountId ?? '—')),
          h('span', { className: 'ofmq_acctval' }, balanceMain(provider.unit, row?.balance) ?? '—'),
          row?.error ? h('span', { className: 'ofmq_accterr' }, String(row.error)) : null,
          h(PackageLines, { unit: provider.unit, balance: row?.balance }))),
        planRows.map(row => h('div', { className: 'ofmq_plan', key: 'plan-' + String(row?.accountId ?? '') },
          `${COPY.plan} ${String(row.plan?.name ?? '—')} ${fmtNum(row.plan?.remaining)} / ${fmtNum(row.plan?.total)} ${String(row.plan?.unit ?? '')}`)),
        expanded ? h(ModelRows, {
          provider, entry,
          onProbe: props.onProbe, onRelogin: props.onRelogin, onRevive: props.onRevive,
        }) : null)
    }

    // ── 弹出面板 ───────────────────────────────────────────────────
    function Popover(props) {
      const { data, busy, onRefresh, onRenew, renew, models, expanded, onToggle, onProbe, onRelogin, onRevive, onClose, anchorRef } = props
      const ref = useRef(null)
      useEffect(() => {
        const onPointerDown = event => {
          if (!(event.target instanceof Node)) return
          if (ref.current !== null && ref.current.contains(event.target)) return
          // 点胶囊本身交给胶囊的 onClick 去收尾（切换关闭）。这里若也关掉，
          // pointerdown 先关、click 再开，胶囊就永远关不掉面板了。
          const pill = anchorRef?.current
          if (pill !== null && pill !== undefined && pill.contains(event.target)) return
          onClose()
        }
        const onKey = event => { if (event.key === 'Escape') onClose() }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [onClose, anchorRef])
      // 位置自己算，不靠 CSS transform：面板挂在 document.body 上（见 createPortal），
      // 坐标是纯视口系的，但 composer 会随 transcript 滚动、窗口会改尺寸，
      // 所以每次都要**现读**胶囊的 rect，而不是记住点击那一刻的数字。
      const [pos, setPos] = useState(null)
      const place = useCallback(() => {
        const panel = ref.current
        const pill = anchorRef?.current
        if (panel === null || pill === null || pill === undefined || !pill.isConnected) return
        const rect = pill.getBoundingClientRect()
        const vw = window.innerWidth
        const vh = window.innerHeight
        const width = Math.min(432, vw * 0.94)
        const height = panel.offsetHeight
        const gap = 10
        const left = Math.max(8, Math.min(rect.left, vw - width - 8))
        // 优先向上贴（胶囊在输入框下方，面板本该朝上开）；上边放不下
        // （hero 布局里胶囊靠近顶部，面板高达 68vh）就翻到下面；两边都挤不下
        // 才退化成「贴住视口内」，绝不溢出窗口。
        const above = rect.top - gap - height
        const below = rect.bottom + gap
        let top = above
        if (top < 8) {
          if (below + height <= vh - 8) top = below
          else top = Math.max(8, Math.min(vh - height - 8, below))
        }
        setPos(value => (value !== null && value.left === left && value.top === top ? value : { left, top }))
      }, [anchorRef])
      // 每次读数/提示条/展开变化都重新贴位（这些都会改变面板高度）。
      // models 也在里面：模型行是展开后异步读回来的，回来那一刻高度又变一次。
      // 首帧 pos 为 null → visibility:hidden，测完高度再显形，不会先跳一下。
      useEffect(() => {
        place()
      }, [place, data, busy, renew, expanded, models])
      useEffect(() => {
        const onMove = () => place()
        window.addEventListener('resize', onMove)
        window.addEventListener('scroll', onMove, true)
        return () => {
          window.removeEventListener('resize', onMove)
          window.removeEventListener('scroll', onMove, true)
        }
      }, [place])
      const style = pos === null
        ? { visibility: 'hidden' }
        : { left: pos.left + 'px', top: pos.top + 'px' }
      const rows = (data.active ?? []).map(id => PROVIDERS.find(entry => entry.id === id)).filter(Boolean)
      const { sum } = sumCredits(data.badges)
      const panel = h('div', { className: 'ofmq_pop', style, ref, role: 'dialog', 'aria-label': COPY.label },
        h('div', { className: 'ofmq_pophead' },
          h('div', null,
            h('div', { className: 'ofmq_poptitle' }, zh ? 'Our Free Model · 账户余额' : 'Our Free Model · account balances'),
            h('div', { className: 'ofmq_popsub' },
              data.at > 0 ? replace(COPY.updated, { ago: agoText(data.at) }) + ' · ' : '',
              COPY.autoNote)),
          h('div', { className: 'ofmq_headbtns' },
            h('button', {
              type: 'button', className: 'ofmq_refresh', disabled: busy,
              onClick: () => onRefresh(true), 'aria-busy': busy ? 'true' : undefined,
            }, busy ? COPY.refreshing : COPY.refresh),
            h('button', {
              type: 'button', className: 'ofmq_renew', disabled: busy || renew.busy,
              onClick: () => onRenew(), title: COPY.renewHint,
              'aria-busy': renew.busy ? 'true' : undefined,
            }, renew.busy ? COPY.renewing : COPY.renew))),
        renew.text !== '' ? h('div', { className: 'ofmq_popnote' + (renew.error ? ' err' : '') }, renew.text) : null,
        h('div', { className: 'ofmq_popbody' },
          data.fatal !== '' ? h('div', { className: 'ofmq_proverr' }, COPY.noPackHint) : null,
          rows.length === 0 && data.fatal === ''
            ? h('div', { className: 'ofmq_empty' }, COPY.empty)
            : rows.map(provider => h(ProviderRow, {
                key: provider.id, provider,
                badge: data.badges?.[provider.id],
                error: data.errors?.[provider.id],
                entries: models, expanded,
                onToggle, onProbe, onRelogin, onRevive,
              }))),
        h('div', { className: 'ofmq_popfoot' },
          h('span', null, `${COPY.total}：`, h('b', null, fmtNum(sum)), ` ${COPY.creditsUnit}`),
          h('span', null, COPY.footerNote)))
      // 契约要求：浮层离开 composer 的包含块，挂到 document.body 上。
      // 样式是注入 <head> 的全局 CSS，portal 之后照常命中。
      return createPortal === null ? panel : createPortal(panel, document.body)
    }

    // ── 主组件：胶囊 + 轮询 ────────────────────────────────────────
    function OfmCreditsBar(props) {
      const ctx = props?.ctx
      const [data, setData] = useState(() => ({ ...cache }))
      const [busy, setBusy] = useState(false)
      const [renew, setRenew] = useState({ busy: false, text: '', error: false })
      const [open, setOpen] = useState(false)
      // 胶囊元素的 ref：面板每次定位都现读它的 rect（composer 会随
      // transcript 滚动、窗口会改尺寸），不再记住点击那一刻的坐标快照。
      const pillRef = useRef(null)
      const inFlight = useRef(null)
      const renewInFlight = useRef(false)
      const openRef = useRef(false)
      openRef.current = open
      const [models, setModels] = useState(() => ({ ...modelCache }))
      const [expanded, setExpanded] = useState(() => ({}))

      const refresh = useCallback((force = false) => {
        if (inFlight.current !== null) return inFlight.current
        const run = (async () => {
          setBusy(true)
          try {
            const { rpc } = channelRpc(ctx)
            // 1) 轻量本地读：哪些渠道有账号。
            const statusValue = await rpc('provider.status', { providers: PROVIDER_IDS }, STATUS_TIMEOUT_MS)
            const statuses = statusValue?.statuses ?? {}
            const active = PROVIDER_IDS.filter(id => (statuses[id]?.accounts?.total ?? 0) > 0)
            // 2) 逐渠道取余额快照（服务端 120 秒缓存；force 直查上游）。
            const results = await Promise.all(active.map(async id => {
              try {
                const value = await rpc('usage.badge', { provider: id, ...(force ? { force: true } : {}) }, BADGE_TIMEOUT_MS)
                return { id, value }
              } catch (error) {
                return { id, error: String(error?.message ?? error) }
              }
            }))
            const badges = {}
            const errors = {}
            for (const result of results) {
              if (result.error !== undefined) errors[result.id] = result.error
              else badges[result.id] = result.value
            }
            cache = { statuses, badges, errors, at: Date.now(), ready: true, active, fatal: '' }
            setData({ ...cache })
          } catch (error) {
            cache = { ...cache, at: Date.now(), ready: false, fatal: String(error?.message ?? error) }
            setData({ ...cache })
          } finally {
            setBusy(false)
          }
        })()
        inFlight.current = run
        void run.finally(() => { if (inFlight.current === run) inFlight.current = null })
        return run
      }, [ctx])

      // modelCache 是模块级可变表，React 看不见它 —— 每次改动都浅拷贝回状态。
      const patchEntry = (pid, patch) => {
        modelCache = { ...modelCache, [pid]: { ...modelEntry(pid), ...patch } }
        setModels({ ...modelCache })
      }
      // busy 是按动作分类的子表，单独走这里合并，省得每个调用点手写展开，
      // 也避免误把整块 busy 覆盖掉（登录在途时探测的写入不能把它清掉）。
      const patchBusy = (pid, patch) => {
        patchEntry(pid, { busy: { ...(modelEntry(pid).busy ?? {}), ...patch } })
      }

      // ── 模型状态：目录 + 账号两次读，都不做推理请求 ────────────────
      // `model.list` 的目录在宿主里是记忆化的（首次拉一次远端目录，之后走
      // 进程内/2 小时文件缓存），`account.list` 只读账号池。两者都不是推理
      // 请求、不花积分，所以「展开即取」；真正花钱的只有下面那个探测。
      // prune=false 用于清理后的那次重读，避免 loadModels ⇄ pruneDead 互递归。
      const loadModels = async (pid, force = false, prune = true) => {
        const cur = modelEntry(pid)
        if (!force && cur.at > 0) return
        patchEntry(pid, { loading: true, error: '' })
        try {
          const { rpc } = channelRpc(ctx)
          const [listValue, accountsValue] = await Promise.all([
            rpc('model.list', { provider: pid }, STATUS_TIMEOUT_MS),
            rpc('account.list', { provider: pid }, STATUS_TIMEOUT_MS),
          ])
          patchEntry(pid, {
            loading: false,
            error: '',
            at: Date.now(),
            models: Array.isArray(listValue?.models) ? listValue.models : [],
            accounts: Array.isArray(accountsValue?.accounts) ? accountsValue.accounts : [],
          })
          // 顺手清理死号；删掉了就重读一次（prune=false 断开互递归），
          // 让界面上的账号数当场对上。
          if (prune) {
            const removed = await pruneDead(rpc, pid, accountsValue?.accounts)
            if (removed > 0) await loadModels(pid, true, false)
          }
        } catch (error) {
          patchEntry(pid, { loading: false, error: String(error?.message ?? error), at: 0 })
        }
      }

      // 探测 = 真发一次最小请求（宿主侧 PROBE_PROMPT，超时 120 秒）。
      // 四个动作里只有它花钱，所以仅由按钮触发，绝不进自动轮询。
      const probeModel = async (pid, modelId) => {
        const cur = modelEntry(pid)
        if ((cur.busy?.probe ?? null) !== null) return
        const account = (cur.accounts ?? []).find(a => a?.enabled !== false)
        if (account === undefined) return
        patchBusy(pid, { probe: modelId })
        let outcome
        try {
          const { rpc } = channelRpc(ctx)
          outcome = await rpc('account.test', { accountId: account.id, modelId }, PROBE_TIMEOUT_MS)
        } catch (error) {
          outcome = { ok: false, message: String(error?.message ?? error) }
        }
        const ok = outcome?.ok === true
        patchBusy(pid, { probe: null })
        patchEntry(pid, {
          live: { ...(modelEntry(pid).live ?? {}), [modelId]: {
            ok,
            message: ok ? '' : String(outcome?.message ?? COPY.liveFail),
            at: Date.now(),
          } },
        })
      }

      /**
       * 重新登录：渠道级动作，按钮挂在模型行上只是就近入口。
       *
       * 顺序很关键 —— `account.create` 把新账号追加到数组**尾部**，而适配器
       * `getAvailableAccount` 取「第一个启用且凭据可解析」的账号：
       *   · 新号登录成功**之前**绝不动旧号（动了会一个可用号都不剩）；
       *   · 成功**之后**必须停用旧号，否则新令牌一直被旧号挡在门外，403 照旧。
       */
      const relogin = async (pid, modelId) => {
        if (modelEntry(pid).busy?.login === true) return
        patchBusy(pid, { login: true })
        patchEntry(pid, { note: '', noteError: false })
        try {
          const { rpc } = channelRpc(ctx)
          const created = await rpc('account.create', { provider: pid }, RENEW_TIMEOUT_MS)
          const accountId = typeof created?.accountId === 'string' ? created.accountId : ''
          const loginUrl = typeof created?.loginUrl === 'string' ? created.loginUrl : ''
          if (accountId === '') throw new Error('account.create 未返回 accountId')
          if (loginUrl !== '') {
            try { window.open(loginUrl, '_blank', 'noopener') } catch { /* 弹窗被拦截时，行内提示仍在 */ }
            patchEntry(pid, { note: COPY.reloginStarted, noteError: false })
          } else {
            patchEntry(pid, { note: COPY.reloginNoUrl, noteError: true })
          }
          // ⚠️ 不能只信 `login.poll`：宿主对 codearts 的授权超时（180 秒）走的是
          // **removeAccount 删号**、不写 pendingLoginFailures —— 那时 poll 对这个 id
          // 永远只回 `done:false`。早先这里一路死等到上限，期间登录态把整个渠道
          // 的按钮全禁用（用户报：「打开登录页后关掉，探测就卡住」）。
          // 所以每轮顺带确认账号还在不在池里：没了就是这次登录没成，立刻收尾。
          const deadline = Date.now() + RELOGIN_WAIT_MS
          let loggedIn = false
          while (Date.now() < deadline) {
            await sleep(RELOGIN_POLL_MS)
            const polled = await rpc('login.poll', { accountId }, STATUS_TIMEOUT_MS)
            if (polled?.done === true && polled.success !== true) {
              throw new Error(String(polled.error ?? 'login failed'))
            }
            let rows = null
            try {
              const check = await rpc('account.list', { provider: pid }, STATUS_TIMEOUT_MS)
              rows = Array.isArray(check?.accounts) ? check.accounts : []
            } catch { rows = null /* 读不到就继续等，交给 deadline */ }
            // 账号被宿主回收 ⇒ 授权已终止，永远不会再成功。
            if (rows !== null && rows.length > 0 && !rows.some(a => a?.id === accountId)) {
              throw new Error('授权未完成（账号已被回收：超时或在页面里取消了）')
            }
            if (polled?.done === true) { loggedIn = true; break }
          }
          if (!loggedIn) {
            patchBusy(pid, { login: false })
            patchEntry(pid, { note: COPY.reloginTimeout, noteError: true })
            return
          }
          // 登录成功：停用同渠道其它启用账号，让新号成为第一个可用候选。
          // 必须**重读**账号池 —— 展开时的快照可能早于登录这几分钟里别处
          // （设置页、另一标签页）新增的账号，用旧快照会漏停一个，新令牌
          // 就还是被那个号挡在门外。
          let pool = []
          try {
            const freshList = await rpc('account.list', { provider: pid }, STATUS_TIMEOUT_MS)
            pool = Array.isArray(freshList?.accounts) ? freshList.accounts : []
          } catch {
            pool = modelEntry(pid).accounts ?? []
          }
          const stale = pool.filter(a => a?.enabled !== false && a.id !== accountId)
          for (const old of stale) {
            // 单个停用失败不致命：适配器按顺序取号，用户可再去设置页手动处理。
            try { await rpc('account.update', { accountId: old.id, patch: { enabled: false } }, STATUS_TIMEOUT_MS) } catch { /* keep going */ }
          }
          patchBusy(pid, { login: false })
          patchEntry(pid, { note: COPY.reloginDone, noteError: false })
          await loadModels(pid, true)
          void refresh(true)
        } catch (error) {
          patchBusy(pid, { login: false })
          patchEntry(pid, {
            note: replace(COPY.reloginFailed, { reason: String(error?.message ?? error) }),
            noteError: true,
          })
        }
      }

      // 复活：从「已判死」名单移除。误判会把该模型藏 30 天且没有自愈路径。
      const reviveModel = async (pid, modelId) => {
        if (modelEntry(pid).busy?.revive != null) return
        patchBusy(pid, { revive: modelId })
        try {
          const { rpc } = channelRpc(ctx)
          await rpc('model.clearDead', { provider: pid, modelId }, STATUS_TIMEOUT_MS)
          patchBusy(pid, { revive: null })
          patchEntry(pid, { note: COPY.reviveDone, noteError: false })
          await loadModels(pid, true)
        } catch (error) {
          patchBusy(pid, { revive: null })
          patchEntry(pid, { note: String(error?.message ?? error), noteError: true })
        }
      }

      /**
       * 清理该渠道的死账号（自动、保守）。
       *
       * 删除是**不可逆**的：宿主 `removeAccount` 会连凭据一起 unset，删了就
       * 得重新登录。所以三条护栏缺一不可：
       *   1. 只碰**已停用**（enabled === false）的账号 —— 启用中的一律不动，
       *      哪怕它看起来过期了（适配器自己会跳过解析失败的凭据，留着不亏）；
       *   2. 只在**还剩至少一个启用账号**时删，绝不把渠道删空；
       *   3. 死号判据 = 令牌已过期 **或** 没有续期材料（`refreshable === false`）；
       *      缺 `expiresAt`（宿主对某些渠道不写）且 refreshable 为真时**不删**，
       *      宁留不误删。
       * 正在等待授权的占位账号由 `relogin` 自己管，这里靠「跳过登录中的渠道」
       * 避开（busy.login）。
       */
      const pruneDead = async (rpc, pid, rows) => {
        if (modelEntry(pid).busy?.login === true) return 0
        const accounts = Array.isArray(rows) ? rows : []
        const now = Date.now()
        const enabledCount = accounts.filter(a => a?.enabled !== false).length
        if (enabledCount === 0) return 0
        const dead = accounts.filter(a => {
          if (a?.enabled !== false) return false
          if (typeof a.id !== 'string' || a.id === '') return false
          if (a.refreshable === false) return true
          return Number.isFinite(a.expiresAt) && a.expiresAt <= now
        })
        let removed = 0
        for (const a of dead) {
          try {
            await rpc('account.delete', { accountId: a.id }, STATUS_TIMEOUT_MS)
            removed++
          } catch { /* 单个删除失败留给下一轮，不打断整批 */ }
        }
        if (removed > 0) patchEntry(pid, { note: replace(COPY.pruneDone, { n: removed }), noteError: false })
        return removed
      }

      const toggleModels = pid => {
        const next = expanded[pid] !== true
        setExpanded({ ...expanded, [pid]: next })
        if (next) void loadModels(pid)
      }

      // 「一键续期」：逐个启用账号走 channel-pack 的 account.refresh，
      // 与 our-free-model 设置页每行那颗「续期」按钮是同一条 RPC、同一实现。
      //
      // ⚠️ 宿主侧的 refreshAccountCredential 在「令牌还没到续期窗口」时是
      // **no-op**（只把有效期校准回账号池就返回）。所以这里不能把「RPC 没报错」
      // 说成「续期成功」——那会让用户以为令牌换了，而 403 照旧。判据用可观测
      // 事实：续期前后各读一次 account.list 的 expiresAt，确实推后了才算换发。
      // 到期与否本身仍由宿主判断，客户端不复制它的提前量常量。
      const renewAll = useCallback(async () => {
        if (renewInFlight.current) return
        renewInFlight.current = true
        setRenew({ busy: true, text: COPY.renewing, error: false })
        let renewed = 0
        let noop = 0
        let fail = 0
        let skip = 0
        let firstError = ''
        const note = (error) => { if (firstError === '') firstError = String(error?.message ?? error) }
        const listAccounts = async (rpc, id) => {
          const value = await rpc('account.list', { provider: id }, STATUS_TIMEOUT_MS)
          return Array.isArray(value?.accounts) ? value.accounts : []
        }
        try {
          const { rpc } = channelRpc(ctx)
          const known = (cache.active ?? []).length > 0 ? cache.active : PROVIDER_IDS
          for (const id of known.filter(id => RENEWABLE_PROVIDERS.has(id))) {
            let accounts = []
            try {
              accounts = await listAccounts(rpc, id)
            } catch (error) {
              // 连账号列表都读不到：留下原因，继续下一个渠道。
              note(error)
              continue
            }
            const targets = accounts.filter(row => typeof row?.id === 'string' && row.id.length > 0
              && row.enabled !== false && row.refreshable !== false)
            skip += accounts.length - targets.length
            if (targets.length === 0) continue
            const before = new Map(targets.map(row => [row.id, Number.isFinite(row.expiresAt) ? row.expiresAt : 0]))
            const attempted = []
            for (const row of targets) {
              try {
                await rpc('account.refresh', { accountId: row.id }, RENEW_TIMEOUT_MS)
                attempted.push(row.id)
              } catch (error) {
                fail++
                note(error)
              }
            }
            if (attempted.length === 0) continue
            // 回读一次有效期，按「有没有真的推后」区分换发与 no-op；
            // 每个渠道只回读一次，不逐账号打 RPC。回读失败则保守计入换发。
            let fresh = null
            try {
              fresh = await listAccounts(rpc, id)
            } catch {
              renewed += attempted.length
              continue
            }
            const after = new Map(fresh.map(a => [a?.id, Number.isFinite(a?.expiresAt) ? a.expiresAt : 0]))
            for (const accountId of attempted) {
              if ((after.get(accountId) ?? 0) > (before.get(accountId) ?? 0)) renewed++
              else noop++
            }
            setRenew({ busy: true, text: replace(COPY.renewProgress, { n: renewed }), error: false })
          }
          const parts = []
          if (renewed > 0) parts.push(replace(COPY.renewRenewed, { n: renewed }))
          if (noop > 0) parts.push(replace(COPY.renewNoop, { n: noop }))
          if (fail > 0) parts.push(replace(COPY.renewFailSuffix, { fail }))
          if (skip > 0) parts.push(replace(COPY.renewSkipSuffix, { skip }))
          const tail = firstError !== '' ? ` · ${firstError.slice(0, 80)}` : ''
          let text
          if (renewed + noop + fail === 0) {
            text = firstError !== '' ? replace(COPY.renewError, { reason: firstError.slice(0, 120) }) : COPY.renewNone
          } else {
            text = parts.join(COPY.renewSep) + tail
          }
          setRenew({ busy: false, text, error: fail > 0 || (renewed === 0 && fail === 0 && firstError !== '') })
          // 令牌真的换发过，余额快照才需要绕开服务端 120 秒缓存重取。
          if (renewed > 0) void refresh(true)
        } catch (error) {
          setRenew({ busy: false, text: replace(COPY.renewError, { reason: String(error?.message ?? error) }), error: true })
        } finally {
          renewInFlight.current = false
        }
      }, [ctx, refresh])

      // 挂载即取数（有新鲜缓存则直接用），之后 30 秒一轮；页面不可见时跳过。
      useEffect(() => {
        if (cache.at === 0 || Date.now() - cache.at > POLL_MS) void refresh(false)
        const timer = setInterval(() => {
          if (document.visibilityState === 'hidden') return
          if (inFlight.current !== null) return
          void refresh(false)
        }, POLL_MS)
        const onVisible = () => {
          if (document.visibilityState !== 'visible') return
          if (Date.now() - cache.at > POLL_MS) void refresh(false)
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [refresh])

      // our-free-model 广播账号/目录变化时（别的标签页登录、领取积分）补一轮。
      useEffect(() => {
        let timer
        const onEvent = () => {
          if (timer !== undefined) clearTimeout(timer)
          timer = setTimeout(() => { void refresh(false) }, 1200)
        }
        window.addEventListener('ofm:channels', onEvent)
        return () => {
          if (timer !== undefined) clearTimeout(timer)
          window.removeEventListener('ofm:channels', onEvent)
        }
      }, [refresh])

      // 打开面板时若读数已过期，顺手补一轮。
      useEffect(() => {
        if (open && Date.now() - cache.at > POLL_MS) void refresh(false)
      }, [open, refresh])

      const { sum, known } = useMemo(() => sumCredits(data.badges), [data])
      const errorCount = Object.keys(data.errors ?? {}).length
      const activeCount = (data.active ?? []).length

      let dotState = 'err'
      let pillText = COPY.unavailable
      if (data.fatal === '' && (data.ready || data.at > 0)) {
        if (activeCount === 0) { dotState = 'warn'; pillText = COPY.noAccounts }
        else if (errorCount > 0 && known === 0) { dotState = 'err'; pillText = COPY.failed }
        else if (errorCount > 0) { dotState = 'warn'; pillText = COPY.pill }
        else { dotState = 'ok'; pillText = COPY.pill }
      } else if (data.at === 0 && !data.ready) {
        dotState = 'err'; pillText = COPY.loading
      }

      // 胶囊 tooltip：逐渠道一行汇总 + 更新时间。
      const tipLines = []
      for (const id of data.active ?? []) {
        const provider = PROVIDERS.find(entry => entry.id === id)
        const badge = data.badges?.[id]
        if (provider === undefined) continue
        const text = data.errors?.[id] !== undefined ? COPY.failed : providerTotal(provider, badge)
        tipLines.push(`${provider.name}：${text}`)
      }
      if (data.at > 0) tipLines.push('', replace(COPY.updated, { ago: agoText(data.at) }))
      const title = tipLines.join('\n')

      const onPillClick = () => {
        setOpen(value => !value)
      }

      return h('span', { className: 'ofmq_wrap' },
        h('button', {
          type: 'button', className: 'ofmq_pill', onClick: onPillClick, ref: pillRef,
          title: title !== '' ? title : COPY.label,
          'aria-haspopup': 'dialog', 'aria-expanded': open ? 'true' : 'false',
        },
          h('span', { className: 'ofmq_dot ' + dotState }),
          pillText === COPY.pill
            ? [h('b', { key: 'v' }, fmtNum(sum)), h('span', { key: 'u', className: 'ofmq_muted' }, ` ${COPY.creditsUnit}`)]
            : [h('span', { key: 't' }, pillText)],
          h('span', { className: 'ofmq_caret', key: 'c', 'aria-hidden': 'true' }, '▾')),
        open ? h(Popover, {
          data, busy, anchorRef: pillRef, renew, models, expanded,
          onRefresh: force => { void refresh(force) },
          onRenew: () => { void renewAll() },
          onToggle: pid => { toggleModels(pid) },
          onProbe: (pid, modelId) => { void probeModel(pid, modelId) },
          onRelogin: (pid, modelId) => { void relogin(pid, modelId) },
          onRevive: (pid, modelId) => { void reviveModel(pid, modelId) },
          onClose: () => setOpen(false),
        }) : null)
    }

    // ── 入口 ───────────────────────────────────────────────────────
    // 宿主可能重放注入（插件热替换、保上下文的重载）：同一 ctx 只登记一次，
    // 否则状态栏会出现第二颗胶囊、各带各的轮询。
    let appliedCtx = null

    function apply(ctx) {
      if (ctx === appliedCtx) return
      appliedCtx = ctx

      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-ofm-credits')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'dsh-ofm-credits: styles')

      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'dsh-ofm-credits',
        order: 11,
        label: () => COPY.label,
      }, slotProps => h(OfmCreditsBar, { ...slotProps, ctx })))
    }

    return { inject: ['slots'], apply }
  },
})
