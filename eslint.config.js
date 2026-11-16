import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const CORE = ['src/{contracts,vehicles,sim,scoring,content}/**'];
const THREE = ['three', 'three/*'];

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.remember', '.claude', '.superpowers'] },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    files: ['**/*.ts'],
    ignores: ['src/render/**', ...CORE],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: THREE, message: 'Only src/render imports Three.js' }] },
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
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'localStorage',
        'performance',
        'requestAnimationFrame',
      ],
    },
  },
);
