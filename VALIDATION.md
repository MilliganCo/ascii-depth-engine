# Publication-copy validation

Date: 2026-10-29. Browser source edition; Node v24.15.0 / npm 11.12.1.

| Check | Result |
| --- | --- |
| Exact source copy | 48 allowlisted files matched their original SHA256 before copying |
| Locked dependency install | PASS; 63 packages, `npm ci --ignore-scripts --no-audit --no-fund` |
| Typecheck | PASS; `npm run typecheck` |
| Unit tests | PASS; 43 tests in 5 files, `npm test -- --maxWorkers=2` |
| Production build | PASS; `npm run build` |

An initial offline-only install reported ENOTCACHED. Package-registry access was
then used only for the locked dependency install. Both projects kept their
original lockfile bytes. Install lifecycle scripts, audit and funding requests
were disabled; no Playwright browser was downloaded. npm cache and temporary
files were confined to the copy and excluded from source control.

Versions: Vite 8.3.3, Vitest 5.0.3,
TypeScript 7.0.2, React 19.3.0.

Browser/E2E execution, screenshots, live application startup, native builds,
installers, model calls and device/graphics acceptance: NOT_RUN. Unit tests use
their existing Node/jsdom or simulation fixtures. Type/build success does not
prove browser rendering, input behavior or performance.

Build warning: a minified bundle chunk exceeds 500 kB. Build completed; bundle splitting/performance work was outside this export.

Game/editor mechanics source remained byte-identical. Desktop wrapper and binary release/icon packages are omitted.
