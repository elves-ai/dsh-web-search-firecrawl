# Harness 0.2 适配 / Harness 0.2 migration

## 中文

插件 `1.1.0` 起适用本指南。本次适配以本地 `deepseek-harness` 的 `0.2.1-rc.5`（`b830ec950f`）为基准。需要 Cordis `4.0.5`、Schemastery `3.18.5` 和 Node.js `^22.19.0 || >=24.0.0`；不兼容旧 Harness `0.1.x`。

- 配置入口移至 **插件 → Firecrawl 插件详情**（`plugins.bundle.config`），不再注册独立设置导航项；表单与开关跟随 Harness 浅色、深色主题，窄详情面板自动改为上下布局。
- YAML 配置键不变。设置页现在通过 Harness 已认证的 `settings.describe` / `settings.mutate` Remote API 读写 profile 的 `cordis.patch.yml`，不再提供 `/firecrawl/api`。自定义集成须改用标准 Remote API。
- 保持 bundle 中的 `web-search-firecrawl` entry id，它也是设置页使用的 namespace。Harness 负责导入旧 `settings.yaml`；迁移时需挂载插件，以便识别同名配置段。
- TypeScript 的 `Config` 现在包含 `Volatile` 引用；`FirecrawlSettings` 仍表示普通配置值。Cordis/Loader 会解析 schema；手动调用 `apply` 时需传入 `Config(rawSettings)`，不能直接传普通对象。运行中的引用由 Loader 更新，每次搜索只读取一次配置快照。
- 「清除」移除 profile 字段覆盖并恢复继承值，不会删除 bundle 或环境变量中的密钥。请勿把含密钥的 profile patch 提交到版本库。
- DeepSeek 回退读取当前官方配置描述，保留账号认证与请求日志；credentials 服务存在时，以其解析结果为准，不会绕过它读取环境变量。
- 已移除对 `dsh-client-runtime`、`dsh-client-web-react`、`dsh-client-schema-form` 和 `dsh-invariants` 的依赖。旧 `/invariant` 导出保留为空操作，已有 companion 挂载可移除。
- bundle 替换整个 `web.config` 时同时保留 `fetchProvider: http`。如需其他 fetch provider，请在后续 profile patch 中同时指定 search/fetch 配置。

先升级 Harness，再安装适配后的插件，重启并硬刷新网页。本仓库修改不会自动发布 npm 包；验证未发布的本地版本可先在插件目录执行 `pnpm install && pnpm run build && pnpm run test:built`，再从 Harness 源码根目录执行：

```sh
pnpm dsh plugin --profile web add /absolute/path/to/dsh-web-search-firecrawl
```

安装命令会修改 profile；在正常部署流程中按需执行。

## English

This guide applies to plugin `1.1.0` and later. This adaptation targets the local Harness `0.2.1-rc.5` checkout (`b830ec950f`), Cordis `4.0.5`, Schemastery `3.18.5`, and Node.js `^22.19.0 || >=24.0.0`. Harness `0.1.x` is not supported.

- Configuration now lives in **Plugins → Firecrawl plugin details** (`plugins.bundle.config`), with no separate Settings navigation entry. The form and shared switch follow both Harness color schemes and stack controls in narrow detail panes.
- YAML keys are unchanged. Settings now use Harness's authenticated `settings.describe` / `settings.mutate` Remote API and persist to the profile's `cordis.patch.yml`. The standalone `/firecrawl/api` endpoint is no longer available.
- Keep the bundle entry id `web-search-firecrawl`; the custom page uses it as its namespace. Harness imports legacy `settings.yaml` sections while their owning plugins are mounted.
- The exported TypeScript `Config` contains `Volatile` references; `FirecrawlSettings` remains the plain-value type. Cordis/Loader resolves the schema. Direct callers must use `apply(ctx, Config(rawSettings))`. Loader updates preserve the running provider, which snapshots settings once per search.
- Clearing a field restores its inherited value, not necessarily an empty value. Composition and environment credentials remain available. Do not commit profile patches containing secrets.
- The DeepSeek fallback preserves official account authentication and request logging. A mounted credentials service remains authoritative; a missing credential does not bypass it through the environment.
- Removed runtime/schema-form/web-react client packages and runtime invariants are no longer dependencies. The legacy `/invariant` export remains an inert compatibility entry; its profile mount can be removed.
- The bundle preserves `fetchProvider: http` when replacing `web.config`. Later profile patches selecting another fetch provider must restate both selections.

Upgrade Harness before installing the adapted plugin, then restart and hard-refresh the browser. Repository changes do not publish an npm release. To test an unpublished local version, build it with `pnpm install && pnpm run build && pnpm run test:built`, then run the installation command above from the Harness checkout; it modifies the chosen profile.
