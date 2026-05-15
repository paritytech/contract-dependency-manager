#![no_main]
#![no_std]

// Workspace-sibling integration test for `cdm::import!`.
//
// The macro is exercised end-to-end: it locates cdm.json at this crate's
// root, resolves @test/sample → target "test" → version 1, then reads
// $HOME/.cdm/test/contracts/@test/sample/1/abi.json. $HOME is redirected to
// ./fixtures via .cargo/config.toml, so the macro reads the in-tree fixture.
//
// The fixture abi.json includes tuple-bearing function signatures to
// exercise the codegen paths that fail under Bug 4 upstream. Once the
// upstream fix lands, `cargo pvm-contract build` against this crate becomes
// the only automated end-to-end check for the import macro. The harness
// contract block exists solely to satisfy the PVM bin scaffold (allocator +
// entry point); the test's signal is whether the build succeeds.

use pvm_contract as pvm;

cdm::import!("@test/sample");

#[pvm::contract(cdm = "@test/import-test")]
mod harness {
    #[pvm::constructor]
    pub fn new() -> Result<(), Error> {
        Ok(())
    }
}
