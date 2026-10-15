// Configuration ESLint : TypeScript strict + docstrings TSDoc obligatoires (règle 6).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";

export default tseslint.config(
  { ignores: ["dist/", "coverage/", "node_modules/", "npmcache/", "storage/"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      // Préfixe `_` = paramètre/variable volontairement ignoré (ex. signature à 4 arguments d'Express).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  // Les fichiers de config JS ne sont pas dans le projet TypeScript : pas de règles typées.
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked },
  {
    files: ["src/**/*.ts"],
    plugins: { jsdoc },
    rules: {
      // Docstring sur chaque élément exporté.
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          require: { FunctionDeclaration: true, ClassDeclaration: true, MethodDefinition: true, ArrowFunctionExpression: false },
          contexts: ["TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSMethodSignature"],
        },
      ],
      "jsdoc/require-description": "error",
    },
  },
);
