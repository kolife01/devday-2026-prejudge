# Third-party notices

This repository contains an unmodified source snapshot from:

- Repository: https://github.com/schroneko/automated-hachathon-judge
- Commit: `f5c843ddad7aea1c68023e145ca9c0be0b575093`
- Copyright (c) 2026 schroneko
- License: MIT, preserved in [reference/upstream/LICENSE](reference/upstream/LICENSE)

`src/nuko-score.mjs` is a JavaScript adaptation of `src/shared/nuko-score.ts` with TypeScript types removed and no logic change. `src/evidence.mjs` adapts the path-ranking and clipping logic in `src/container/github.ts` and constants. The scoring criteria derive from `src/shared/constants.ts`.

All upstream reference files are for analysis only. This tool does not run the upstream Cloudflare service or its deployment configuration. Its billing incident report and large assets are outside the retained snapshot's scope, as recorded in PROVENANCE.json.
