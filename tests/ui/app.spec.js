import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/login", { data: { password: "test-password" } });
  await page.request.put("/api/active-profile", { data: { profileId: "mock" } });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "输入内容" })).toBeVisible();
});

test("manual request renders safe Markdown, syntax highlighting, code copy, and persists history", async ({
  page,
  context
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "自动发送已开启" }).click();
  await page.getByRole("textbox", { name: "输入内容" }).fill("markdown");
  const request = page.waitForRequest((r) => r.url().endsWith("/api/ask"));
  await page.getByRole("button", { name: "快问一下" }).click();
  expect((await request).postDataJSON()).toEqual({ profileId: "mock", content: "markdown", intent: "auto" });
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  await expect(page.locator(".markdown h2")).toHaveText("命令说明");
  await expect(page.locator(".markdown table")).toBeVisible();
  await expect(page.locator(".markdown script, .markdown img")).toHaveCount(0);
  expect(await page.evaluate(() => window.hacked)).toBeUndefined();
  await page.getByRole("button", { name: "复制代码", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("ls -la");
  await page.screenshot({ path: "test-results/desktop-answer.png", fullPage: true });
  await page.reload();
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ask")) calls++;
  });
  await page.getByRole("button", { name: "历史", exact: true }).click();
  await page.locator(".history-main").click();
  await expect(page.locator(".markdown h2")).toHaveText("命令说明");
  expect(calls).toBe(0);
});

test("clearing cancels a pending auto-send and a running stream", async ({ page }) => {
  await page.clock.install();
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ask")) calls++;
  });
  await page.getByRole("textbox", { name: "输入内容" }).fill("do not send");
  await page.getByRole("button", { name: "清空输入和回答" }).click();
  await page.clock.fastForward(4000);
  expect(calls).toBe(0);
  await page.getByRole("textbox", { name: "输入内容" }).fill("slow");
  await page.getByRole("button", { name: "快问一下" }).click();
  await expect(page.locator(".markdown")).toContainText("第一段");
  await page.getByRole("button", { name: "清空输入和回答" }).click();
  await expect(page.locator(".answer-empty")).toBeVisible();
  await page.clock.fastForward(5000);
  await expect(page.getByRole("textbox", { name: "输入内容" })).toHaveValue("");
  await expect(page.locator(".answer-empty")).toBeVisible();
});

test("Chinese composition pauses auto-send; committed text is sent once", async ({ page }) => {
  await page.clock.install();
  const input = page.getByRole("textbox", { name: "输入内容" });
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ask")) calls++;
  });
  await input.dispatchEvent("compositionstart");
  await input.fill("中文输入");
  await page.clock.fastForward(5000);
  expect(calls).toBe(0);
  await input.dispatchEvent("compositionend");
  const request = page.waitForRequest((r) => r.url().endsWith("/api/ask"));
  await page.clock.fastForward(3100);
  expect((await request).postDataJSON().content).toBe("中文输入");
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  expect(calls).toBe(1);
});

test("paste sends immediately once; manual mode suppresses paste and delay", async ({ page }) => {
  await page.clock.install();
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ask")) calls++;
  });
  const input = page.getByRole("textbox", { name: "输入内容" });
  await input.evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "pasted");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  await page.clock.fastForward(5000);
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "自动发送已开启" }).click();
  await input.fill("");
  await input.evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "manual paste");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.clock.fastForward(5000);
  expect(calls).toBe(1);
  await expect(input).toHaveValue("manual paste");
});

test("editing during generation isolates old results; stop preserves partial content", async ({ page }) => {
  await page.getByRole("button", { name: "自动发送已开启" }).click();
  const input = page.getByRole("textbox", { name: "输入内容" });
  await input.fill("slow");
  await input.press("Enter");
  await expect(page.locator(".markdown")).toContainText("第一段");
  await page.getByRole("button", { name: "停止生成" }).click();
  await expect(page.getByText("已停止 · 内容可能不完整")).toBeVisible();
  await input.fill("new question");
  await input.press("Enter");
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  await expect(page.locator(".markdown")).toContainText("new question");
  await expect(page.locator(".markdown")).not.toContainText("第二段");
});

test("model and intent switches cancel pending tasks and affect the next request", async ({ page }) => {
  await page.clock.install();
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ask")) calls++;
  });
  await page.getByRole("textbox", { name: "输入内容" }).fill("hello");
  await page.getByRole("combobox", { name: "当前模型" }).click();
  await page.getByRole("option", { name: /备用模型/ }).click();
  await expect(page.getByRole("textbox", { name: "输入内容" })).toBeEnabled();
  await page.getByRole("button", { name: "翻译", exact: true }).click();
  await page.clock.fastForward(5000);
  expect(calls).toBe(0);
  const request = page.waitForRequest((r) => r.url().endsWith("/api/ask"));
  await page.getByRole("button", { name: "快问一下" }).click();
  expect((await request).postDataJSON()).toEqual({
    profileId: "second",
    content: "hello",
    intent: "translate"
  });
});

test("settings reuse saved keys, test the chat endpoint, and persist preferences", async ({ page }) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  const request = page.waitForRequest((r) => r.url().endsWith("/api/test"));
  await page.getByRole("button", { name: "测试连接" }).click();
  expect((await request).postDataJSON().apiKey || "").toBe("");
  await expect(page.getByRole("status")).toContainText("连接成功");
  await page.getByRole("button", { name: "获取列表" }).click();
  await expect(page.getByRole("status")).toContainText("已获取 2 个模型");
  await expect(page.locator("#available-models [role=option]")).toHaveCount(2);
  await page.locator("#available-models [role=option]").nth(1).click();
  await expect(page.getByRole("combobox", { name: "模型名称" })).toHaveValue("mock-slow");
  await page.getByLabel("开启自动发送").uncheck();
  await page.getByLabel("保存历史").uncheck();
  await page.screenshot({ path: "test-results/settings.png", fullPage: true });
  await page.reload();
  await expect(page.getByRole("button", { name: "手动发送", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByLabel("保存历史")).not.toBeChecked();
});

test("session expiry returns to login; mobile layout has no horizontal overflow", async ({
  page,
  context
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.clearCookies();
  await page.getByRole("textbox", { name: "输入内容" }).fill("hello");
  await page.getByRole("button", { name: "快问一下" }).click();
  await expect(page.getByRole("button", { name: "进入快问" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("登录已失效");
});

test("add, edit, select, and delete a model without exposing its saved key", async ({ page }) => {
  const config = await (await page.request.get("/api/config")).json();
  const baseUrl = config.profiles[0].baseUrl;
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "新增模型" }).click();
  await page.getByLabel("显示名称", { exact: true }).fill("新测试模型");
  await page.getByLabel("Base URL", { exact: true }).fill(baseUrl);
  await page.getByLabel("API Key", { exact: true }).fill("new-mock-secret");
  await page.getByRole("combobox", { name: "模型名称" }).fill("mock-fast");
  await page.getByRole("button", { name: "保存模型" }).click();
  await expect(page.getByRole("status")).toContainText("模型已保存");
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await page.getByLabel("显示名称", { exact: true }).fill("改名模型");
  await page.getByRole("button", { name: "保存模型" }).click();
  await expect(page.getByRole("status")).toContainText("模型已保存");
  await page.getByRole("button", { name: "返回快问", exact: true }).click();
  await page.getByRole("combobox", { name: "当前模型" }).click();
  await page.getByRole("option", { name: /改名模型/ }).click();
  await expect(page.getByRole("textbox", { name: "输入内容" })).toBeEnabled();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除 改名模型", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("模型已删除");
  expect(JSON.stringify(await (await page.request.get("/api/config")).json())).not.toContain(
    "new-mock-secret"
  );
});

test("truncated answers keep partial text and can be retried", async ({ page }) => {
  await page.getByRole("button", { name: "自动发送已开启" }).click();
  await page.getByRole("textbox", { name: "输入内容" }).fill("truncated");
  await page.getByRole("button", { name: "快问一下" }).click();
  await expect(page.getByRole("alert")).toContainText("连接提前断开");
  await expect(page.locator(".markdown")).not.toBeEmpty();
  const request = page.waitForRequest((r) => r.url().endsWith("/api/ask"));
  await page.getByRole("button", { name: "重新生成" }).click();
  expect((await request).postDataJSON().content).toBe("truncated");
  await expect(page.getByRole("alert")).toContainText("连接提前断开");
});

test("history search, deletion, and disabling storage work", async ({ page }) => {
  await page.getByRole("button", { name: "自动发送已开启" }).click();
  await page.getByRole("textbox", { name: "输入内容" }).fill("keep a record");
  await page.getByRole("button", { name: "快问一下" }).click();
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "历史", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索历史" }).fill("not found");
  await expect(page.getByText("没有匹配的记录")).toBeVisible();
  await page.getByRole("textbox", { name: "搜索历史" }).fill("record");
  await expect(page.locator(".history-item")).toHaveCount(1);
  await page.getByRole("button", { name: "删除这条记录" }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("kuaiwen.history.v1")))).toEqual([]);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("保存历史").uncheck();
  await page.getByRole("button", { name: "返回快问", exact: true }).click();
  await page.getByRole("button", { name: "快问一下" }).click();
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("kuaiwen.history.v1"))).toBeNull();
});

test("leaving the input page cancels pending auto-send; login handles incorrect passwords", async ({
  page,
  context
}) => {
  await page.clock.install();
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ask")) calls++;
  });
  await page.getByRole("textbox", { name: "输入内容" }).fill("do not send from settings");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.clock.fastForward(5000);
  expect(calls).toBe(0);
  await context.clearCookies();
  await page.reload();
  await page.getByLabel("访问密码").fill("wrong-password");
  await page.getByRole("button", { name: "进入快问" }).click();
  await expect(page.getByRole("alert")).toContainText("密码不正确");
  await page.getByLabel("访问密码").fill("test-password");
  await page.getByRole("button", { name: "进入快问" }).click();
  await expect(page.getByRole("textbox", { name: "输入内容" })).toBeVisible();
});
