import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { renderRubricDocument } from '../src/rubric.mjs';
import { renderPublishedRubric } from '../src/published-scoring.mjs';

for (const folder of ['src', 'scripts', 'tests']) {
  for (const name of await readdir(folder, { recursive: true })) {
    if (name.endsWith('.mjs')) execFileSync(process.execPath, ['--check', join(folder, name)], { stdio: 'inherit' });
  }
}
for (const name of await readdir('config')) if (name.endsWith('.json')) JSON.parse(await readFile(join('config', name), 'utf8'));
if (await readFile('docs/scoring-rubric.md', 'utf8') !== renderRubricDocument()) throw new Error('Rubric docs drift: run npm run rubric');
if (await readFile('docs/published-rubric.md', 'utf8') !== renderPublishedRubric()) throw new Error('Published rubric docs drift: run npm run rubric');
for (const base of ['reference/upstream', 'reference/published-20261018']) {
  const manifest = JSON.parse(await readFile(join(base, 'PROVENANCE.json'), 'utf8'));
  for (const f of manifest.files) {
    const sha = createHash('sha256').update(await readFile(join(base, f.path))).digest('hex');
    if (sha !== f.sha256) throw new Error(`Upstream snapshot modified: ${f.path}`);
  }
  console.log(`Syntax/JSON checks passed; ${base}: ${manifest.files.length} source hashes verified.`);
}
