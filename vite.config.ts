import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    // npm consumers do not apply our pnpm decoder patch; ship the patched code.
    deps: { alwaysBundle: ["jpeg-js"], onlyBundle: ["jpeg-js"] },
  },
  test: {
    coverage: {
      // Coverage blind spot: the boot test spawns the packaged dist/rokit.mjs
      // to prove the real binary starts; V8 coverage cannot attribute
      // subprocess execution on vitest 4, so the bin shim src/rokit.ts is
      // excluded by design. All other CLI tests run the same entry in-process
      // (mainEffect and the command effects). When vite-plus ships vitest 5,
      // coverage.autoAttachSubprocess can close the remaining gap.
      exclude: ["src/**/*.d.ts", "src/rokit.ts"],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        branches: 53,
        functions: 58,
        lines: 66,
        statements: 66,
      },
    },
    exclude: ["dist/**", "node_modules/**", ".repos/**"],
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
  },
});
