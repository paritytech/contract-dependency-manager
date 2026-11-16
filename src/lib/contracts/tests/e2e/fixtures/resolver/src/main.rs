//! The stand-in resolver: every `resolve` answers Return(`MARKER`), so a name
//! routed through it is recognizably "on the fixture", and `setCode` /
//! `getCode` let the registry's `upgradeResolver` move to it and back.

#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 262144)]
mod resolver_fix {
    use contract_registry_core::slots::{ADMIN_SLOT, IMPLEMENTATION_SLOT};
    use pvm_contract_sdk::{Address, Bytes, HostApi, Lazy, SolError, SolType, U256};

    pub const MARKER: [u8; 32] = [0xF1; 32];

    /// The real resolver's return type, byte-for-byte.
    #[derive(SolType)]
    pub struct Resolution {
        pub kind: u8,
        pub target: Address,
        pub strip: u32,
        pub payload: Bytes,
    }

    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct UnauthorizedAdmin;

    #[derive(Debug, PartialEq, Eq, SolError)]
    pub enum Error {
        UnauthorizedAdmin(UnauthorizedAdmin),
    }

    pub struct ResolverFix {
        #[slot(raw = IMPLEMENTATION_SLOT)]
        implementation: Lazy<Address>,
        #[slot(raw = ADMIN_SLOT)]
        admin: Lazy<Address>,
    }

    impl ResolverFix {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {
            let deployer = self.caller();
            self.admin.set(&deployer);
        }

        #[pvm_contract_sdk::method]
        pub fn resolve(&self, caller: Address, value: U256, data: Bytes) -> Resolution {
            let _ = (caller, value, data);
            Resolution {
                kind: 0,
                target: Address::ZERO,
                strip: 0,
                payload: Bytes(MARKER.to_vec()),
            }
        }

        #[pvm_contract_sdk::method]
        pub fn set_code(&mut self, new_implementation: Address) -> Result<(), Error> {
            if self.caller() != self.admin.get() {
                return Err(UnauthorizedAdmin.into());
            }
            self.implementation.set(&new_implementation);
            Ok(())
        }

        #[pvm_contract_sdk::method]
        pub fn get_code(&self) -> Address {
            self.implementation.get()
        }

        fn caller(&self) -> Address {
            let mut caller = [0u8; 20];
            self.host().caller(&mut caller);
            Address(caller)
        }
    }
}
