import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { readSse } from "../shared/stream.js";
import { createMockModel, listen, close } from "./mock-model.js";

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=";

test("development proxy preserves browser origin for login and still rejects cross-site requests", async (t) => {
  const f = await fixture(t);
  const { createServer } = await import("vite");
  const { default: config } = await import("../vite.config.js");
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "kuaiwen-vite-test-"));
  const vite = await createServer({
    ...config,
    configFile: false,
    cacheDir,
    logLevel: "silent",
    server: {
      host: "127.0.0.1",
      port: 0,
      hmr: false,
      proxy: { "/api": { ...config.server.proxy["/api"], target: f.base } }
    }
  });
  t.after(async () => {
    await vite.close();
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  await vite.listen();
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
  for (const [origin, status] of [
    [base, 200],
    ["https://other.invalid", 403]
  ]) {
    const response = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ password: "test-password" })
    });
    assert.equal(response.status, status);
    if (status === 200) assert.match(response.headers.get("set-cookie"), /kuaiwen_session=/);
    await response.text();
  }
});

test("image capability persists, defaults off, and gates multimodal requests", async (t) => {
  const f = await fixture(t);
  await f.login();
  const profile = await f.profile();
  assert.equal(profile.supportsImages, false);
  assert.equal((await f.request("/api/ask", { profileId: profile.id, images: [image] })).status, 400);
  const enabled = await f.request("/api/profiles", { id: profile.id, supportsImages: true });
  assert.equal((await enabled.json()).profiles[0].supportsImages, true);
  const retained = await f.request("/api/profiles", { id: profile.id, name: "改名" });
  assert.equal((await retained.json()).profiles[0].supportsImages, true);
  for (const content of ["", "这张图的错误怎么解决？"]) {
    const response = await f.request("/api/ask", {
      profileId: profile.id,
      content,
      images: [image],
      intent: "auto"
    });
    assert.equal(response.status, 200);
    await response.text();
    const message = f.mock.requests.at(-1).body.messages.at(-1);
    assert.equal(message.content[0].type, "text");
    assert.ok(message.content[0].text);
    if (content) assert.equal(message.content[0].text, content);
    assert.deepEqual(message.content[1], { type: "image_url", image_url: { url: image } });
  }
  await f.request("/api/profiles", { id: profile.id, supportsImages: false });
  assert.equal((await f.request("/api/ask", { profileId: profile.id, images: [image] })).status, 400);
});

test("image validation rejects malformed, remote, oversized and excessive attachments", async (t) => {
  const f = await fixture(t);
  await f.login();
  const profile = await f.profile();
  await f.request("/api/profiles", { id: profile.id, supportsImages: true });
  for (const images of [
    null,
    {},
    ["https://example.com/image.png"],
    ["data:image/svg+xml;base64,PHN2Zz4="],
    ["data:image/png;base64,!!!!"],
    Array(5).fill(image),
    ["data:image/png;base64," + Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64")]
  ]) {
    // null means no attachments; an empty request must still be rejected.
    assert.equal((await f.request("/api/ask", { profileId: profile.id, images })).status, 400);
  }
  assert.equal(f.mock.requests.length, 0);
  const largeImage = "data:image/png;base64," + Buffer.alloc(1100000).toString("base64");
  const response = await f.request("/api/ask", { profileId: profile.id, images: [largeImage] });
  assert.equal(response.status, 200);
  await response.text();
});

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kuaiwen-test-"));
  const mock = createMockModel();
  const upstream = await listen(mock.server);
  const configPath = path.join(directory, "config.json");
  const app = createApp({
    password: "test-password",
    secret: "test-secret",
    configPath,
    timeoutMs: 5000,
    ...options
  });
  const server = http.createServer(app);
  const base = await listen(server);
  t.after(async () => {
    await close(server);
    await close(mock.server);
    await fs.rm(directory, { recursive: true, force: true });
  });
  let cookie = "";
  async function request(url, body, method = "POST", headers = {}, signal) {
    return fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json", cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    });
  }
  async function login() {
    const response = await request("/api/login", { password: "test-password" });
    cookie = response.headers.get("set-cookie").split(";")[0];
    return response;
  }
  async function profile(model = "mock-fast", name = "测试模型") {
    const response = await request("/api/profiles", {
      name,
      model,
      apiKey: "test-secret-key",
      baseUrl: upstream
    });
    assert.equal(response.status, 200);
    return (await response.json()).profiles.at(-1);
  }
  return { request, login, profile, mock, configPath, upstream, base };
}

test("authentication rejects malformed cookies, enforces login and rate limits failures", async (t) => {
  const f = await fixture(t, { loginLimit: 2 });
  assert.equal((await f.request("/api/config", undefined, "GET")).status, 401);
  for (const cookie of [
    "kuaiwen_session=%",
    "kuaiwen_session=e30.%E4%B8%AD%E6%96%87",
    "kuaiwen_session=e30.invalid"
  ]) {
    const response = await f.request("/api/session", undefined, "GET", { cookie });
    assert.deepEqual(await response.json(), { authenticated: false });
  }
  for (let i = 0; i < 2; i++)
    assert.equal((await f.request("/api/login", { password: "wrong" })).status, 401);
  const limited = await f.request("/api/login", { password: "test-password" });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("retry-after"));
});

test("profile responses never expose keys, blank edits retain keys and changed hosts require re-entry", async (t) => {
  const f = await fixture(t);
  const login = await f.login();
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  const profile = await f.profile();
  assert.equal(profile.apiKey, undefined);
  assert.equal(profile.hasApiKey, true);
  let response = await f.request("/api/profiles", { ...profile, name: "已更新", apiKey: "" });
  assert.equal(response.status, 200);
  assert.ok(!(await response.text()).includes("test-secret-key"));
  const stored = JSON.parse(await fs.readFile(f.configPath));
  assert.equal(stored.profiles[0].apiKey, "test-secret-key");
  response = await f.request("/api/profiles", { ...profile, baseUrl: "http://127.0.0.1:1", apiKey: "" });
  assert.equal(response.status, 400);
  response = await f.request("/api/test", { ...profile, baseUrl: "http://127.0.0.1:1", apiKey: "" });
  assert.equal(response.status, 400);
  response = await f.request("/api/config", undefined, "GET");
  assert.ok(!(await response.text()).includes("test-secret-key"));
  assert.deepEqual(
    (await fs.readdir(path.dirname(f.configPath))).filter((name) => name.endsWith(".tmp")),
    []
  );
});

test("concurrent config writes preserve all profiles and migrate an old config without returning secrets", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    f.configPath,
    JSON.stringify({
      profiles: [
        { id: "old", name: "旧配置", baseUrl: f.upstream, apiKey: "old-secret", model: "old-model" }
      ],
      activeProfileId: "old"
    })
  );
  await f.login();
  await Promise.all(Array.from({ length: 8 }, (_, i) => f.profile("mock-fast", `模型 ${i}`)));
  let config = await (await f.request("/api/config", undefined, "GET")).json();
  assert.equal(config.profiles.length, 9);
  assert.equal(config.profiles[0].hasApiKey, true);
  assert.equal(config.profiles[0].apiKey, undefined);
  assert.equal(
    (await f.request("/api/active-profile", { profileId: config.profiles[1].id }, "PUT")).status,
    200
  );
  config = await (await f.request(`/api/profiles/${config.profiles[1].id}`, undefined, "DELETE")).json();
  assert.equal(config.activeProfileId, "old");
});

test("streamed answers use server credentials, explicit intent, and only this question", async (t) => {
  const f = await fixture(t);
  await f.login();
  const p = await f.profile();
  const response = await f.request("/api/ask", {
    profileId: p.id,
    content: "hello",
    intent: "translate",
    apiKey: "attacker-key",
    baseUrl: "http://ignored.invalid"
  });
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const events = [];
  for await (const data of readSse(response.body)) events.push(JSON.parse(data));
  assert.equal(events.at(-1).type, "done");
  assert.equal(
    events
      .filter((e) => e.type === "delta")
      .map((e) => e.text)
      .join(""),
    "这是「hello」的回答。中文流式内容正常。"
  );
  const request = f.mock.requests.at(-1);
  assert.equal(request.authorization, "Bearer test-secret-key");
  assert.equal(request.body.messages.length, 2);
  assert.match(request.body.messages[0].content, /用户明确选择翻译/);
  assert.equal(request.url, "/v1/chat/completions");
});

test("models and connection tests reuse saved credentials; upstream errors are actionable and sanitized", async (t) => {
  const f = await fixture(t);
  await f.login();
  const p = await f.profile();
  assert.equal((await (await f.request("/api/models", { id: p.id })).json()).models.length, 2);
  assert.equal((await f.request("/api/test", { id: p.id })).status, 200);
  const denied = await f.profile("unauthorized");
  const response = await f.request("/api/ask", { profileId: denied.id, content: "hello" });
  assert.equal(response.status, 502);
  const error = (await response.json()).error;
  assert.match(error, /API Key/);
  assert.ok(!error.includes("secret-leak"));
});

test("JSON-only providers work; truncated streams produce an error rather than false completion", async (t) => {
  const f = await fixture(t);
  await f.login();
  const p = await f.profile("json-only");
  let response = await f.request("/api/ask", { profileId: p.id, content: "hello" });
  assert.match(await response.text(), /"type":"done"/);
  const streamed = await f.profile();
  response = await f.request("/api/ask", { profileId: streamed.id, content: "truncated" });
  const body = await response.text();
  assert.match(body, /"type":"error"/);
  assert.ok(!body.includes('"type":"done"'));
});

test("timeouts before and during streaming are reported and abort the upstream connection", async (t) => {
  const f = await fixture(t, { timeoutMs: 150 });
  await f.login();
  const p = await f.profile();
  let response = await f.request("/api/ask", { profileId: p.id, content: "timeout" });
  assert.equal(response.status, 504);
  assert.match((await response.json()).error, /超时/);
  response = await f.request("/api/ask", { profileId: p.id, content: "stream-timeout" });
  assert.match(await response.text(), /超时/);
});

test("client cancellation cancels generation upstream", async (t) => {
  const f = await fixture(t);
  await f.login();
  const p = await f.profile();
  const controller = new AbortController();
  const response = await f.request(
    "/api/ask",
    { profileId: p.id, content: "slow" },
    "POST",
    {},
    controller.signal
  );
  await response.body.getReader().read();
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.ok(f.mock.aborted.includes("slow"));
});

test("invalid input and cross-site mutations are rejected; logout clears session", async (t) => {
  const f = await fixture(t);
  await f.login();
  const p = await f.profile();
  assert.equal((await f.request("/api/ask", { profileId: p.id, content: "a".repeat(50001) })).status, 400);
  assert.equal(
    (await f.request("/api/ask", { profileId: p.id, content: "hi", intent: "constructor" })).status,
    400
  );
  assert.equal(
    (await f.request("/api/profiles", { name: "bad", baseUrl: "file:///etc/passwd" })).status,
    400
  );
  assert.equal(
    (await f.request("/api/active-profile", { profileId: p.id }, "PUT", { origin: "https://other.invalid" }))
      .status,
    403
  );
  const logout = await f.request("/api/logout", {});
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
});

test("legacy migration is atomic, preserves selected profile, and cannot overwrite existing config", async (t) => {
  const f = await fixture(t);
  await f.login();
  const first = {
    id: "legacy-one",
    name: "旧一",
    model: "mock-fast",
    apiKey: "legacy-secret",
    baseUrl: f.upstream
  };
  let response = await f.request("/api/migrate", { profiles: [first, { ...first, baseUrl: "invalid" }] });
  assert.equal(response.status, 400);
  assert.equal((await (await f.request("/api/config", undefined, "GET")).json()).profiles.length, 0);
  response = await f.request("/api/migrate", {
    profiles: [first, { ...first, id: "legacy-two", name: "旧二" }],
    activeProfileId: "legacy-two"
  });
  const migrated = await response.json();
  assert.equal(migrated.profiles.length, 2);
  assert.equal(migrated.activeProfileId, migrated.profiles[1].id);
  assert.ok(!JSON.stringify(migrated).includes("legacy-secret"));
  response = await f.request("/api/migrate", { profiles: [first] });
  assert.deepEqual(await response.json(), migrated);
});

test("gateway base paths are preserved and corrupt configs are not silently replaced", async (t) => {
  const f = await fixture(t);
  await f.login();
  const response = await f.request("/api/profiles", {
    name: "网关",
    model: "mock-fast",
    apiKey: "secret",
    baseUrl: `${f.upstream}/api/v3/`
  });
  const p = (await response.json()).profiles[0];
  await f.request("/api/test", { id: p.id });
  assert.equal(f.mock.requests.at(-1).url, "/api/v3/chat/completions");
  await fs.writeFile(f.configPath, "broken config");
  assert.equal((await f.request("/api/config", undefined, "GET")).status, 500);
  assert.equal(
    (await f.request("/api/profiles", { model: "mock", apiKey: "secret", baseUrl: f.upstream })).status,
    500
  );
  assert.equal(await fs.readFile(f.configPath, "utf8"), "broken config");
});
