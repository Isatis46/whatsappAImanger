import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["**/.next/**", "**/next-env.d.ts", "**/dist/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
