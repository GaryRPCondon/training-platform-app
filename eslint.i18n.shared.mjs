import i18next from "eslint-plugin-i18next";

// ───────────────────────────────────────────────────────────────────────────
// Shared i18n gate: user-facing strings MUST be externalized via next-intl.
// See "Internationalization (i18n)" in CLAUDE.md. Single source of truth,
// consumed by both:
//   • eslint.config.mjs        — IDE / full `npm run lint`
//   • eslint.config.i18n.mjs   — scoped `npm run lint:i18n` (pre-commit gate)
//
// Scope: the user-facing layer only (app/** + components/**). Three checks:
//   1. no-literal-string (jsx-text-only) — visible text between JSX tags.
//   2. no-restricted-syntax — user-facing attributes (aria-label/title/alt and
//      "prosey" placeholders) + toast.*() string literals: the non-JSX-text
//      sinks that mode:jsx-text-only doesn't cover.
// Kept deliberately narrow — a noisy gate gets disabled. Add a new sink to the
// selectors below rather than widening no-literal-string to mode:all.
// ───────────────────────────────────────────────────────────────────────────
export const i18nGate = [
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-text-only",
          words: {
            // NOTE: overriding `words` replaces the plugin defaults wholesale
            // (the rule merges options shallowly), so equivalents are re-listed
            // here, then the project allowlist is appended. Matching is a full
            // match against the trimmed text.
            exclude: [
              // Any text with no letters — punctuation, digits, whitespace,
              // dashes/arrows/quotes (–, —, →, ·, “, ”, •), emoji. Never
              // translatable prose. Subsumes the plugin's punctuation/
              // htmlEntities/emoji defaults with one robust rule.
              /^[^\p{L}]+$/u,
              "[A-Z_-]+", // ALL-CAPS codes & acronyms (VDOT, RTL, …)
              // ── project allowlist ──
              "TrAIner", // product/brand name — never translated
              // Unit labels. Externalising these is the separate, deferred
              // locale-formatting workstream (see CLAUDE.md › i18n › Deferred),
              // not the string-extraction gate.
              "bpm",
              "km",
              "mi",
              "kg",
              "m",
              "h",
              "s",
              "min",
              "hrs?",
            ],
          },
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          // aria-label / title / alt are essentially always prose → unconditional.
          selector:
            "JSXAttribute[name.name=/^(aria-label|title|alt)$/] > Literal",
          message:
            "User-facing attribute strings must be externalized via next-intl (useTranslations / getTranslations), not hardcoded. See CLAUDE.md › Internationalization.",
        },
        {
          // Placeholders: only flag values with 3+ consecutive word chars, i.e.
          // real prose ("Filter by name…"). Skips format hints ("—", "M", "SS",
          // "••••") which are not translatable copy.
          selector:
            "JSXAttribute[name.name='placeholder'] > Literal[value=/\\w{3}/]",
          message:
            "User-facing placeholder strings must be externalized via next-intl, not hardcoded. See CLAUDE.md › Internationalization.",
        },
        {
          selector:
            "CallExpression[callee.object.name='toast'][callee.property.name=/^(success|error|info|warning|message|loading)$/] > Literal:first-child",
          message:
            "User-facing toast strings must be externalized via next-intl, not hardcoded. See CLAUDE.md › Internationalization.",
        },
      ],
    },
  },
  // Exempt the layers that legitimately carry raw strings:
  //  - components/ui/**: shadcn/Radix primitives; copy comes from callers' props.
  //  - dev-only screens: internal QA tooling, never shown to end users.
  //  - tests: assertion fixtures, not shipped UI.
  {
    files: [
      "components/ui/**/*.{ts,tsx}",
      "app/dashboard/dev/**/*.{ts,tsx}",
      "app/dashboard/plan-preview/**/*.{ts,tsx}",
      "**/*.test.{ts,tsx}",
    ],
    rules: {
      "i18next/no-literal-string": "off",
      "no-restricted-syntax": "off",
    },
  },
];
