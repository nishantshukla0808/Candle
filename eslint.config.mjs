// Root ESLint flat config — Phase 0 quality gate: no console in production code.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      // Jest-only @nestjs/swagger decorator shim (plain JS, not type-checked).
      'apps/api/test/swagger-stub.js',
      // Prisma seed is a standalone script, not part of the app tsconfig.
      'apps/api/prisma/seed.ts',
      // Seed data files are imported by seed.ts only; same standalone
      // treatment (assessment-bank.ts predates Phase 3 and failed lint
      // the same way; question-bank-seed.ts is the Phase 3 equivalent).
      'apps/api/prisma/assessment-bank.ts',
      'apps/api/prisma/question-bank-seed.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Production code must use the Logger service, never console.
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'off',
    },
  },
  // Plain JS configs: lint without type information.
  {
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  // Test files may use console for debugging output. The in-memory fakes
  // are intentionally loosely typed (Map<string, any> stores); the
  // type-checked unsafe-* rules stay on for production code.
  {
    files: ['**/*.spec.ts', '**/test/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
    },
  }
);
