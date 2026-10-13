// Prints REPORT.md's bench tables from results/: per text, each method's median (min–max) in ms
// and its ratio to JSON.parse of the same text in the same environment.
//   node tables.mjs results/node.json results/vscode-1.141.0.json
import { readFileSync } from 'node:fs';

for (const file of process.argv.slice(2)) {
  const results = JSON.parse(readFileSync(file, 'utf8'));
  const bench = results.bench ?? results.results;
  const where = results.vscode ? `VS Code ${results.vscode} webview` : `Node ${results.node}`;
  const ids = Object.keys(bench);
  const methods = [...new Set(ids.flatMap((id) => Object.keys(bench[id])))];
  console.log(`\n#### ${where}\n`);
  console.log(`| Method | ${ids.join(' | ')} |`);
  console.log(`|---|${ids.map(() => '---').join('|')}|`);
  for (const method of methods) {
    const cells = ids.map((id) => {
      const r = bench[id][method];
      if (!r) return '';
      if (r.skipped) return `skipped (${r.skipped})`;
      if (r.error) return `error: ${r.error}`;
      const base = bench[id]['JSON.parse'].median;
      const ratio = method === 'JSON.parse' ? '' : ` · **${(r.median / base).toFixed(2)}×**`;
      return `${r.median} (${r.min}–${r.max})${ratio} · ${r.answer}`;
    });
    console.log(`| ${method} | ${cells.join(' | ')} |`);
  }
}
