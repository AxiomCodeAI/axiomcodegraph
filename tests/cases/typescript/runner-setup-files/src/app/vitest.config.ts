import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['@testing-library/jest-dom/vitest', './test/setup.ts'],
    globalSetup: ['./test/scripts/globalSetup.ts'],
  },
})
