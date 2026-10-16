/**
 * `dsh-bazi` 包根入口：Web 界面的 Host 半边座位。
 *
 * 浏览器半边通过 package.json 的 `dsh.client` 声明与 `exports["./client"]`
 * 被 client-modules 扫描器发现；Host 侧没有行为，所以这里是空 apply——
 * 与 dsh-pentest 的 `lib/index.js` 同形。
 *
 * 真正提供 `bazi_*` 工具的 Host 插件在 `./bazi`（`dsh-bazi/bazi`），
 * 由「八字模式」预设的 plugins 列表挂载。
 */

/** Host 插件体——包根这一行没有 Host 侧行为。 */
export function apply() {}
