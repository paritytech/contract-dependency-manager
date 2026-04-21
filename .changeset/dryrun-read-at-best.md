---
"@dotdm/contracts": patch
---

Read dry-run state at `"best"` instead of polkadot-api's `"finalized"` default for `ReviveApi.instantiate` calls (`ContractDeployer.dryRunDeploy` and the pipeline's `check-needs-deploy` probe). Fixes a race where a caller that just ran `Revive.map_account` (or any prerequisite state change) at best-block would see `AccountUnmapped` from `dryRunDeploy` until finality caught up ~12–24s later. Best-block is correct semantically: when the real deploy tx lands it'll execute on a future best block that also includes the mapping, so the estimate matches execution.
