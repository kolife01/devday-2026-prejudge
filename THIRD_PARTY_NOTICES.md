# Third-party notices

This repository contains an unmodified source snapshot from:

- Repository: https://github.com/schroneko/automated-hachathon-judge
- Commit: `f5c843ddad7aea1c68023e145ca9c0be0b575093`
- Copyright (c) 2026 schroneko
- License: MIT, preserved in [reference/upstream/LICENSE](reference/upstream/LICENSE)

`src/nuko-score.mjs` is a JavaScript adaptation of `src/shared/nuko-score.ts` with TypeScript types removed and no logic change. `src/evidence.mjs` adapts the path-ranking and clipping logic in `src/container/github.ts` and constants. The scoring criteria derive from `src/shared/constants.ts`.

All upstream reference files are for analysis only. This tool does not run the upstream Cloudflare service or its deployment configuration. Its billing incident report and large assets are outside the retained snapshot's scope, as recorded in PROVENANCE.json.

The additional unmodified 12-file snapshot in `reference/published-20261018/` comes from the same repository at commit `23016a7dcfe71cf67a3d9405a84ff3b9021e203c`, copyright (c) 2026 schroneko. Its MIT license is preserved in [reference/published-20261018/LICENSE](reference/published-20261018/LICENSE); each retained file is hashed in PROVENANCE.json.

`src/published/` adapts that commit's constants, predicate conditions and score derivation, DevDay reference, current v4 prompts/rubric, duplicate-content packing, reviewed-asset manifest, path filters, implementation eligibility, and explanation schema to dependency-free JavaScript. Historical v2/v3 explanation support is omitted. `src/published-evidence.mjs`, `src/published-scoring.mjs`, and `src/published-api.mjs` also adapt its canonical snapshot shape, limits, fixed-score guards and token-bound calculation. Network collection, CLI storage and reporting are local implementations. The upstream deployment, production credentials, candidate source snapshots, scores and operational reports are not vendored.
