// The web e2e suite's entry (spec 013 T1, ADR-013; the full suite 013 T4). test/web/run.mjs bundles
// it with esbuild into dist-test/web/suite.js, one CommonJS file like the browser entry, and VS
// Code loads it in the web worker extension host through --extensionTestsPath and calls `run`.
// Mocha's browser build sets the global `mocha`; the test files register their cases once `setup`
// has run. The palette check comes right after the first activation (spec 013 criterion 8).
/// <reference types="mocha" />
import 'mocha/mocha';

export async function run(): Promise<void> {
  mocha.setup({ ui: 'bdd', reporter: undefined, timeout: 120_000 });
  await import('./smoke');
  await import('./palette');
  await import('./desktopOnly');
  await import('./editing');
  await import('./actions');
  await import('./validation');
  await import('./convert');
  await import('./compare');
  await import('./csv');
  await import('./import');
  await import('./query');
  await import('./largeFile');
  await import('./settings');
  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) =>
      failures ? reject(new Error(`${failures} web e2e test(s) failed`)) : resolve(),
    );
  });
}
