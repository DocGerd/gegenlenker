import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { THREE_FREE_RENDER } from './tools/three-free-render.ts';

const CORE = ['src/{contracts,vehicles,sim,scoring,content,einweiser}/**'];
const THREE = ['three', 'three/*'];
const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'performance',
  'requestAnimationFrame',
];
// The rest of core's ambient surface is fenced by tsconfig.core.json (lib ES2022, no types).
const ES_AMBIENT_GLOBALS = ['globalThis', 'Intl'];

const THREE_MESSAGE = 'Only src/render imports Three.js';
const THREE_IMPORT_CALL = {
  selector: 'ImportExpression[source.value=/^three(\\/|$)/]',
  message: THREE_MESSAGE,
};
const layerSource = (names) => `^(\\.\\.\\/)+(${names.join('|')})(\\/|$)`;
const layers = (names, message) => ({ regex: layerSource(names), message });
const dynamicLayers = (names, message) => ({
  selector: `ImportExpression[source.value=/${layerSource(names)}/]`,
  message,
});
// `import { type X } from 'three'` still loads the module under verbatimModuleSyntax.
const THREE_INLINE_TYPE = {
  selector: `:matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration)[source.value=/^three(\\/|$)/][importKind!='type'][exportKind!='type']`,
  message: 'A Three.js import here must be `import type`',
};
const RENDER_BELOW = 'render sits below the app shell, hud and input';
const HUD_INPUT_BELOW = 'hud and input sit below the app shell';
const THREE_IMPORT_TYPE = {
  selector: 'TSImportType[argument.literal.value=/^three(\\/|$)/]',
  message: THREE_MESSAGE,
};
const CORE_MESSAGE = 'Core modules import no Three.js, DOM, or UI layers';
const CORE_ABOVE = ['render', 'app', 'hud', 'input', 'pwa', 'i18n'];
const CORE_PATTERNS = [
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
    message: CORE_MESSAGE,
  },
  layers(CORE_ABOVE, CORE_MESSAGE),
];
const THREE_PATTERN = { group: THREE, message: THREE_MESSAGE };
const restrictImports = (...patterns) => ['error', { patterns }];

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      '.remember',
      '.claude',
      '.superpowers',
      'test-results',
      'playwright-report',
    ],
  },
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
      'no-restricted-imports': restrictImports(THREE_PATTERN),
      'no-restricted-syntax': ['error', THREE_IMPORT_CALL, THREE_IMPORT_TYPE],
    },
  },
  {
    files: ['src/{hud,input}/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictImports(THREE_PATTERN, layers(['app'], HUD_INPUT_BELOW)),
      'no-restricted-syntax': [
        'error',
        THREE_IMPORT_CALL,
        THREE_IMPORT_TYPE,
        dynamicLayers(['app'], HUD_INPUT_BELOW),
      ],
    },
  },
  {
    files: ['src/render/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': restrictImports(layers(['app', 'hud', 'input'], RENDER_BELOW)),
      'no-restricted-syntax': ['error', dynamicLayers(['app', 'hud', 'input'], RENDER_BELOW)],
    },
  },
  {
    files: THREE_FREE_RENDER,
    rules: {
      'no-restricted-imports': restrictImports(
        {
          ...THREE_PATTERN,
          allowTypeImports: true,
          message: 'This render module is used outside render and must stay free of Three.js',
        },
        layers(['app', 'hud', 'input'], RENDER_BELOW),
      ),
      'no-restricted-syntax': [
        'error',
        THREE_IMPORT_CALL,
        THREE_IMPORT_TYPE,
        THREE_INLINE_TYPE,
        dynamicLayers(['app', 'hud', 'input'], RENDER_BELOW),
      ],
    },
  },
  {
    files: ['e2e/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [THREE_PATTERN],
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
      'no-restricted-imports': restrictImports(...CORE_PATTERNS),
      'no-restricted-globals': ['error', ...DOM_GLOBALS],
      'no-restricted-syntax': [
        'error',
        THREE_IMPORT_CALL,
        THREE_IMPORT_TYPE,
        dynamicLayers(CORE_ABOVE, CORE_MESSAGE),
      ],
    },
  },
  {
    files: ['src/sim/**'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': restrictImports(
        ...CORE_PATTERNS,
        layers(['scoring', 'einweiser'], 'The sim does not import scoring or einweiser'),
      ),
    },
  },
  {
    files: ['src/einweiser/**'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': restrictImports(
        ...CORE_PATTERNS,
        layers(['scoring'], 'einweiser does not import scoring'),
      ),
    },
  },
  {
    files: CORE,
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', ...DOM_GLOBALS, ...ES_AMBIENT_GLOBALS],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Core modules are deterministic' },
        { object: 'Date', property: 'now', message: 'Core modules are deterministic' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: 'ImportExpression', message: 'Core modules import statically' },
        THREE_IMPORT_TYPE,
        { selector: 'MetaProperty', message: 'Core modules do not read module metadata' },
        {
          selector: ":matches(NewExpression, CallExpression)[callee.name='Date']",
          message: 'Core modules are deterministic',
        },
      ],
    },
  },
  {
    files: ['src/app/whats-new*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...['innerHTML', 'outerHTML', 'insertAdjacentHTML'].map((property) => ({
          property,
          message: 'The changelog screen builds DOM from text only',
        })),
      ],
    },
  },
);
