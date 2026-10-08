// Placeholder for a standard script (AGENTS.md §Canonical stack) whose task has not landed yet.
// Exits 0 so gates can name every script from day one; the owning task replaces the root script.
const [name, owner] = process.argv.slice(2);
console.log(`${name}: nothing to run yet (implemented by ${owner})`);
