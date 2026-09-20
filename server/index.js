import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const password = process.env.KUAIWEN_PASSWORD || "kuaiwen";
const secret = process.env.KUAIWEN_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (
  process.env.NODE_ENV === "production" &&
  (["kuaiwen", "change-me", "your-strong-password"].includes(password) ||
    password.length < 12 ||
    !process.env.KUAIWEN_SESSION_SECRET ||
    secret.length < 32 ||
    /change-this|your-long-random-secret/.test(secret))
) {
  throw new Error(
    "生产部署请设置至少 12 位的 KUAIWEN_PASSWORD 和至少 32 位的随机 KUAIWEN_SESSION_SECRET，不能使用示例值。"
  );
}
const app = createApp({
  password,
  secret,
  configPath: process.env.KUAIWEN_CONFIG_PATH || path.join(root, "data/config.json"),
  distDir: path.join(root, "dist"),
  timeoutMs: Number(process.env.KUAIWEN_REQUEST_TIMEOUT_MS || 90000),
  secureCookie: process.env.KUAIWEN_SECURE_COOKIE === "true",
  trustProxy: Number(process.env.KUAIWEN_TRUST_PROXY || 0)
});
const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`快问已启动：http://localhost:${port}`);
  if (password === "kuaiwen") console.log("本地开发密码为 kuaiwen。公网部署请设置独立密码与会话密钥。");
});
