import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { i18nGate } from "./eslint.i18n.shared.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // i18n gate — see eslint.i18n.shared.mjs / CLAUDE.md › Internationalization.
  // Also enforced standalone via `npm run lint:i18n` (pre-commit), so the gate
  // works even while the wider `npm run lint` carries unrelated pre-existing
  // findings.
  ...i18nGate,

  // `no-explicit-any` is a hard gate in app/lib/component code. Two zones are
  // exempt because `any` is legitimately dynamic there, not a typing shortcut:
  //  - tests: mock objects / partial fixtures.
  //  - types/database.ts: JSONB columns (garmin_data, user_criteria, …) are
  //    inherently schemaless; tightening them cascades casts onto every reader.
  //  - lib/agent/providers/**: LLM SDK adapters; tools/tool_choice/message
  //    shapes mismatch each vendor SDK's evolving types — typing them means
  //    vendoring those types. `any` is the boundary, not a shortcut.
  {
    files: [
      "**/__tests__/**",
      "**/*.test.{ts,tsx}",
      "types/database.ts",
      "lib/agent/providers/**/*.ts",
    ],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
]);

export default eslintConfig;
