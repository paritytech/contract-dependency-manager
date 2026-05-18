#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 65536)]
mod instagram {
    use alloc::string::String;
    use pvm_contract_sdk::{Address, HostApi, Lazy, Mapping, MappingString, SolType};

    pvm_contract_sdk::sol_revert_enum! {
        pub enum Error {
            PostNotFound(PostNotFound),
        }
    }

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct PostNotFound;

    /// Returned by `get_post` — assembled from three parallel storage maps.
    ///
    /// `PostData` is *not* stored as a single Mapping value: the new SDK's
    /// dynamic-value storage (`MappingString`/`MappingBytes`) covers leaf
    /// strings/bytes only, not structs containing dynamic fields. The contract
    /// stores `description`, `photo_cid`, and `timestamp` in three parallel
    /// mappings keyed by `(user, index)` and assembles `PostData` on read.
    #[derive(Clone, SolType)]
    pub struct PostData {
        pub description: String,
        pub photo_cid: String,
        pub timestamp: u64,
    }

    pub struct Instagram {
        #[slot(0)]
        user_count: Lazy<u64>,
        #[slot(1)]
        post_counts: Mapping<[u8; 20], u64>,
        #[slot(2)]
        post_descriptions: MappingString<([u8; 20], u64)>,
        #[slot(3)]
        post_photo_cids: MappingString<([u8; 20], u64)>,
        #[slot(4)]
        post_timestamps: Mapping<([u8; 20], u64), u64>,
        #[slot(5)]
        users: Mapping<u64, [u8; 20]>,
        #[slot(6)]
        user_registered: Mapping<[u8; 20], bool>,
    }

    impl Instagram {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {
            self.user_count.set(&0);
        }

        #[pvm_contract_sdk::method]
        pub fn create_post(&mut self, description: String, photo_cid: String) -> u64 {
            let caller = self.caller();

            if !self.user_registered.get(&caller.0) {
                let count = self.user_count.get();
                self.users.insert(&count, &caller.0);
                self.user_count.set(&(count + 1));
                self.user_registered.insert(&caller.0, &true);
            }

            let index = self.post_counts.get(&caller.0);

            let mut buf = [0u8; 32];
            self.host().now(&mut buf);
            let timestamp = u64::from_le_bytes(buf[0..8].try_into().unwrap());

            let key = (caller.0, index);
            self.post_descriptions.insert(&key, description.as_str());
            self.post_photo_cids.insert(&key, photo_cid.as_str());
            self.post_timestamps.insert(&key, &timestamp);
            self.post_counts.insert(&caller.0, &(index + 1));

            index
        }

        #[pvm_contract_sdk::method]
        pub fn get_post_count(&self, user: Address) -> u64 {
            self.post_counts.get(&user.0)
        }

        #[pvm_contract_sdk::method]
        pub fn get_post(&self, user: Address, index: u64) -> Result<PostData, Error> {
            let key = (user.0, index);
            // post_counts is the authoritative existence check — a post with
            // index < post_counts(user) exists.
            if index >= self.post_counts.get(&user.0) {
                return Err(PostNotFound.into());
            }
            Ok(PostData {
                description: self.post_descriptions.get(&key),
                photo_cid: self.post_photo_cids.get(&key),
                timestamp: self.post_timestamps.get(&key),
            })
        }

        #[pvm_contract_sdk::method]
        pub fn get_user_count(&self) -> u64 {
            self.user_count.get()
        }

        #[pvm_contract_sdk::method]
        pub fn get_user_at(&self, index: u64) -> Address {
            Address(self.users.get(&index))
        }

        fn caller(&self) -> Address {
            let mut buf = [0u8; 20];
            self.host().caller(&mut buf);
            Address(buf)
        }
    }
}
