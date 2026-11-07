# dsh-ofm-credits

DeepSeek Harness 插件：**实时显示 our free model（dsh-our-free-model）插件里各个渠道账号的余额**。
A DeepSeek Harness plugin that shows every our-free-model channel account's balance live, right under the composer.

## 前置条件 / Requirements

- 已安装并启用 `dsh-our-free-model`（本插件的所有数据都来自它的 channel-pack RPC，不独立工作）。
- 已在 our free model 的「渠道账号」页登录过至少一个账号。

## 效果

- 输入框下方的状态栏多一颗胶囊：`● 免费积分 5,848`（可确认积分合计，只计入积分制渠道）。
- 点击胶囊弹出明细面板，逐渠道、逐账号显示：
  - 渠道行：CodeArts / WorkBuddy / LobsterAI / Qoder / TRAE / Loomy / Raccoon / MiniMax / Cline / ZCode / Gemini / OpenCode 免费车道，各带品牌色、账号数与渠道汇总；
  - 账号行：昵称 + 主读数（积分 / `$` 美元 / Token（K/M 缩写）/ 配额百分比 / 通道可用性）；
  - 积分包明细：包名、剩余/总额、到期日（已失效的划线灰显）；
  - 套餐信息（buddy/qoder/zcode 的订阅套餐行）。
- 每 30 秒自动轮询；读取走 our-free-model 的 `usage.badge`（服务端 120 秒缓存，稳态不打上游）。「刷新」按钮强制直查上游。
- **「一键续期」按钮**（面板右上，紧挨「刷新」）：逐渠道 `account.list` 拿账号，对启用且 `refreshable !== false` 的账号逐个调 `account.refresh` —— 与 our-free-model 设置页每行那颗「续期」按钮是同一条 RPC、同一实现（令牌是否到期、要不要真的发请求，判断全在宿主侧，本插件不臆测）。跑完若有换发，自动带 force 重取余额；结果一行汇总（已换发 / 未到期 no-op / 失败 / 跳过 + 上游首条原因）。OpenCode 免费车道是匿名通道、没有令牌可续，不进入续期列表。
- **「模型状态」展开**（每个渠道行右上）：展开后逐模型一行，显示可用状态胶囊 +「探测」+「重新登录」（判死的模型还多一颗「复活」）。
  - 状态判据全部来自本地/缓存读（`model.list` 目录含 `disabled`/`dead`；`account.list` 账号含 `modelRateLimits`/`expiresAt`/`enabled`），**不发推理请求、不花积分**，因此可以常显。六种状态：可用 / 已关闭 / 已判死 / 限流至 HH:mm / 令牌过期 / 无启用账号。
  - 「可用」按**逐账号**判定：有一个账号能用就算能用。全不能用时，只要还有「仅在等限流解封」的号就报「限流至 X」（到点自愈，值得等），否则才报「令牌过期」（必须重新登录）—— 这两个动作对用户完全不同，不混为一谈。
  - 「探测」是这里**唯一**打上游的按钮（宿主 `account.test`：发一次最小请求、花该渠道积分），所以只由手点触发，绝不进 30 秒轮询。
  - 「重新登录」挂在每个模型行上只是就近入口，做的是渠道级动作。顺序有讲究：`account.create` 把新账号追加到数组**尾部**，而适配器 `getAvailableAccount` 取「第一个启用且凭据可解析」的账号 —— 所以登录成功**之前**绝不动旧号（动了会一个可用号都不剩），成功**之后**必须逐个停用旧号，否则新令牌一直被旧号挡在门外（这正是 CodeArts 稳定 403 而手签请求 200 的形态）。停用前重读账号池，避免漏掉快照之后新增的账号。
- **卡住修复**：宿主对 codearts 的授权超时（180 秒）走的是 **`removeAccount` 删号**、不写 `pendingLoginFailures`，于是 `login.poll` 对那个 id 永远只回 `done:false`。客户端每轮顺带回读账号池，发现占位账号已被回收就立刻收尾（等待上限也从 10 分钟收到 4 分钟）。忙碌状态同时改为**按动作分类**（探测／登录／复活各自独立），登录在途不再锁死探测按钮。
- **死号自动清理**：每次展开渠道时顺带删除「**已停用** 且（令牌已过期 **或** 无续期材料）」的账号。删除不可逆（宿主 `removeAccount` 连凭据一起 `unset`），故三条护栏：只碰停用账号（启用中一律不动）；渠道里**必须还剩一个启用账号**才动手（绝不删空）；缺 `expiresAt` 且 `refreshable` 为真时不删（某些渠道宿主不写该字段，宁留不误删）。正在等待授权的占位账号由 `relogin` 自己管，清理跳过登录进行中的渠道。
- 收到 our-free-model 的 `ofm:channels` 广播（别的页面登录账号、领取积分）后自动补一轮。

## 数据来源

全部来自 dsh-our-free-model 的 channel-pack 在 `connection.fetch` 上注册的 `/api/channel-pack` RPC：

| RPC | 用途 |
| --- | --- |
| `provider.status` | 轻量本地读，判断哪些渠道有账号 |
| `usage.badge` | 服务端缓存（120s，失败 15s）的余额快照，只含启用账号 |
| `account.list` | 一键续期前置 + 模型状态：该渠道账号的 `enabled` / `refreshable` / `expiresAt` / `modelRateLimits` |
| `account.refresh` | 一键续期本体：宿主按 provider 分派到各自的 `refreshAccountCredential` |
| `model.list` | 模型目录，含 `disabled`（用户关的）与 `dead`（判死的） |
| `account.test` | 探测：真发一次最小请求，返回 `ok` / `message` / `resetTimeMs` |
| `account.create` | 重新登录：起一次该渠道的 OAuth，返回 `{accountId, loginUrl}` |
| `login.poll` | 轮询上面那次登录是否完成（`done` / `success` / `error`） |
| `account.update` | 登录成功后停用旧账号（`patch.enabled = false`） |
| `model.clearDead` | 复活：把模型移出「已判死」名单 |

浏览器半区通过 shell 的 `connection` 服务调用，与 our-free-model 自己的设置页完全同一条路径——凭据永远只在凭据库里，本插件不接触任何 token。

## 安装

### 方式一：dshmarket（推荐）

打开 DSH 的插件市场（dshmarket），在「从 GitHub 安装」里填入本仓库地址：

```
https://github.com/forestdoll/dsh-ofm-credits
```

装完**重启 DeepSeek Harness**（新增插件无法热载入）。

### 方式二：手动（desktop profile）

1. 编辑 `~/.dsh/profiles/desktop/package.json`：
   - `dependencies` 加 `"dsh-ofm-credits": "github:forestdoll/dsh-ofm-credits"`；
   - `dsh.profile.bundles` 数组加 `"dsh-ofm-credits"`（建议放在 `"dsh-our-free-model"` 之后）。
2. 在 profile 目录执行安装（用 DSH 自带的 pnpm，或任何 ≥9 的 pnpm）：
   ```sh
   cd ~/.dsh/profiles/desktop && pnpm install
   ```
3. 重启 DeepSeek Harness。

### 方式三：本地源码直接链（开发时）

```sh
# package.json: "dsh-ofm-credits": "file:<源码目录>"，其余同方式二
```

## 卸载

从 `dependencies` 与 `dsh.profile.bundles` 移除 `dsh-ofm-credits`，`pnpm install`，重启应用；或直接走 dshmarket 的卸载入口。

## 统计口径

- 可确认积分合计 = 所有积分制渠道（CodeArts、两个 WorkBuddy、LobsterAI、两个 Qoder、TRAE、Loomy、Raccoon、MiniMax）中**启用账号**的余额总和。Cline（美元）、ZCode（Token）、Gemini（配额）、OpenCode（通道）不计入合计，在各自渠道行单独显示。
- 「查询失败」的渠道不计入合计（与「已用光」区分开——0 是用完，失败是读不到）。
- 查询失败/部分失败时胶囊圆点变橙；全部失败或 RPC 不可用变红并显示 `OFM 未就绪`（等 our-free-model 的 channel-pack 加载完成后自动恢复）。

## 测试

```sh
node test/contract.cjs client.js     # ModuleLoader 契约 + 渲染冒烟测试，无需启动 DSH
node test/copy-parity.cjs client.js  # 中英文 COPY 键集与 {占位符} 一致性
node test/renew.cjs client.js        # 一键续期：账号过滤 + 换发/no-op/失败/RPC 不可用四种收尾
node test/models.cjs client.js       # 模型状态判据表 + 重新登录的 RPC 顺序（含失败时不动旧号）
```

## 更新记录 / Changelog

见 [CHANGELOG.md](CHANGELOG.md)。

MIT License.
