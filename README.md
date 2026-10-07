# opsd 经典控制台

这是独立控制台主题，源码与构建资源不随 opsd 主镜像分发。运行时只连接真实 Hub，不提供演示模式。

## 开发与打包

要求 Node.js 22 或更新版本。

```bash
npm ci
npm run api:generate
npm run package -- --out releases/web.zip
```

ZIP 根目录包含 theme.json、index.html 和构建资源，不包含源码或依赖。通过 Hub 上传安装，或将 ZIP 作为独立 GitHub 发行版资产提供；安装后单独选择应用。尚未完成集中业务验收，不发布正式主题制品。

## 官方契约

package.json 的 opsd.api_ref 固定为 `320cbf0c1c971c32f4b640e769ce31e2c4445157`。npm run api:fetch 只获取该提交的官方 OpenAPI；缓存位于忽略的 .cache/。生成类型在 src/generated/api.ts，业务代码在本仓库独立实现，不依赖相邻主仓库。

接口、包格式、恢复入口和内置前端配合见 [官方主题说明](https://github.com/opsd-labs/opsd/blob/320cbf0c1c971c32f4b640e769ce31e2c4445157/docs/console-themes.md)。

## 本地连接

设置 OPSD_TARGET 为 Hub HTTPS 地址、OPSD_ENTRANCE 为其安全入口，运行 npm run dev。API、SSE 与 WebSocket 使用安全入口首段，不拼接主题资源基址。完整主题切换会重新进入首页；有终端或未提交表单时需先确认，后台任务继续执行。

## 验证边界

使用 opsd 现有云端 CI，当前主仓库固定检出独立主题提交进行契约和构建检查，不另建流水线。原有单元测试保留，浏览器测试使用 tests/fixtures/ 的网络响应，运行时仍走认证入口。 三套前端的真实登录、CSRF、任务、终端和文件操作在内置前端配合完成后集中验收。C091 部署不属于当前主题源码迁移的完成结果。
