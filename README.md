# 快问

快问，问你想问。一个自部署的粘贴即问 AI 工具：放入命令、英文、报错或日志，直接得到解释、翻译或排查建议。

## 功能

- **单次提问**：自动识别，也可指定翻译、解释命令、排查报错。每次请求独立，不携带历史上下文。
- **自动或手动发送**：默认粘贴立即发送，输入停顿 3 秒后发送；支持关闭自动发送，延迟可选 1 / 3 / 5 / 10 秒。
- **可靠取消**：清空、切换页面、模型或意图会取消待发送任务；中文输入法选字时不发送；编辑期间会停止旧请求。页面进入后台会取消待发送任务。
- **流式回答**：边生成边显示，可停止生成，停止和异常中断会明确标记。提供重新生成、复制回答。
- **阅读体验**：Markdown、表格、代码高亮和代码块复制；不执行模型返回的 HTML，也不加载回答中的远程图片。
- **本地历史**：最多 30 条单次问答，可搜索、回看、删除、清空。历史只在当前浏览器保存，不会作为新请求上下文；可关闭并清除。超出约 150 万字符时优先淘汰最旧记录。
- **模型档案**：多个 OpenAI 兼容模型，首页快速切换、获取模型列表和测试实际对话接口。
- **服务端密钥**：API Key 保存在服务器，已有密钥不会回传浏览器；编辑时留空保留，修改 Base URL 后须重新输入。
- **登录与稳定性**：登录限流、请求超时、断开连接时取消生成、配置串行原子保存。

## 本地运行

需要 **Node.js 22.12+**（建议 Node.js 22 最新补丁版）。

```bash
npm ci
npm run dev
```

打开 `http://localhost:5173`，后端默认 `http://localhost:3000`。仅本地开发时默认密码为 `kuaiwen`。首次登录后添加模型，首页即可提问。

可将 `.env.example` 复制为 `.env` 设置密码等变量。`npm run dev` 和 `npm start` 会自动读取 `.env`，不需要额外安装 dotenv。Windows PowerShell 使用 `Copy-Item .env.example .env`。

构建并运行：

```bash
npm run build
npm start
```

此时打开 `http://localhost:3000`。

## 模型配置

1. 打开“设置”，填写显示名称、Base URL、API Key 和模型名称。
2. 可获取模型列表，也可以直接填写服务商给出的模型名称。
3. “测试连接”会向选定模型发一条简短请求，可能产生少量用量。
4. 保存后返回首页，在“当前模型”中选择要使用的档案。

Base URL 可以是根地址（自动加 `/v1`），也可以包含明确的基础路径：

| 输入                                 | 最终对话接口                                          |
| ------------------------------------ | ----------------------------------------------------- |
| `https://api.example.com`            | `https://api.example.com/v1/chat/completions`         |
| `https://api.example.com/v1`         | `https://api.example.com/v1/chat/completions`         |
| `https://gateway.example.com/api/v3` | `https://gateway.example.com/api/v3/chat/completions` |

完整基础路径会原样保留，不要填写含 `/chat/completions` 的完整接口地址。服务需要支持 Chat Completions 文本对话；推荐支持 SSE 流式输出，也兼容收到流式参数后直接返回 JSON 的服务。获取模型列表需要 `/models`，缺少此接口不影响手动配置。

配置保存在 `data/config.json`。已有服务端配置可直接继续使用，不需要重新填写密钥。早期浏览器中的配置会在服务端无档案时迁移。旧版接口 `/api/config` 的整表写入方式已替换为逐档案操作，升级前端和后端应同时进行。

## Docker 部署

### 从源码构建

复制 `.env.example` 为 `.env`，设置：

```env
KUAIWEN_PASSWORD=请替换为至少12位的独立密码
KUAIWEN_SESSION_SECRET=请替换为至少32位的随机字符串
```

可运行 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 生成会话密钥。

```bash
docker compose up -d --build
```

Compose 将配置保存在挂载目录 `./data`。容器内配置路径固定为 `/app/data/config.json`，不受本地开发路径影响。生产模式拒绝默认密码、短密码或示例会话密钥，配置不正确时会退出并显示原因。

### 预构建镜像

GitHub 发布标签会构建并推送镜像。**本文新增功能需要发布包含这些更改的新镜像后，才能通过镜像部署获取**。发布后可使用以下配置，将镜像版本替换为需要的标签：

```yaml
name: kuaiwen
services:
  kuaiwen:
    image: ghcr.io/kontayun/kuaiwen:latest
    restart: unless-stopped
    environment:
      KUAIWEN_PASSWORD: "${KUAIWEN_PASSWORD}"
      KUAIWEN_SESSION_SECRET: "${KUAIWEN_SESSION_SECRET}"
      KUAIWEN_CONFIG_PATH: /app/data/config.json
    volumes:
      - ./data:/app/data
    ports:
      - "3000:3000"
```

### HTTPS 和反向代理

公网访问请启用 HTTPS。若通过**一层可信反向代理**访问，设置 `KUAIWEN_TRUST_PROXY=1` 和 `KUAIWEN_SECURE_COOKIE=true`，并限制客户端只能通过该代理连接后端。代理需保留外部 `Host`，设置正确的 `X-Forwarded-Proto` 和 `X-Forwarded-For`，供来源检查、Secure Cookie 和按 IP 限流使用。代理层数应与实际部署一致，不要无条件信任客户端传入的转发头。

Nginx 对 `/api/ask` 关闭缓冲（`proxy_buffering off`），读取超时应高于应用请求超时；应用也会返回 `X-Accel-Buffering: no`。否则浏览器可能等到全部生成完才看到回答。

## 环境变量

| 变量                         | 默认值             | 说明                                         |
| ---------------------------- | ------------------ | -------------------------------------------- |
| `PORT`                       | `3000`             | 后端端口；自定义开发端口时同时调整 Vite 代理 |
| `KUAIWEN_PASSWORD`           | `kuaiwen`          | 开发密码；生产至少 12 位且不能为示例值       |
| `KUAIWEN_SESSION_SECRET`     | 启动时随机生成     | 生产必须显式设置至少 32 位随机密钥           |
| `KUAIWEN_CONFIG_PATH`        | `data/config.json` | 服务端配置路径                               |
| `KUAIWEN_REQUEST_TIMEOUT_MS` | `90000`            | 单个模型请求总超时，允许 100–600000 毫秒     |
| `KUAIWEN_SECURE_COOKIE`      | `false`            | 设置为 `true` 后只通过 HTTPS 发送 Cookie     |
| `KUAIWEN_TRUST_PROXY`        | `0`                | 后端前方可信代理的层数                       |

## 数据与安全

- 单实例、单密码，适合个人使用；不是多用户隔离系统。模型切换会更新实例的默认模型，其他已打开页面在刷新后读取新默认值。
- `data/config.json` 中包含明文 API Key，请限制服务器目录权限并妥善备份，不要提交 Git。新配置文件使用 `0600` 权限创建（Windows 权限遵循系统 ACL）。原子写入针对单进程；不要让多个实例共享同一配置文件。
- 登录失败按 IP 限制为每 15 分钟最多 10 次，限流状态在重启后重置。会话有效期为 7 天，更换会话密钥使所有旧会话失效。
- 每次最多输入 50,000 字符，同时最多 4 个生成请求。模型超时、取消或断线会终止上游连接；服务商是否停止计费取决于其实现。
- 退出登录隐藏当前输入和回答，但保留此浏览器的历史记录。共用电脑请关闭历史保存或使用清空历史；历史并未加密。
- 剪贴板按钮需要 HTTPS 或 localhost 及浏览器授权，无法授权时仍可手动粘贴和选中复制。
- 模型命令分析仅作辅助，不会执行命令；执行前仍需确认影响。

## 开发验证

```bash
npm test
npm run build
npx playwright install chromium
npm run test:ui
npm audit
```

后端测试和浏览器测试使用临时配置与本地模拟模型，不使用真实密钥，不产生模型费用。浏览器测试使用端口 31380，运行前请先构建。测试覆盖鉴权、密钥保留、并发写入、流式解析、超时、取消、输入法、自动发送、Markdown、安全渲染、历史和移动端布局。

`qs` 显式覆盖为修复版本，因为 Express 4 的依赖范围仍锁在旧的小版本。构建工具归入开发依赖，Docker 使用 `npm ci` 保持可重复安装。CI 对 push / PR 执行测试和构建，发布流程通过同样检查后才推送镜像。

## 许可证

[MIT](./LICENSE)
