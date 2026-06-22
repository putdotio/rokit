import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**", ".repos/**"],
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
  },
});
