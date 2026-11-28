import uinaf, { env, ignorePatterns } from "@uinaf/oxlint-config/effect/vite-plus";
import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    extends: [uinaf],
    env,
    ignorePatterns,
    rules: {
      "@nkzw/no-instanceof": "off",
      "anti-slop-effect/no-manual-tag-comparison": "off",
      "anti-slop-effect/no-service-constructor-imports": "off",
      "anti-slop/no-runtime-typeof": "off",
      "anti-slop/no-unknown-parameters": "off",
      "import/no-namespace": "off",
      "no-console": "off",
      "quality/no-known-value-widening": "off",
      "quality/no-unknown-returns": "off",
      "quality/no-unsafe-dictionary-type": "off",
      "typescript/no-misused-spread": "off",
      "typescript/no-non-null-assertion": "off",
      "typescript/no-unnecessary-type-assertion": "off",
      "typescript/no-unsafe-argument": "off",
      "typescript/no-unsafe-assignment": "off",
      "uinaf/no-comments": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/prefer-at": "off",
      "unicorn/prefer-import-meta-properties": "off",
      "unicorn/prefer-string-raw": "off",
      "unicorn/prefer-string-replace-all": "off",
    },
  },
  pack: {
    // npm consumers do not apply our pnpm decoder patch; ship the patched code.
    deps: { alwaysBundle: ["jpeg-js"], onlyBundle: ["jpeg-js"] },
  },
  test: {
    coverage: {
      // Coverage blind spot: the boot test spawns the packaged dist/rokit.mjs
      // to prove the real binary starts; that subprocess is not attributed to
      // coverage, so the bin shim src/rokit.ts is excluded by design. All other
      // CLI tests run the same entry in-process (mainEffect and the command
      // effects). Vitest 5 coverage.autoAttachSubprocess can close the gap.
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
