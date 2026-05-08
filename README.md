# 快问

快问，问你想问。

快问是一个自部署的粘贴即问 AI 工具。你可以把命令、英文、报错、日志或配置片段粘贴进去，它会自动判断你最可能想问什么，并直接给出解释、翻译、排查建议或安全分析。

## 功能

- 粘贴内容后立即自动发送。
- 手动输入停止 3 秒后自动发送。
- `Enter` 立即发送，`Shift + Enter` 换行。
- 命令分析：说明大致功能、安全性、读写/删除/联网/提权风险，并逐段拆解。
- 英文翻译：自动翻译成更自然的中文。
- 报错解释：解释错误含义、常见原因和排查步骤。
- 登录保护，适合公网自部署。
- 支持 OpenAI 兼容接口。
- 支持保存多个模型档案，并在设置页切换当前模型。
- 模型配置保存在服务器，换设备登录后可继续使用。

## 快速开始

```bash
npm install
npm run dev
```

开发模式下：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3000`

## Docker 部署

### 使用预构建镜像

发布版镜像会推送到 GitHub Container Registry。服务器不需要安装 Node.js，也不需要编译前端。

```bash
mkdir -p kuaiwen/data
cd kuaiwen
```

创建 `docker-compose.yml`：

```yaml
name: kuaiwen

services:
  kuaiwen:
    image: ghcr.io/kontayun/kuaiwen:latest
    container_name: kuaiwen
    restart: unless-stopped
    environment:
      KUAIWEN_PASSWORD: "your-strong-password"
      KUAIWEN_SESSION_SECRET: "your-long-random-secret"
      KUAIWEN_CONFIG_PATH: "/app/data/config.json"
    volumes:
      - ./data:/app/data
    ports:
      - "3000:3000"
```

启动：

```bash
docker compose up -d
```

### 从源码构建

复制环境变量示例：

```bash
cp .env.example .env
```

编辑 `.env`，至少修改：

```env
KUAIWEN_PASSWORD=your-strong-password
KUAIWEN_SESSION_SECRET=your-long-random-secret
KUAIWEN_CONFIG_PATH=/app/data/config.json
```

启动：

```bash
docker compose up -d --build
```

访问：

```text
http://服务器IP:3000
```

公网部署建议使用 Nginx、Caddy 或云厂商网关反向代理，并启用 HTTPS。

## 模型配置

登录后点击右上角设置按钮，进入模型设置页：

1. 填写显示名称。
2. 填写 API Key。
3. 填写 Base URL，例如 `https://api.openai.com` 或 `https://api.openai.com/v1`。
4. 点击刷新按钮获取模型列表，或手动输入模型名。
5. 保存模型。

模型档案会保存到服务器的 `./data/config.json`。Docker 部署时该目录会挂载到容器内的 `/app/data`，因此换设备登录后可以继续使用同一套模型配置，重建容器也不会丢。

## 安全说明

- 公网部署前必须修改默认登录密码。
- `KUAIWEN_SESSION_SECRET` 应使用随机长字符串。
- `data/config.json` 会保存模型 API Key，不要提交到 GitHub。
- `.env`、`data/`、日志、构建产物和本地归档文件已加入忽略规则。
- 浏览器不会直接请求模型服务，AI 请求由后端代理发出。

## 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `KUAIWEN_PASSWORD` | 登录密码 | `kuaiwen` |
| `KUAIWEN_SESSION_SECRET` | Cookie 会话签名密钥 | 启动时随机生成 |
| `KUAIWEN_CONFIG_PATH` | 服务端模型配置文件路径 | `data/config.json` |
| `PORT` | 服务监听端口 | `3000` |

## 常见问题

**换设备后还要重新填模型吗？**

不需要。模型配置保存在服务器，只要登录同一个快问实例即可继续使用。

**支持哪些模型服务？**

支持 OpenAI 兼容接口，需要提供 `/v1/models` 和 `/v1/chat/completions`。

**为什么获取不到模型列表？**

请检查 API Key、Base URL、网络连通性，以及服务商是否支持 `/v1/models`。

## 许可证

[MIT](./LICENSE)
