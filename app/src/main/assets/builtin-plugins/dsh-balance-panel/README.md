# dsh-balance-panel · DSH 模型余额面板

> 仓库名 `dsh-model-balance`；npm 包名 **`@wycto/dsh-balance-panel`**（scoped 命名，绑定 npm 账号 wycto，杜绝包名冲突；旧无前缀名 `dsh-balance-panel` 已废弃）。
> DeepSeek Harness 插件：在侧边栏底部显示当前 DSH 配置的**所有**模型 Provider 的账号余额，
> 点击打开余额面板查看每个 Provider 的模型列表、密钥状态与余额明细。

![DSH](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4d9fff)
![License](https://img.shields.io/badge/license-MIT-green)

---

## 功能特性

- **只列已配置项**：只展示你在 settings 里**实际配置过**的 Provider（user/base 层有 profile，或为默认模型选中的 Provider）与其**实际配置的模型**；休眠声明与 schema 默认的全量模型列表不会出现。
- **真实余额**：内置 DeepSeek 官方 `/user/balance` 接口；其他 Provider 可自定义余额接口（见下文）。
- **密钥状态**：每个 Provider 显示其 `apiKeyEnv` 凭证是否已配置（密钥本身永不出 Host 进程）。
- **侧边栏入口**：设置按钮旁的小胶囊显示当前余额摘要（如 `余额 64.23 CNY`），每 5 分钟自动刷新。
- **余额面板**：点击胶囊打开全屏面板，逐 Provider 展示模型 chips、余额明细（总额/赠送/充值）与状态徽标。
- **优雅降级**：无密钥 / 接口不支持 / 查询失败都给出明确文案，不影响其他 Provider（不支持的显示「不支持」）。

## 工作原理

```
┌────────────────────────── 浏览器（Client 半身 lib/client.js）──────────────────────────┐
│  tool.view.cordis        ← Run 卡片内嵌余额视图（最新一次运行卡片内）                     │
│  sidebar.footer.action   ← 余额胶囊（摘要 + 点击开面板）                                  │
│  shell.overlay           ← 余额面板（已配置的 Provider / 模型 / 余额）                    │
│          │  GET /dsh-balance-panel（同源 fetch，每 5 分钟 + 手动刷新）                          │
└──────────┼───────────────────────────────────────────────────────────────────────────────┘
           ▼
┌────────────────────────── Host 进程（Host 半身 lib/host.js）─────────────────────────────┐
│ 1. llm.listConfigurableProviders()  →  声明目录（含休眠条目，逐个过滤）                   │
│ 2. settings.describe({redactSecrets}) → 按 user/base 层定位已配置 profile（默认值不算）   │
│ 3. credentials.describe/resolve    →  密钥状态 / 密钥值（只在本进程内使用）               │
│ 4. 余额策略 → fetch 余额接口（DeepSeek /user/balance 或 profile.balance 自定义）          │
│ 5. webServer 注册 GET /dsh-balance-panel，返回归一化 JSON                                     │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

## 目录结构

```
dsh-balance-panel/
├── package.json           # npm 包元数据 + dsh 元数据（bundle.patch / client.inject）
├── cordis.patch.yml       # 插件加载行（- insert: { id: dsh-balance-panel, name: 包名 }）
├── lib/                   # 发布产物（files 只发布 lib/ + 上述文件）
│   ├── host.js            #   Host 半身（ESM；Node 全局 fetch；注册 /dsh-balance-panel 路由）
│   └── client.js          #   浏览器半身（__ModuleLoader__ 格式 bundle，由 src/client.js 生成）
├── src/                   # 源码
│   ├── host.js            #   Host 半身源码（= lib/host.js）
│   └── client.js          #   浏览器半身源码（纯 JS，React.createElement，无 JSX）
├── scripts/
│   └── build-client.mjs   # 把 src/client.js 打包成 lib/client.js（无需 esbuild）
├── README.md              # 本文档
├── LICENSE                # MIT
└── .gitignore
```

**为什么是这个结构？** DSH 的插件约定：一个 npm 包 = 一个插件，`cordis.patch.yml` 提供一行 loader 行
（`name` 指向包名），Host 半身由 `main`/`exports["."]` 解析，浏览器半身由 `exports["./client"]` +
`dsh.client.inject` 元数据解析。`lib/` 是发布产物、`src/` 是源码，改代码后 `npm run build` 重新生成客户端。

## 安装

### 方式一：profile 用户（推荐，`dsh` CLI）

```sh
dsh plugin --profile web add @wycto/dsh-balance-panel
```

> 等价于在 `~/.dsh/profiles/web` 里执行 `pnpm add @wycto/dsh-balance-panel`。
> 包声明了 `dsh.bundle.patch`，装好后会自动进入插件的 layer 栈并生效。

重启 Web UI（或刷新 `http://127.0.0.1:3080`）。

### 方式二：源码运行（`pnpm dsh web`）

```sh
# 把本目录放进仓库，例如 scratch-plugin/
pnpm dsh web --patch ./dsh-balance-panel/cordis.patch.yml
```

### 方式三：本地开发调试

```sh
cd dsh-balance-panel
pnpm install          # 安装 peer 依赖（@deepseek-ai/cordis 等，profile 里已有可跳过）
pnpm dsh web --patch ./cordis.patch.yml
```

## 使用

1. 启动 DSH Web UI，侧边栏底部（设置按钮旁）出现 **余额胶囊**：
   - `余额 64.23 CNY` —— 有可用余额的 Provider 摘要（取第一个）；
   - `余额 …` —— 首次加载中；
   - `余额 —` —— 尚无可用余额数据（如所有 Provider 都不支持查询）；
   - `余额 ×` —— 数据加载失败。
2. 点击胶囊打开 **余额面板**：每个 Provider 一张卡片，包含：
   - 名称（默认 Provider 带「默认」徽标）与状态徽标（可用 / 不支持 / 未配置密钥 / 查询失败）；
   - Provider id、API 类型、baseURL、密钥引用（`apiKeyEnv`）及是否已配置；
   - 该 Provider 下所有模型 chips；
   - 余额明细：货币、总额、赠送余额、充值余额（来自接口 `balance_infos`）。
3. 面板右上角可 **手动刷新**；胶囊每 5 分钟自动刷新一次。

## 支持的余额接口与自定义

| Provider（id 或 baseURL 家族自动匹配） | 余额接口 | 类型 | 说明 |
| --- | --- | --- | --- |
| `deepseek` / `deepseek-official` | `GET {base}/user/balance` | 余额（¥） | 内置，开箱即用 |
| `stepfun`（`*.stepfun.com`） | `GET {base}/accounts` | 余额（¥） | 官方接口 |
| `kimi-coding`（`api.kimi.com`） | `GET {base}/v1/usages` | 配额（周+小时） | 官方接口，含额度维度与重置时间 |
| `openrouter`（`openrouter.ai`） | `GET {base}/api/v1/auth/key` | Credit（$） | 官方接口 |
| `minimax`（`api.minimax.chat`） | `GET {base}/v1/token_plan/remains` | 剩余额度 | 官方接口 |
| `xai` / `grok`（`api.x.ai`） | `GET {base}/v1/dashboard/billing/credit_grants` | Credit（$） | 官方接口 |
| `qwen-token-plan-cn` 等（百炼/dashscope） | 无 API | 需登录 | 面板显示「去控制台查看余额」链接 |
| `xiaomi`（xiaomimimo） | 无 API | 需登录 | 同上 |
| 其他 OpenAI 兼容 Provider | 无标准接口 | 不支持 | 可自定义（见下） |

> 策略匹配顺序：**profile 自定义 `balance` 配置 > provider id（含别名，大小写不敏感）> baseURL 家族正则**。所以用网关代理了 StepFun/Kimi 等官方端点时，只要 baseURL 域名匹配就会自动命中对应解析器；密钥引用可用配置的 `apiKeyEnv`，缺省回退到各策略默认的环境变量名（如 `STEPFUN_API_KEY`、`OPENROUTER_API_KEY`）。

**为任意 Provider 自定义余额接口**：在 settings 中该 Provider 的 profile 里加一个 `balance` 字段：

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      api: openai-completions
      baseURL: https://gateway.example.com/v1
      apiKeyEnv: MY_GATEWAY_API_KEY
      models:
        - id: my-model
      balance:                       # ← 插件读取的自定义余额配置
        endpoint: /billing/balance   # 相对 baseURL，或完整 URL
        auth: bearer                 # bearer（默认）或 none
```

> `endpoint` 为 `/xxx` 时拼接在 `baseURL` 后；为 `https://...` 时直接使用。
> `auth: none` 时请求不带 Authorization 头（适用于网关内网余额接口）。

## 常见问题（FAQ）

**Q：为什么我的 Provider 显示「不支持」？**
A：该 Provider 没有内置余额接口、也未配置 `balance.endpoint`。按上节配置自定义接口即可；
纯 OpenAI 兼容端点通常不提供余额 API，可先向你的服务商确认是否有查询余额的端点。

**Q：显示「未配置密钥」？**
A：`apiKeyEnv` 指向的凭证未配置。请把凭证放进 DSH 凭证系统
（如 `~/.dsh/.credentials.yaml`，格式 `KEY_NAME: value`）或设置同名环境变量。

**Q：密钥安全吗？**
A：密钥只通过 `credentials.resolve` 在 Host 进程内解析使用，余额请求由 Host 发出，
浏览器端拿到的只是余额结果，密钥不会进入任何前端或日志。

**Q：面板打不开 / 胶囊不出现？**
A：确认插件已加载（启动日志应出现 dsh-balance-panel 相关行），并刷新页面；
再确认部署的 Web 是回环访问（localhost），`/dsh-balance-panel` 路由只在回环 webServer 上注册。

**Q：没有 pnpm，`dsh plugin` 用不了？**
A：npm 同样可以：`cd ~/.dsh/profiles/<profile名> && npm install @wycto/dsh-balance-panel`，
然后把 `"@wycto/dsh-balance-panel"` 追加到该目录 `package.json` 的 `dsh.profile.bundles` 列表，重启即可
（等价于 `dsh plugin add` 的效果）。

## 开发与构建

```sh
npm run build          # 重新生成 lib/client.js（src/client.js → __ModuleLoader__ 格式）
```

客户端源码是纯 JS（`React.createElement`，无 JSX），只依赖 `react`（web 平台 seed），
因此构建脚本无需 esbuild；若后续引入更多依赖，把依赖加入 `package.json` 的
`dsh.client.inject` 并改用 esbuild `--bundle --format=cjs` 即可。

## 分享到社区

1. **发布 npm**：改好 `package.json` 的 `repository`/`homepage` 后 `npm publish`。
   关键元数据已就位：`dsh.bundle.patch`（自动进 layer 栈）、`dsh.client`（浏览器半身发现）、
   `files`（只发布必要文件）。
2. **开源 GitHub**：`git init && git add . && git commit`，推到你的仓库，附上本 README 与截图。
3. 用户安装只需一条命令：`dsh plugin --profile web add @wycto/dsh-balance-panel`。

## License

[MIT](./LICENSE)
