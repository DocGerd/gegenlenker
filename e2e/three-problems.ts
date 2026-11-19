import type { Page } from '@playwright/test';

/** Warnings and errors three logs about itself (`THREE.TSL: ...` for a shader graph that failed to build). */
export function collectThreeProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if ((m.type() === 'warning' || m.type() === 'error') && m.text().startsWith('THREE.')) {
      problems.push(m.text());
    }
  });
  return problems;
}
