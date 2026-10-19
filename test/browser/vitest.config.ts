import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // `arthron` links to the repository root; let Vite serve its dist/.
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
  test: {
    include: ["*.test.ts"],
    globalSetup: ["./server.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [
        { browser: "chromium" },
        { browser: "firefox" },
        { browser: "webkit" },
      ],
    },
  },
});
