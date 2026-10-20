import js from "@eslint/js";
import ts from "typescript-eslint";
import globals from "globals";
export default ts.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".local/**",
      ".vercel/**",
      "supabase/.temp/**",
      "supabase/.branches/**",
      "public/sdk/**",
      "public/downloads/**",
      "public/demo-react/**",
      "test-results/**",
      "playwright-report/**",
      "examples/react/app.js",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
