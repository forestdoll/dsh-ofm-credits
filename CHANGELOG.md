# 更新记录 / Changelog

本文件记录 `dsh-ofm-credits` 的变更。版本号遵循语义化版本，与 `package.json` 的 `version` 一致。

> 说明：1.1.0 与 1.2.0 的中间形态从未提交到 git，其功能合并计入下面的 1.3.0 条目；1.3.0 之前仓库里只有一个提交（1.0.1）。

---

## 1.3.1 — 2026-11-07

**修复：明细面板浮层被窗口裁切、定位错乱。**

根因不在轮询或 RPC，而在浮层的定位方式违反了宿主契约：粘滞 composer（`.an3WzG_composerSeat`，`position:sticky` + `will-change:transform` + 独立合成层）会成为 `position:fixed` 后代的**包含块**，于是面板的 `left/top` 与 `window.innerWidth` 钳制全部被解析进 composer 自己的坐标空间。表现是面板右缘溢出窗口、圆角与投影被裁、「一键续期」贴死在屏幕边上。宿主对槽位 `conversation.composer.dock` 的说明原话即：*"fixed overlays must portal to the document body because the docked composer contains them."*

- **浮层 portal 到 `document.body`**：防御式 `require('react-dom')` 取 `createPortal`（`react-dom` 是 shell 启动图里的平台种子模块，无需构建步骤）；取不到则退回就地渲染，旧宿主不致于整体不可用。
- **定位改为现读胶囊 `getBoundingClientRect()`**：不再记住点击那一刻的坐标快照 —— composer 会随 transcript 滚动、窗口会改尺寸，快照必然过期。
- **上下翻转兜底**：优先向上贴；上边放不下（hero 布局里胶囊靠近顶部，面板高达 `min(68vh,600px)`）就翻到胶囊下方；两边都挤不下才退化为贴住视口内，绝不溢出窗口。监听 `resize` 与捕获阶段的 `scroll`，读数 / 续期提示条 / 展开的模型行变化都会重新贴位（这些都会改变面板高度）。
- **入场动画不再吃掉定位**：`@keyframes ofmq-in` 原本带 `to{transform:none}`，而 CSS 动画优先级高于内联样式，会在动画期间把定位用的 `translateY(-100%)` 整个覆盖掉（面板先向下挂、动画结束再跳上去）。现在只动 `opacity`，首帧 `visibility:hidden` 测完高度再显形。
- **点胶囊可以关面板**：外点关闭原本会先把面板关掉、胶囊的 click 再把它打开，导致胶囊永远关不掉面板；现在跳过胶囊自身的指针事件，切换交回 `onClick`。
- 顺带：`anchor` 坐标 state 换成胶囊的 `pillRef`；`client.js` / `package.json` 在 `file:` 依赖下不是硬链接，改动需同步到被 serve 的 `node_modules` 副本。

**测试**

- `test/models.cjs`：假 React 的 harness 按 `useState` 的**位置序号**认 hook，删掉 `anchor` state 后 `expanded` 从第 7 前移到第 6，已同步。
- `test/models.cjs`：夹具的 `NOW` 原本写死为 2026-11-03 的时间戳，而 `modelStatus` 默认拿 `Date.now()` 比较 —— 过了几天就把「刚换发的新令牌」判成已过期，B4 因此假失败（该失败早于本次改动）。改为跟随真实时钟。
- `test/renew.cjs`：hook 顺序注释同步。
- 四个测试全绿：`contract` / `copy-parity` / `renew` / `models`。

## 1.3.0 — 2026-11-02

**「一键续期」+ 逐模型可用状态。**

- **「一键续期」按钮**（面板右上，紧挨「刷新」）：逐渠道 `account.list` 拿账号，对启用且 `refreshable !== false` 的账号逐个调 `account.refresh` —— 与 our-free-model 设置页每行那颗「续期」是同一条 RPC、同一实现；令牌是否到期、要不要真的发请求，判断全在宿主侧。
  - 宿主对「未到续期窗口」的 `refreshAccountCredential` 是 **no-op**，所以不能把「RPC 没报错」说成「续期成功」。判据改为可观测事实：续期前后各读一次 `expiresAt`，确实推后了才算换发。结果一行汇总（已换发 / 未到期 no-op / 失败 / 跳过 + 上游首条原因）；有换发才带 force 重取余额。
  - OpenCode 免费车道是匿名通道、没有令牌可续，不进入续期列表（channel-pack 对它没有分支，落到 default 会抛 `Unknown provider`）。
- **「模型状态」展开**（每个渠道行右上）：逐模型一行，状态胶囊 +「探测」+「重新登录」（判死的模型再加「复活」）。
  - 状态判据全部来自本地/缓存读（`model.list` 的 `disabled`/`dead`，`account.list` 的 `modelRateLimits`/`expiresAt`/`enabled`），**不发推理请求、不花积分**，因此可以常显。六种状态：可用 / 已关闭 / 已判死 / 限流至 HH:mm / 令牌过期 / 无启用账号。
  - 「可用」按**逐账号**判定：有一个账号能用就算能用。全不能用时，只要还有「仅在等限流解封」的号就报「限流至 X」（到点自愈，值得等），否则才报「令牌过期」（必须重新登录）—— 这两个动作对用户完全不同，不混为一谈。
  - 「探测」是这里**唯一**打上游的按钮（宿主 `account.test`，真发一次最小请求、花该渠道积分），只由手点触发，绝不进 30 秒轮询。
  - 「重新登录」是渠道级动作，只是就近挂在模型行上。顺序有讲究：`account.create` 把新账号追加到数组**尾部**，而适配器取「第一个启用且凭据可解析」的账号 —— 登录成功**之前**绝不动旧号（动了会一个可用号都不剩），成功**之后**必须逐个停用旧号，否则新令牌一直被旧号挡在门外（这正是 CodeArts 稳定 403 而手签请求 200 的形态）。停用前重读账号池，避免漏掉快照之后新增的账号。
- **卡住修复**：宿主对 codearts 的授权超时（180 秒）走的是 `removeAccount` 删号、不写 `pendingLoginFailures`，于是 `login.poll` 对那个 id 永远只回 `done:false`，界面一路死等到上限且整排按钮被登录态锁死。现在每轮顺带回读账号池，占位账号被回收就立刻收尾（等待上限也从 10 分钟收到 4 分钟）；忙碌状态改为**按动作分类**（探测／登录／复活各自独立）。
- **死号自动清理**：展开渠道时顺带删除「已停用 且（令牌已过期 或 无续期材料）」的账号。删除不可逆（宿主连凭据一起 `unset`），三条护栏：只碰停用账号；渠道里必须还剩一个启用账号才动手（绝不删空）；缺 `expiresAt` 且 `refreshable` 为真时不删（宁留不误删）。跳过正在等待授权的渠道。
- 数据来源新增 8 条 channel-pack RPC（`account.list` / `account.refresh` / `model.list` / `account.test` / `account.create` / `login.poll` / `account.update` / `model.clearDead`）。
- 新增测试：`test/copy-parity.cjs`（中英文 COPY 键集与 `{占位符}` 一致性）、`test/renew.cjs`、`test/models.cjs`。

## 1.0.1 — 2026-11-01

首个版本（唯一一次早期提交）。

- 输入框下方状态栏胶囊 `● 免费积分 5,848`：可确认积分合计，只计入积分制渠道。
- 点击展开明细面板：逐渠道（品牌色 + 账号数 + 渠道汇总）、逐账号（昵称 + 积分 / `$` 美元 / Token K/M / 配额百分比 / 通道可用性）、积分包明细（包名、剩余/总额、到期日，失效的划线灰显）、订阅套餐行。
- 数据全部来自 channel-pack 的 `provider.status` + `usage.badge`，经 shell `connection` 服务调用，与 our-free-model 设置页同一条路径；凭据永不离开凭据库。
- 30 秒轮询、页面不可见时跳过、服务端 120 秒徽标缓存兜底、「刷新」按钮带 force 越缓存直查上游。
- 模块级缓存：切会话/重挂载先渲染旧读数，不闪空白。
- 主题变量配色，跟随明暗；中英双语。
- `test/contract.cjs`：ModuleLoader 契约 + 渲染冒烟测试，无需启动 DSH。
