import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  workers: 1,
  timeout: 20000,
  use: {
    baseURL: "http://127.0.0.1:31380",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node tests/ui-server.js",
    url: "http://127.0.0.1:31380/api/session",
    reuseExistingServer: false
  }
});
