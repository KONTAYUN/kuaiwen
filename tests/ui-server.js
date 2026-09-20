// Isolated fixture: fake credentials and fake model; never touches the user's config.
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { createMockModel, listen } from "./mock-model.js";
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kuaiwen-ui-"));
const mock = createMockModel();
const baseUrl = await listen(mock.server);
const configPath = path.join(directory, "config.json");
await fs.writeFile(
  configPath,
  JSON.stringify({
    profiles: [
      { id: "mock", name: "日常快问", model: "mock-fast", baseUrl, apiKey: "mock-secret-never-expose" },
      { id: "second", name: "备用模型", model: "mock-fast", baseUrl, apiKey: "mock-second-secret" }
    ],
    activeProfileId: "mock"
  })
);
const app = createApp({
  password: "test-password",
  secret: "test-secret",
  configPath,
  distDir: path.resolve("dist")
});
const server = http.createServer(app);
await listen(server, 31380);
console.log("UI fixture ready");
async function shutdown() {
  server.closeAllConnections();
  server.close();
  mock.server.closeAllConnections();
  mock.server.close();
  await fs.rm(directory, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
