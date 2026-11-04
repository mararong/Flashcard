import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
export default defineConfig({
  testDir: "./pages-tests",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4173/Flashcard/",
    launchOptions: {
      executablePath: existsSync("/usr/bin/chromium")
        ? "/usr/bin/chromium"
        : undefined,
    },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command:
      "npx vite preview --host 127.0.0.1 --port 4173 --strictPort --base /Flashcard/",
    url: "http://127.0.0.1:4173/Flashcard/",
    reuseExistingServer: false,
  },
});
