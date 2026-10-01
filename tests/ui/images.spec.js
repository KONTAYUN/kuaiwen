import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.request.post("/api/login", { data: { password: "test-password" } });
  await page.request.put("/api/active-profile", { data: { profileId: "mock" } });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "输入内容" })).toBeVisible();
});

async function pasteImage(page, text = "") {
  await page.getByRole("textbox", { name: "输入内容" }).evaluate((el, text) => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 240;
    const context = canvas.getContext("2d");
    context.fillStyle = "#f2f6f3";
    context.fillRect(0, 0, 640, 240);
    context.fillStyle = "#173b31";
    context.font = "20px monospace";
    context.fillText("Permission denied (publickey).", 28, 72);
    context.fillText("Check your SSH key and try again.", 28, 120);
    const bytes = Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "screenshot.png", { type: "image/png" }));
    if (text) data.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

test("image-only paste sends once, supports supplements, history and retry", async ({ page }) => {
  const bodies = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ask")) bodies.push(r.postDataJSON());
  });
  await pasteImage(page);
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0].content).toBe("");
  expect(bodies[0].images[0]).toMatch(/^data:image\/jpeg;base64,/);
  await expect(page.getByAltText("已粘贴图片 1")).toBeVisible();
  await page.screenshot({ path: "test-results/image-input.png", fullPage: true });
  const input = page.getByRole("textbox", { name: "输入内容" });
  await input.fill("图中是什么？");
  await input.press("Enter");
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  expect(bodies.at(-1).content).toBe("图中是什么？");
  expect(bodies.at(-1).images).toEqual(bodies[0].images);
  await page.reload();
  await page.getByRole("button", { name: "历史", exact: true }).click();
  await page.locator(".history-main").first().click();
  await expect(page.getByAltText("已粘贴图片 1")).toBeVisible();
  await expect(input).toHaveValue("图中是什么？");
  const count = bodies.length;
  await page.getByRole("button", { name: "重新生成" }).click();
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(count + 1);
  expect(bodies.at(-1).images).toEqual(bodies[0].images);
  await page.getByRole("button", { name: "移除图片 1" }).click();
  await expect(page.getByAltText("已粘贴图片 1")).toHaveCount(0);
  await page.getByRole("button", { name: "清空输入和回答" }).click();
});

test("editing during image preparation defers until idle; clear invalidates pending images", async ({
  page
}) => {
  await page.evaluate(() => {
    const decode = Image.prototype.decode;
    Image.prototype.decode = function () {
      return new Promise((resolve, reject) => setTimeout(() => decode.call(this).then(resolve, reject), 400));
    };
  });
  const bodies = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ask")) bodies.push(r.postDataJSON());
  });
  await pasteImage(page);
  await page.getByRole("textbox", { name: "输入内容" }).fill("解释一下");
  await expect(page.getByAltText("已粘贴图片 1")).toBeVisible();
  expect(bodies).toHaveLength(0);
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible({ timeout: 6000 });
  expect(bodies).toHaveLength(1);
  expect(bodies[0].content).toBe("解释一下");
  await page.getByRole("button", { name: "清空输入和回答" }).click();
  await pasteImage(page);
  await page.getByRole("button", { name: "清空输入和回答" }).click();
  await page.waitForTimeout(700);
  await expect(page.getByAltText("已粘贴图片 1")).toHaveCount(0);
  expect(bodies).toHaveLength(1);
});

test("manual mode accepts mixed clipboard content; unsupported models reject images", async ({ page }) => {
  await page.getByRole("button", { name: "自动发送已开启" }).click();
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ask")) calls++;
  });
  await pasteImage(page, "分析这张图");
  await expect(page.getByAltText("已粘贴图片 1")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "输入内容" })).toHaveValue("分析这张图");
  expect(calls).toBe(0);
  await page.getByRole("textbox", { name: "输入内容" }).press("Enter");
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "清空输入和回答" }).click();
  await page.getByRole("combobox", { name: "当前模型" }).click();
  await page.getByRole("option", { name: /备用模型/ }).click();
  await expect(page.getByRole("textbox", { name: "输入内容" })).toBeEnabled();
  await pasteImage(page);
  await expect(page.getByRole("status")).toContainText("当前模型未开启图片理解");
  await expect(page.getByAltText("已粘贴图片 1")).toHaveCount(0);
  expect(calls).toBe(1);
});

test("model image switch can be saved and restored", async ({ page }) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const toggle = page.getByRole("checkbox", { name: "支持图片理解" });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.getByRole("button", { name: "保存模型" }).click();
  await expect(page.getByRole("status")).toContainText("模型已保存");
  expect(
    (await (await page.request.get("/api/config")).json()).profiles.find((p) => p.id === "mock")
      .supportsImages
  ).toBe(false);
  await toggle.check();
  await page.getByRole("button", { name: "保存模型" }).click();
  await expect(page.getByRole("status")).toContainText("模型已保存");
});

test("typing during an image answer cancels the stream and sends the supplement after the configured delay", async ({
  page
}) => {
  await page.evaluate(() =>
    localStorage.setItem(
      "kuaiwen.preferences.v1",
      JSON.stringify({ autoSend: true, delay: 1, saveHistory: true })
    )
  );
  await page.reload();
  const bodies = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ask")) bodies.push(r.postDataJSON());
  });
  await pasteImage(page, "slow");
  await expect(page.locator(".markdown")).toContainText("第一段");
  await page.getByRole("textbox", { name: "输入内容" }).fill("请解释图中问题");
  await expect(page.getByText("已停止 · 内容可能不完整")).toBeVisible();
  await expect(page.getByAltText("已粘贴图片 1")).toBeVisible();
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1].content).toBe("请解释图中问题");
  expect(bodies[1].images).toEqual(bodies[0].images);
  await expect(page.locator(".markdown")).not.toContainText("第二段");
});

test("Enter during preparation sends when ready and successive image pastes are retained", async ({
  page
}) => {
  await page.getByRole("button", { name: "自动发送已开启" }).click();
  await page.evaluate(() => {
    const decode = Image.prototype.decode;
    Image.prototype.decode = function () {
      return new Promise((resolve, reject) => setTimeout(() => decode.call(this).then(resolve, reject), 400));
    };
  });
  const bodies = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ask")) bodies.push(r.postDataJSON());
  });
  await pasteImage(page);
  await pasteImage(page);
  await page.getByRole("textbox", { name: "输入内容" }).fill("对比这两张图片");
  await page.getByRole("textbox", { name: "输入内容" }).press("Enter");
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0].images).toHaveLength(2);
  expect(bodies[0].content).toBe("对比这两张图片");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/image-input-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("image chips stay inside input and preview closes without editing", async ({ page }) => {
  await page.getByRole("button", { name: "自动发送已开启" }).click();
  await pasteImage(page);
  const chip = page.getByRole("button", { name: "查看图片 1" });
  await expect(chip).toBeVisible();
  expect(await chip.evaluate((el) => !!el.closest(".input-composer"))).toBe(true);
  const input = page.getByRole("textbox", { name: "输入内容" });
  await input.fill("这是什么意思？");
  await page.screenshot({ path: "test-results/image-chips-desktop.png", fullPage: true });
  await chip.click();
  await expect(page.getByRole("dialog", { name: "图片预览" })).toBeVisible();
  await expect(page.getByAltText("图片大图")).toBeVisible();
  await page.screenshot({ path: "test-results/image-preview.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(chip).toBeFocused();
  await expect(input).toHaveValue("这是什么意思？");
  await chip.click();
  await page.mouse.click(5, 5);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await chip.click();
  await page.getByRole("button", { name: "关闭图片预览" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/image-chips-mobile.png", fullPage: true });
});

test("pasting an image into existing text waits for the configured idle time", async ({ page }) => {
  await page.clock.install();
  const bodies = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ask")) bodies.push(r.postDataJSON());
  });
  await page.getByRole("textbox", { name: "输入内容" }).fill("帮我看看这张图");
  await pasteImage(page);
  await expect(page.getByRole("button", { name: "查看图片 1" })).toBeVisible();
  expect(bodies).toHaveLength(0);
  await page.clock.fastForward(2900);
  expect(bodies).toHaveLength(0);
  await page.clock.fastForward(200);
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0].content).toBe("帮我看看这张图");
  expect(bodies[0].images).toHaveLength(1);
});

test("text paste into existing input resets idle time and Enter can send immediately", async ({ page }) => {
  await page.clock.install();
  const input = page.getByRole("textbox", { name: "输入内容" });
  const bodies = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ask")) bodies.push(r.postDataJSON());
  });
  await input.fill("解释：");
  await page.clock.fastForward(2000);
  const pasteText = async (text) =>
    input.evaluate((el, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, text);
  await pasteText("Permission denied");
  await expect(input).toHaveValue("解释：Permission denied");
  await page.clock.fastForward(2900);
  expect(bodies).toHaveLength(0);
  await page.clock.fastForward(200);
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(1);
  await input.fill("再看看：");
  await pasteText("connection refused");
  expect(bodies).toHaveLength(1);
  await input.press("Enter");
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1].content).toBe("再看看：connection refused");
});

test("clipboard button preserves existing question and waits for Enter", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.clock.install();
  const input = page.getByRole("textbox", { name: "输入内容" });
  const bodies = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ask")) bodies.push(r.postDataJSON());
  });
  await input.fill("解释这个报错：");
  await page.evaluate(() => navigator.clipboard.writeText("Permission denied"));
  await page.getByRole("button", { name: "从剪贴板粘贴" }).click();
  await expect(input).toHaveValue("解释这个报错：Permission denied");
  expect(bodies).toHaveLength(0);
  await input.press("Enter");
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(1);
});
