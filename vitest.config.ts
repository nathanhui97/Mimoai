import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',  // Simulates browser DOM
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});

