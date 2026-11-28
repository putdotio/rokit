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
      "quality/no-known-value-widening": "off",
      "quality/no-unknown-returns": "off",
      "quality/no-unsafe-dictionary-type": "off",
      "typescript/no-unsafe-argument": "off",
      "typescript/no-unsafe-assignment": "off",
    },
    overrides: [
      {
        files: ["src/cli.ts", "src/cli-output.ts"],
        rules: {
          "no-console": "off",
        },
      },
      {
        files: ["src/device.ts", "src/package-zip.ts", "test/roku.test.ts"],
        rules: {
          "import/no-namespace": "off",
        },
      },
      {
        files: ["src/cli-command.ts"],
        rules: {
          "typescript/no-misused-spread": "off",
        },
      },
    ],
  },
  pack: {
    deps: { alwaysBundle: ["jpeg-js"], onlyBundle: ["jpeg-js"] },
  },
  test: {
    coverage: {
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
