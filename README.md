# ASCII Depth Engine

Browser source for a procedural ASCII scene editor and a small fantasy RPG.
The editor has Canvas2D and Three.js views, seeded worlds, layers, camera controls,
keyframes and JSON import/export. The RPG prototype includes exploration,
melee combat, loot, a relic quest and a separate save format.

The RPG is intentionally small: buildings have no interiors, enemy navigation is
simple, and there is no multiplayer, large campaign, crafting or audio system.
The included `.ade.json` and `.rpg.json` files are fictional procedural examples.

## Development

Use Node.js 22.12+ and npm. From this directory:

```sh
npm ci --ignore-scripts
npm run dev
```

Open the local address reported by Vite (`127.0.0.1:5173` by default). Three.js
rendering requires WebGL2; the editor also has a Canvas2D path. The application
uses local storage for progress and downloads selected exports as files.
Clearing browser storage removes local autosaves; keep exported saves separately.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

Unit tests exercise project/save parsing, deterministic generation, geometry,
simulation, world boundaries, input state and the RPG quest/state transitions.
Build output is generated in `dist/` and is excluded from source control.
See [VALIDATION.md](VALIDATION.md) for actual results and limitations.

## Publication scope

This snapshot provides browser source and examples. It contains no prebuilt
application, installer, native wrapper or desktop icon package. The guarded
desktop-file bridge remains as source, but a native build is outside this edition.
Browser E2E source is retained for reference; its harness and execution are not
part of the verified unit/build commands above.

No account or model-provider service is required. Unit/type/build checks do not
prove graphics performance, browser input behavior or game balance. Dependencies
are installed from the lockfile and retain their upstream terms. No project-wide
reuse license was supplied with the local source.
