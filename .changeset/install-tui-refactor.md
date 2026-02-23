---
"@dotdm/cli": patch
---

Refactor install command with Ink-based table UI matching deploy command style. Run contract installs in parallel with animated spinners and progress display. Extract shared visual components (Spinner, Link, Cell, etc.) into a shared component library. Rename pipeline.ts to deploy-pipeline.ts for consistency. Silence papi "Incompatible runtime entry" stderr noise on preview-net. Restructure shared-counter template to combine Rust and TypeScript into a single project root with cdm crate dependency.
