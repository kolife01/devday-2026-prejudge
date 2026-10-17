import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

for (const folder of ['src', 'scripts', 'tests']) {
  for (const name of await readdir(folder)) {
    if (name.endsWith('.mjs')) execFileSync(process.execPath, ['--check', join(folder, name)], { stdio: 'inherit' });
  }
}
for (const name of await readdir('config')) if (name.endsWith('.json')) JSON.parse(await readFile(join('config', name), 'utf8'));
const base = 'reference/upstream';
const manifest = JSON.parse(await readFile(join(base, 'PROVENANCE.json'), 'utf8'));
for (const f of manifest.files) {
  const sha = createHash('sha256').update(await readFile(join(base, f.path))).digest('hex');
  if (sha !== f.sha256) throw new Error(`Upstream snapshot modified: ${f.path}`);
}
console.log(`Syntax/JSON checks passed; ${manifest.files.length} upstream source hashes verified.`);
