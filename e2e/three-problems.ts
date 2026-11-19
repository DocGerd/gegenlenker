import type { Page } from '@playwright/test';

/** A warning or error three logs about itself (`THREE.TSL: ...` for a shader graph that failed to build). */
export function isThreeProblem(type: string, text: string): boolean {
  return (type === 'warning' || type === 'error') && text.startsWith('THREE.');
}

export function collectThreeProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (isThreeProblem(m.type(), m.text())) problems.push(m.text());
  });
  return problems;
}
