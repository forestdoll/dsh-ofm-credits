// dsh-ofm-credits — host face.
//
// 这个插件的所有数据都来自 dsh-our-free-model 的 channel-pack 在
// `connection.fetch` 上注册的 `/api/channel-pack` RPC（credits.balances /
// usage.badge / provider.status）。浏览器半区通过 shell 的 connection
// 服务直接调用它 —— 与 our-free-model 自己的设置页完全同一条路径，
// 因此宿主半区不需要做任何事：不打上游、不落盘、不注册路由。
//
// 宿主半区必须存在（loader 需要一个 bundle 入口），但保持最小：
// 不注入任何服务，apply 只写一行日志。这保证它永远不可能因为
// 服务缺失而把整个插件的启动拖挂。

export const name = 'dsh-ofm-credits'

/** 不使用任何宿主服务，空注入即立刻激活。 */
export const inject = []

export function apply(ctx) {
  try {
    ctx?.logger?.info?.('dsh-ofm-credits host ready (data flows through the channel-pack RPC in the browser half)')
  } catch {
    // 日志失败不影响插件本身。
  }
}
