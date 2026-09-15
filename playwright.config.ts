import { defineConfig, devices } from '@playwright/test';

/**
 * e2e 直接对构建产物（vite preview，静态文件）验收。
 * verify 服务与 CI 先执行 npm run build，这里复用同一份 dist。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run preview',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
});
