import { writeFile } from 'node:fs/promises';
import { renderRubricDocument } from '../src/rubric.mjs';
await writeFile(new URL('../docs/scoring-rubric.md', import.meta.url), renderRubricDocument());
console.log('docs/scoring-rubric.mdをconfig/rubric.jsonから生成しました。');
