import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const CORE = ['src/{contracts,vehicles,sim,scoring,content}/**'];
const THREE = ['three', 'three/*'];
const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'performance',
  'requestAnimationFrame',
];
const NONDETERMINISTIC_GLOBALS = [
  'globalThis',
  'self',
  'location',
  'matchMedia',
  'fetch',
  'sessionStorage',
  'indexedDB',
  'setTimeout',
  'setInterval',
];

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.remember', '.claude', '.superpowers'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  { linterOptions: { noInlineConfig: true } },
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
    },
  },
  { files: ['**/*.{js,mjs,cjs}'], extends: [tseslint.configs.disableTypeChecked] },
  {
    files: ['**/*.ts'],
    ignores: ['src/render/**', 'dev/**', ...CORE],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: THREE, message: 'Only src/render imports Three.js' }] },
      ],
    },
  },
  {
    files: ['e2e/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: THREE, message: 'Only src/render imports Three.js' }],
          paths: [
            {
              name: '@playwright/test',
              importNames: ['test', 'expect'],
              message: "Import test and expect from './fixtures' so the console guard applies",
            },
          ],
        },
      ],
    },
  },
  {
    files: CORE,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                ...THREE,
                '**/render/**',
                '**/app/**',
                '**/hud/**',
                '**/input/**',
                '**/pwa/**',
                '**/i18n/**',
              ],
              message: 'Core modules import no Three.js, DOM, or UI layers',
            },
            {
              regex: '^(\\.\\./)+(render|app|hud|input|pwa|i18n)(/|$)',
              message: 'Core modules import no Three.js, DOM, or UI layers',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...DOM_GLOBALS],
    },
  },
  {
    files: CORE,
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', ...DOM_GLOBALS, ...NONDETERMINISTIC_GLOBALS],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Core modules are deterministic' },
        { object: 'Date', property: 'now', message: 'Core modules are deterministic' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: 'ImportExpression', message: 'Core modules import statically' },
        { selector: 'MetaProperty', message: 'Core modules do not read module metadata' },
        {
          selector: ":matches(NewExpression, CallExpression)[callee.name='Date']",
          message: 'Core modules are deterministic',
        },
      ],
    },
  },
);
