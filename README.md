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
- 收到 our-free-model 的 `ofm:channels` 广播（别的页面登录账号、领取积分）后自动补一轮。

## 数据来源

全部来自 dsh-our-free-model 的 channel-pack 在 `connection.fetch` 上注册的 `/api/channel-pack` RPC：

| RPC | 用途 |
| --- | --- |
| `provider.status` | 轻量本地读，判断哪些渠道有账号 |
| `usage.badge` | 服务端缓存（120s，失败 15s）的余额快照，只含启用账号 |

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
node test/contract.cjs client.js   # ModuleLoader 契约 + 渲染冒烟测试，无需启动 DSH
```

MIT License.
