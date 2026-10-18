import { writeFile } from 'node:fs/promises';
import { renderRubricDocument } from '../src/rubric.mjs';
import { renderPublishedRubric } from '../src/published-scoring.mjs';
await writeFile(new URL('../docs/scoring-rubric.md', import.meta.url), renderRubricDocument());
await writeFile(new URL('../docs/published-rubric.md', import.meta.url), renderPublishedRubric());
console.log('旧44段階と公開コードの段階条件の資料を生成しました。');
