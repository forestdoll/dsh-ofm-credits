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
 *
 * 手写 ModuleLoader bundle：无构建步骤，唯一依赖是 shell 提供的 react。
 * 颜色全部走主题变量（--dsw-alias-*），跟随明暗主题。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ofm-credits',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useMemo, useRef, useCallback } = React
    const h = React.createElement

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
    let cache = { statuses: null, badges: {}, errors: {}, at: 0, ready: false, active: [], fatal: '' }

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
      '@keyframes ofmq-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
      '.ofmq_pophead{display:flex;align-items:flex-start;gap:8px;padding:12px 14px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#d5d9e0)}',
      '.ofmq_poptitle{font-size:12.5px;font-weight:700;color:var(--dsw-alias-label-primary,#1a2230);line-height:1.3}',
      '.ofmq_popsub{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a93a2);margin-top:2px}',
      '.ofmq_refresh{margin-left:auto;flex:none;font:inherit;font-size:11px;font-weight:560;padding:4px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#c3c9d4);background:color-mix(in srgb,var(--dsw-alias-bg-layer-3,#eef0f4) 80%,transparent);color:var(--dsw-alias-label-secondary,#5a6472);cursor:pointer;transition:color .14s ease,border-color .14s ease}',
      '.ofmq_refresh:hover:not(:disabled){color:var(--dsw-alias-label-primary,#1a2230);border-color:var(--dsw-alias-state-business-primary,#3b82f6)}',
      '.ofmq_refresh[disabled]{opacity:.55;cursor:default}',
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
          h('span', { className: 'ofmq_provtotal' }, failed ? (error ? COPY.failed : '0') : providerTotal(provider, badge))),
        error ? h('div', { className: 'ofmq_proverr' }, replace(COPY.provError, { reason: error })) : null,
        accounts.map(row => h('div', { className: 'ofmq_acct', key: String(row?.accountId ?? Math.random()) },
          h('span', { className: 'ofmq_acctname', title: String(row?.nickname ?? row?.accountId ?? '') },
            String(row?.nickname ?? row?.accountId ?? '—')),
          h('span', { className: 'ofmq_acctval' }, balanceMain(provider.unit, row?.balance) ?? '—'),
          row?.error ? h('span', { className: 'ofmq_accterr' }, String(row.error)) : null,
          h(PackageLines, { unit: provider.unit, balance: row?.balance }))),
        planRows.map(row => h('div', { className: 'ofmq_plan', key: 'plan-' + String(row?.accountId ?? '') },
          `${COPY.plan} ${String(row.plan?.name ?? '—')} ${fmtNum(row.plan?.remaining)} / ${fmtNum(row.plan?.total)} ${String(row.plan?.unit ?? '')}`)))
    }

    // ── 弹出面板 ───────────────────────────────────────────────────
    function Popover(props) {
      const { data, busy, onRefresh, onClose, anchor } = props
      const ref = useRef(null)
      useEffect(() => {
        const onPointerDown = event => {
          if (ref.current !== null && event.target instanceof Node && !ref.current.contains(event.target)) onClose()
        }
        const onKey = event => { if (event.key === 'Escape') onClose() }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [onClose])
      const style = {}
      if (anchor !== null) {
        const width = Math.min(432, window.innerWidth * 0.94)
        style.left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)) + 'px'
        style.top = Math.max(8, anchor.top - 10) + 'px'
        style.transform = 'translateY(-100%)'
      } else { style.right = '8px'; style.bottom = '8px' }
      const rows = (data.active ?? []).map(id => PROVIDERS.find(entry => entry.id === id)).filter(Boolean)
      const { sum } = sumCredits(data.badges)
      return h('div', { className: 'ofmq_pop', style, ref, role: 'dialog', 'aria-label': COPY.label },
        h('div', { className: 'ofmq_pophead' },
          h('div', null,
            h('div', { className: 'ofmq_poptitle' }, zh ? 'Our Free Model · 账户余额' : 'Our Free Model · account balances'),
            h('div', { className: 'ofmq_popsub' },
              data.at > 0 ? replace(COPY.updated, { ago: agoText(data.at) }) + ' · ' : '',
              COPY.autoNote)),
          h('button', {
            type: 'button', className: 'ofmq_refresh', disabled: busy,
            onClick: () => onRefresh(true), 'aria-busy': busy ? 'true' : undefined,
          }, busy ? COPY.refreshing : COPY.refresh)),
        h('div', { className: 'ofmq_popbody' },
          data.fatal !== '' ? h('div', { className: 'ofmq_proverr' }, COPY.noPackHint) : null,
          rows.length === 0 && data.fatal === ''
            ? h('div', { className: 'ofmq_empty' }, COPY.empty)
            : rows.map(provider => h(ProviderRow, {
                key: provider.id, provider,
                badge: data.badges?.[provider.id],
                error: data.errors?.[provider.id],
              }))),
        h('div', { className: 'ofmq_popfoot' },
          h('span', null, `${COPY.total}：`, h('b', null, fmtNum(sum)), ` ${COPY.creditsUnit}`),
          h('span', null, COPY.footerNote)))
    }

    // ── 主组件：胶囊 + 轮询 ────────────────────────────────────────
    function OfmCreditsBar(props) {
      const ctx = props?.ctx
      const [data, setData] = useState(() => ({ ...cache }))
      const [busy, setBusy] = useState(false)
      const [open, setOpen] = useState(false)
      const [anchor, setAnchor] = useState(null)
      const inFlight = useRef(null)
      const openRef = useRef(false)
      openRef.current = open

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

      const onPillClick = event => {
        const rect = event.currentTarget.getBoundingClientRect()
        setAnchor({ left: rect.left, top: rect.top })
        setOpen(value => !value)
      }

      return h('span', { className: 'ofmq_wrap' },
        h('button', {
          type: 'button', className: 'ofmq_pill', onClick: onPillClick,
          title: title !== '' ? title : COPY.label,
          'aria-haspopup': 'dialog', 'aria-expanded': open ? 'true' : 'false',
        },
          h('span', { className: 'ofmq_dot ' + dotState }),
          pillText === COPY.pill
            ? [h('b', { key: 'v' }, fmtNum(sum)), h('span', { key: 'u', className: 'ofmq_muted' }, ` ${COPY.creditsUnit}`)]
            : [h('span', { key: 't' }, pillText)],
          h('span', { className: 'ofmq_caret', key: 'c', 'aria-hidden': 'true' }, '▾')),
        open ? h(Popover, {
          data, busy, anchor,
          onRefresh: force => { void refresh(force) },
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
