import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Text from chat, titles and channel names comes from strangers. It is only ever inserted as
// text, never as HTML – these rules make that a lint error instead of a review question.
const noHtmlInjection = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'Insert text as text. HTML from outside is never rendered (see SECURITY.md).',
  },
  {
    selector: 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
    message: 'Use textContent or React. HTML from outside is never rendered (see SECURITY.md).',
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: 'Use DOM nodes or React. HTML from outside is never rendered (see SECURITY.md).',
  },
  {
    selector: "CallExpression[callee.object.name='document'][callee.property.name='write']",
    message: 'document.write is not allowed.',
  },
];

export default defineConfig(
  { ignores: ['out/', 'release/', 'node_modules/', 'test-results/', 'playwright-report/', 'tour/out/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-syntax': ['error', ...noHtmlInjection],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/main/**', 'src/preload/**', 'tests/**', 'tour/**', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
);
