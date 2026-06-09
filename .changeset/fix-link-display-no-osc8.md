---
"@parity/cdm-cli": patch
---

Fix deploy/install link display in terminals without OSC 8 hyperlink support. Instead of squeezing the full URL into a narrow table column (where it wrapped into an unreadable smear), the cell now keeps the short hash and the full link is printed on its own line below the row.
