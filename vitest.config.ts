import { configDefaults, defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";
import pkg from "./package.json" with { type: "json" };

// Unit tests run in node: pure core modules, stores and services with fakes.
// Monaco and the Tauri runtime are never imported here.
//
// Two projects: `unit` and `slow`. A test that times work over 100,000 lines or more, or
// simulates typing, against a wall clock lives in `<name>.slow.test.ts`. The slow group runs
// after the unit group, alone and with fewer workers (`npm test`, see package.json), so a busy
// full run neither fails its wall-clock budgets nor waits for them.
export default defineConfig({
  plugins: [sveltekit()],
  // Same compile-time constants as vite.config.js
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: "node",
    // The default 5 s is a wall-clock limit too: the bulk tests (300k lines) and the fixture
    // reads take 1 to 3 s on a loaded machine, so the limit sits well above the budgets they assert.
    testTimeout: 20_000,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/*.slow.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "slow",
          include: ["src/**/*.slow.test.ts", "tests/unit/**/*.slow.test.ts"],
        },
      },
    ],
  },
});
