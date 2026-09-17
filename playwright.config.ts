import { defineConfig, devices } from '@playwright/test'

process.loadEnvFile('.env.local')

export default defineConfig({
  testDir: './tests/browser',
  globalSetup: './tests/browser/setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    storageState: '.test-session.json',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.TEST_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
})
