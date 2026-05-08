import express from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const app = express();
const port = Number(process.env.PORT || 3000);
const loginPassword = process.env.KUAIWEN_PASSWORD || "kuaiwen";
const sessionSecret = process.env.KUAIWEN_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const sessionMaxAgeMs = 1000 * 60 * 60 * 24 * 7;
const configPath = process.env.KUAIWEN_CONFIG_PATH || path.join(rootDir, "data", "config.json");

app.use(express.json({ limit: "2mb" }));

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        if (index === -1) return [item, ""];
        return [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))];
      })
  );
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function createSessionToken() {
  const expiresAt = Date.now() + sessionMaxAgeMs;
  const payload = Buffer.from(JSON.stringify({ expiresAt })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function isValidSession(req) {
  const token = parseCookies(req).kuaiwen_session;
  if (!token || !token.includes(".")) return false;

  const [payload, signature] = token.split(".");
  const expectedSignature = sign(payload);
  const isSignatureValid =
    signature.length === expectedSignature.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

  if (!isSignatureValid) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(data.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

function setSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `kuaiwen_session=${encodeURIComponent(createSessionToken())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(
      sessionMaxAgeMs / 1000
    )}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "kuaiwen_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function requireLogin(req, res, next) {
  if (isValidSession(req)) {
    next();
    return;
  }

  res.status(401).json({ error: "请先登录。" });
}

app.get("/api/session", (req, res) => {
  res.json({ authenticated: isValidSession(req) });
});

app.post("/api/login", (req, res) => {
  const password = String(req.body?.password || "");
  const expected = Buffer.from(loginPassword);
  const actual = Buffer.from(password);
  const matches = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);

  if (!matches) {
    res.status(401).json({ error: "密码不正确。" });
    return;
  }

  setSessionCookie(res);
  res.json({ ok: true });
});

app.post("/api/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

async function readConfig() {
  try {
    const content = await fs.readFile(configPath, "utf8");
    const data = JSON.parse(content);
    return {
      profiles: Array.isArray(data.profiles) ? data.profiles : [],
      activeProfileId: typeof data.activeProfileId === "string" ? data.activeProfileId : ""
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { profiles: [], activeProfileId: "" };
    }
    throw error;
  }
}

async function writeConfig(config) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

function sanitizeProfile(profile) {
  return {
    id: String(profile?.id || crypto.randomUUID()),
    name: String(profile?.name || "").trim(),
    apiKey: String(profile?.apiKey || "").trim(),
    baseUrl: String(profile?.baseUrl || "").trim(),
    model: String(profile?.model || "").trim(),
    models: Array.isArray(profile?.models) ? profile.models.map((item) => String(item)).filter(Boolean) : []
  };
}

app.get("/api/config", requireLogin, async (_req, res) => {
  try {
    res.json(await readConfig());
  } catch (error) {
    res.status(500).json({ error: error.message || "读取模型配置失败。" });
  }
});

app.put("/api/config", requireLogin, async (req, res) => {
  try {
    const profiles = Array.isArray(req.body?.profiles) ? req.body.profiles.map(sanitizeProfile) : [];
    const activeProfileId = String(req.body?.activeProfileId || profiles[0]?.id || "");
    const config = {
      profiles,
      activeProfileId: profiles.some((profile) => profile.id === activeProfileId) ? activeProfileId : profiles[0]?.id || ""
    };

    await writeConfig(config);
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message || "保存模型配置失败。" });
  }
});

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function requireApiConfig(req, res) {
  const apiKey = String(req.body?.apiKey || "").trim();
  const baseUrl = normalizeBaseUrl(req.body?.baseUrl);

  if (!apiKey || !baseUrl) {
    res.status(400).json({ error: "请填写 API Key 和 Base URL。" });
    return null;
  }

  try {
    new URL(baseUrl);
  } catch {
    res.status(400).json({ error: "Base URL 格式不正确。" });
    return null;
  }

  return { apiKey, baseUrl };
}

async function openAiRequest({ apiKey, baseUrl, endpoint, method = "GET", body }) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `请求失败：HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

app.post("/api/models", requireLogin, async (req, res) => {
  const config = requireApiConfig(req, res);
  if (!config) return;

  try {
    const payload = await openAiRequest({ ...config, endpoint: "/models" });
    const models = Array.isArray(payload?.data)
      ? payload.data.map((model) => model.id).filter(Boolean).sort()
      : [];
    res.json({ models });
  } catch (error) {
    res.status(502).json({ error: error.message || "获取模型列表失败。" });
  }
});

const systemPrompt = `你是“快问”，一个粘贴即答的中文 AI 助手。
用户会直接粘贴文本、命令、英文、报错、配置、日志或片段。你要先判断用户最可能想问什么，再给出直接有用的回答。

回答规则：
1. 默认用简体中文。
2. 如果是命令或脚本：先给“结论”，说明大致功能、安全性、是否读取/写入/删除/联网/提权；再逐段拆解；最后给出执行建议。
3. 如果是英文：直接给润色后的自然中文翻译，必要时补充关键词解释。
4. 如果是报错或日志：说明错误含义、常见原因、排查步骤和可尝试的修复命令。
5. 如果内容很短或意图不明确：先说明你判断的意图，再给出最有帮助的回答。
6. 不要编造没有依据的事实；不确定时明确说“不确定”。`;

app.post("/api/ask", requireLogin, async (req, res) => {
  const config = requireApiConfig(req, res);
  if (!config) return;

  const model = String(req.body?.model || "").trim();
  const content = String(req.body?.content || "").trim();

  if (!model) {
    res.status(400).json({ error: "请选择模型。" });
    return;
  }

  if (!content) {
    res.status(400).json({ error: "请输入或粘贴内容。" });
    return;
  }

  try {
    const payload = await openAiRequest({
      ...config,
      endpoint: "/chat/completions",
      method: "POST",
      body: {
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content }
        ]
      }
    });

    const answer = payload?.choices?.[0]?.message?.content || "";
    res.json({ answer });
  } catch (error) {
    res.status(502).json({ error: error.message || "AI 请求失败。" });
  }
});

app.use(express.static(distDir));

app.get("*", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, () => {
  console.log(`快问已启动：http://0.0.0.0:${port}`);
  if (!process.env.KUAIWEN_PASSWORD) {
    console.log("当前登录密码为默认值 kuaiwen，公网部署请设置 KUAIWEN_PASSWORD。");
  }
});
