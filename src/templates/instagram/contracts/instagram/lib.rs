#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 65536)]
mod instagram {
    use alloc::string::String;
    use pvm_contract_sdk::{Address, HostApi, Lazy, Mapping, SolType};

    pvm_contract_sdk::sol_revert_enum! {
        pub enum Error {
            PostNotFound(PostNotFound),
            UserNotFound(UserNotFound),
        }
    }

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct PostNotFound;

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct UserNotFound;

    #[derive(Clone, Default, SolType)]
    pub struct PostData {
        pub description: String,
        pub photo_cid: String,
        pub timestamp: u64,
    }

    pub struct Instagram {
        #[slot(0)]
        post_counts: Mapping<[u8; 20], u64>,
        #[slot(1)]
        posts: Mapping<([u8; 20], u64), PostData>,
        #[slot(2)]
        user_count: Lazy<u64>,
        #[slot(3)]
        users: Mapping<u64, [u8; 20]>,
        #[slot(4)]
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

            let post = PostData {
                description,
                photo_cid,
                timestamp,
            };
            self.posts.insert(&(caller.0, index), &post);
            self.post_counts.insert(&caller.0, &(index + 1));

            index
        }

        #[pvm_contract_sdk::method]
        pub fn get_post_count(&self, user: Address) -> u64 {
            self.post_counts.get(&user.0)
        }

        #[pvm_contract_sdk::method]
        pub fn get_post(&self, user: Address, index: u64) -> Result<PostData, Error> {
            if index >= self.post_counts.get(&user.0) {
                return Err(PostNotFound.into());
            }
            Ok(self.posts.get(&(user.0, index)))
        }

        #[pvm_contract_sdk::method]
        pub fn get_user_count(&self) -> u64 {
            self.user_count.get()
        }

        #[pvm_contract_sdk::method]
        pub fn get_user_at(&self, index: u64) -> Result<Address, Error> {
            if index >= self.user_count.get() {
                return Err(UserNotFound.into());
            }
            Ok(Address(self.users.get(&index)))
        }

        fn caller(&self) -> Address {
            let mut buf = [0u8; 20];
            self.host().caller(&mut buf);
            Address(buf)
        }
    }
}
