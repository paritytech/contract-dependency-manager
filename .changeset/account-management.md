---
"@dotdm/utils": minor
"@dotdm/env": minor
"@dotdm/cli": minor
---

Add account management for deploying on real chains

- New `@dotdm/utils/accounts` subpath: keypair generation, mnemonic import, `~/.cdm/accounts.json` persistence
- `cdm init -n <chain>`: auto-generate keypair for testnets, show balances and faucet links
- `cdm account set/bal/map`: import mnemonic, check Asset Hub balance + Bulletin allowances, map account for Revive pallet
- Deploy signer resolution: `--suri` >> `accounts.json` >> Alice fallback
- `prepareSignerFromMnemonic` + full mnemonic support in `prepareSignerFromSuri`
- Faucet URLs on `ChainPreset` (paseo Asset Hub + Bulletin)
