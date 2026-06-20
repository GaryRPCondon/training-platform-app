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
]);

export default eslintConfig;
