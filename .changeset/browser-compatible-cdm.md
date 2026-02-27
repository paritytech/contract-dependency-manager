---
"@dotdm/cdm": minor
"@dotdm/contracts": minor
"@dotdm/cli": patch
---

Make @dotdm/cdm browser-compatible with self-contained cdm.json

- cdm.json now embeds resolved contract data (ABI, address, version, metadataCid) in a `contracts` field, populated by `cdm install`
- New browser-safe Cdm class reads from in-memory cdm.json instead of ~/.cdm/ filesystem
- Added `browser` conditional export so bundlers (Vite/webpack/esbuild) pick the right entry
- CdmJson `dependencies` type widened to `number | string` for JSON import compatibility
- Reverted @dotdm/contracts to single `.` export (subpath exports no longer needed)
- TypeScript codegen now reads ABIs from cdm.json instead of resolving from disk
