// Scoped i18n-only ESLint config — NOT auto-loaded (invoked via
// `eslint --config eslint.config.i18n.mjs`, i.e. `npm run lint:i18n`).
//
// Runs ONLY the i18n gate (eslint.i18n.shared.mjs) with a minimal TS+JSX
// parser, so the pre-commit hook can hard-block new un-externalized strings
// without being held up by unrelated findings in the full `npm run lint`.
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import { i18nGate } from "./eslint.i18n.shared.mjs";

export default [
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    // This scoped config only runs the i18n rules, so it shouldn't police
    // disable directives aimed at rules it deliberately doesn't load.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    // Registered (rules left off) only so existing inline
    // `// eslint-disable-next-line react-hooks/exhaustive-deps` directives in
    // the source resolve — otherwise ESLint errors on the unknown rule name.
    plugins: { "react-hooks": reactHooks },
  },
  ...i18nGate,
];
