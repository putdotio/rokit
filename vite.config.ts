import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    coverage: {
      exclude: ["src/**/*.d.ts", "src/rokit.ts"],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        branches: 51,
        functions: 55,
        lines: 63,
        statements: 63,
      },
    },
    exclude: ["dist/**", "node_modules/**", ".repos/**"],
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
  },
});
