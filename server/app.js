import express from "express";
import { rateLimit } from "express-rate-limit";
import crypto from "node:crypto";
import path from "node:path";
import { once } from "node:events";
import { createConfigStore, publicConfig } from "./config-store.js";
import {
  HttpError,
  normalizeBaseUrl,
  intents,
  messagesFor,
  upstreamRequest,
  answerChunks
} from "./upstream.js";

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
const text = (value, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export function createApp({
  password,
  secret,
  configPath,
  distDir,
  timeoutMs = 90000,
  secureCookie = false,
  trustProxy = 0,
  loginLimit = 10
}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 600000)
    throw new Error("请求超时应在 100–600000 毫秒之间。");
  if (!Number.isInteger(trustProxy) || trustProxy < 0) throw new Error("TRUST_PROXY 必须是非负整数。");
  const app = express();
  const store = createConfigStore(configPath);
  let activeRequests = 0;
  app.disable("x-powered-by");
  app.set("trust proxy", trustProxy);
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin) {
      if (req.headers.origin !== `${req.protocol}://${req.get("host")}`)
        return res.status(403).json({ error: "不允许跨站请求。" });
    }
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  const sign = (value) => crypto.createHmac("sha256", secret).update(value).digest("base64url");
  const equal = (a, b) => {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  function authenticated(req) {
    try {
      const raw = String(req.headers.cookie || "")
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("kuaiwen_session="));
      if (!raw) return false;
      const [payload, signature, extra] = decodeURIComponent(raw.slice("kuaiwen_session=".length)).split(".");
      return (
        !extra &&
        !!signature &&
        equal(signature, sign(payload)) &&
        Number(JSON.parse(Buffer.from(payload, "base64url").toString()).expiresAt) > Date.now()
      );
    } catch {
      return false;
    }
  }
  function cookie(req, res, token, maxAge) {
    res.cookie("kuaiwen_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookie || req.secure,
      path: "/",
      maxAge
    });
  }
  const requireLogin = (req, res, next) =>
    authenticated(req) ? next() : res.status(401).json({ error: "登录已失效，请重新登录。" });
  app.get("/api/session", (req, res) => res.json({ authenticated: authenticated(req) }));
  app.post(
    "/api/login",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: loginLimit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      skipSuccessfulRequests: true,
      message: { error: "登录尝试过多，请 15 分钟后再试。" }
    }),
    (req, res) => {
      if (!equal(String(req.body?.password || ""), password))
        return res.status(401).json({ error: "密码不正确。" });
      const maxAge = 7 * 24 * 60 * 60 * 1000;
      const payload = Buffer.from(JSON.stringify({ expiresAt: Date.now() + maxAge })).toString("base64url");
      cookie(req, res, `${payload}.${sign(payload)}`, maxAge);
      res.json({ ok: true });
    }
  );
  app.post("/api/logout", (req, res) => {
    cookie(req, res, "", 0);
    res.json({ ok: true });
  });
  app.use("/api", requireLogin);
  app.get(
    "/api/config",
    wrap(async (_req, res) => res.json(publicConfig(await store.read())))
  );

  function profileFrom(draft, saved) {
    if (!draft || typeof draft !== "object" || Array.isArray(draft))
      throw new HttpError(400, "模型配置格式不正确。");
    const baseUrl = normalizeBaseUrl(draft.baseUrl ?? saved?.baseUrl);
    const suppliedKey = text(draft.apiKey, 8192);
    if (!suppliedKey && saved && baseUrl !== normalizeBaseUrl(saved.baseUrl))
      throw new HttpError(400, "修改 Base URL 后，请重新填写 API Key。");
    const apiKey = suppliedKey || saved?.apiKey || "";
    if (!apiKey) throw new HttpError(400, "请填写 API Key。");
    const model = text(draft.model ?? saved?.model);
    return {
      id: saved?.id || crypto.randomUUID(),
      name: text(draft.name) || model || "未命名模型",
      baseUrl,
      apiKey,
      model
    };
  }
  app.post(
    "/api/migrate",
    wrap(async (req, res) => {
      const drafts = req.body?.profiles;
      if (!Array.isArray(drafts) || drafts.length > 50) throw new HttpError(400, "旧配置格式不正确。");
      res.json(
        await store.update((config) => {
          // Migrate once, atomically; another device may already have configured this instance.
          if (config.profiles.length) return;
          const profiles = drafts.map((draft) => {
            const profile = profileFrom(draft);
            if (!profile.model) throw new HttpError(400, "旧配置中缺少模型名称。");
            return profile;
          });
          const activeIndex = drafts.findIndex((draft) => draft.id === req.body.activeProfileId);
          config.profiles = profiles;
          config.activeProfileId = profiles[activeIndex]?.id || profiles[0]?.id || "";
        })
      );
    })
  );
  app.post(
    "/api/profiles",
    wrap(async (req, res) => {
      res.json(
        await store.update((config) => {
          const id = text(req.body?.id);
          const existing = config.profiles.find((p) => p.id === id);
          if (id && !existing) throw new HttpError(404, "模型档案已被删除，请刷新后重试。");
          if (!existing && config.profiles.length >= 50) throw new HttpError(400, "最多保存 50 个模型档案。");
          const profile = profileFrom(req.body || {}, existing);
          if (!profile.model) throw new HttpError(400, "请填写模型名称。");
          if (existing) config.profiles = config.profiles.map((p) => (p.id === id ? profile : p));
          else config.profiles.push(profile);
          if (!config.activeProfileId) config.activeProfileId = profile.id;
        })
      );
    })
  );
  app.delete(
    "/api/profiles/:id",
    wrap(async (req, res) => {
      res.json(
        await store.update((config) => {
          config.profiles = config.profiles.filter((p) => p.id !== req.params.id);
          if (config.activeProfileId === req.params.id) config.activeProfileId = config.profiles[0]?.id || "";
        })
      );
    })
  );
  app.put(
    "/api/active-profile",
    wrap(async (req, res) => {
      res.json(
        await store.update((config) => {
          if (!config.profiles.some((p) => p.id === req.body?.profileId))
            throw new HttpError(404, "模型档案不存在。");
          config.activeProfileId = req.body.profileId;
        })
      );
    })
  );
  async function savedProfile(id) {
    const profile = (await store.read()).profiles.find((p) => p.id === id);
    if (!profile) throw new HttpError(404, "模型档案不存在，请重新选择。");
    return profile;
  }
  async function draftProfile(body) {
    const saved = body?.id ? await savedProfile(body.id) : undefined;
    return profileFrom(body || {}, saved);
  }
  function requestScope(res) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const close = () => controller.abort();
    res.once("close", close);
    if (res.destroyed) controller.abort();
    return {
      signal: controller.signal,
      cleanup() {
        clearTimeout(timer);
        res.off("close", close);
        controller.abort();
      },
      error(error) {
        return timedOut ? new HttpError(504, "模型响应超时，请重试或换一个模型。") : error;
      }
    };
  }
  app.post(
    "/api/models",
    wrap(async (req, res) => {
      const profile = await draftProfile(req.body);
      const scope = requestScope(res);
      try {
        const response = await upstreamRequest(profile, "/models", scope.signal);
        const payload = await response.json().catch(() => {
          throw new HttpError(502, "模型列表响应格式不正确，可手动填写模型名。");
        });
        if (!Array.isArray(payload.data))
          throw new HttpError(502, "服务没有返回模型列表，可手动填写模型名。");
        res.json({
          models: payload.data
            .map((m) => m.id)
            .filter((id) => typeof id === "string")
            .sort()
        });
      } catch (e) {
        throw scope.error(e);
      } finally {
        scope.cleanup();
      }
    })
  );
  app.post(
    "/api/test",
    wrap(async (req, res) => {
      const profile = await draftProfile(req.body);
      if (!profile.model) throw new HttpError(400, "请填写模型名称后测试。");
      const scope = requestScope(res);
      const start = Date.now();
      try {
        const response = await upstreamRequest(profile, "/chat/completions", scope.signal, {
          model: profile.model,
          stream: false,
          messages: [{ role: "user", content: "只回答 OK。" }]
        });
        for await (const _chunk of answerChunks(response)) {
          /* Check the chat endpoint, not only /models. */
        }
        res.json({ ok: true, elapsedMs: Date.now() - start });
      } catch (e) {
        throw scope.error(e);
      } finally {
        scope.cleanup();
      }
    })
  );
  app.post(
    "/api/ask",
    wrap(async (req, res) => {
      const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
      if (!content || content.length > 50000) throw new HttpError(400, "请输入 1–50000 个字符。");
      const intent = req.body.intent || "auto";
      if (!Object.hasOwn(intents, intent)) throw new HttpError(400, "不支持该处理方式。");
      const profile = await savedProfile(req.body.profileId);
      if (activeRequests >= 4) throw new HttpError(429, "同时进行的请求过多，请稍后重试。");
      activeRequests++;
      const scope = requestScope(res);
      async function emit(payload) {
        if (res.destroyed) return;
        if (!res.write(`data: ${JSON.stringify(payload)}\n\n`))
          await once(res, "drain", { signal: scope.signal });
      }
      try {
        const response = await upstreamRequest(profile, "/chat/completions", scope.signal, {
          model: profile.model,
          stream: true,
          messages: messagesFor(content, intent)
        });
        res.status(200).set({
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no"
        });
        res.flushHeaders();
        let length = 0;
        for await (const delta of answerChunks(response)) {
          length += delta.length;
          if (length > 1_000_000) throw new HttpError(502, "回答过长，已停止接收。");
          await emit({ type: "delta", text: delta });
        }
        await emit({ type: "done" });
      } catch (error) {
        if (!res.destroyed) {
          const failure = scope.error(error);
          const message = failure instanceof HttpError ? failure.message : "生成失败，请稍后重试。";
          if (res.headersSent) res.write(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`);
          else res.status(failure.status || 502).json({ error: message });
        }
      } finally {
        scope.cleanup();
        activeRequests--;
        if (!res.destroyed) res.end();
      }
    })
  );
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在。" }));
  if (distDir) {
    app.use(express.static(distDir));
    app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
  }
  app.use((error, _req, res, _next) => {
    if (res.headersSent || res.destroyed) return;
    const status =
      error instanceof HttpError
        ? error.status
        : error.status === 413
          ? 413
          : error.type === "entity.parse.failed"
            ? 400
            : 500;
    const message =
      error instanceof HttpError
        ? error.message
        : status === 413
          ? "请求内容过大。"
          : status === 400
            ? "请求格式不正确。"
            : "服务器操作失败，请检查服务日志和配置文件。";
    if (status === 500) console.error("服务器操作失败：", error.code || error.name);
    res.status(status).json({ error: message });
  });
  return app;
}
