#![no_main]
#![no_std]

use alloc::string::String;
use parity_scale_codec::{Decode, Encode};
use pvm::storage::Mapping;
use pvm_contract as pvm;

#[allow(unreachable_code)]
fn revert(msg: &[u8]) -> ! {
    pvm::api::return_value(pvm_contract::ReturnFlags::REVERT, msg);
    loop {}
}

#[derive(Default, Clone, Encode, Decode)]
pub struct PostData {
    pub description: String,
    pub photo_cid: String,
    pub timestamp: u64,
}

#[derive(pvm::SolAbi)]
pub struct Post {
    pub description: String,
    pub photo_cid: String,
    pub timestamp: u64,
}

#[pvm::storage]
struct Storage {
    post_counts: Mapping<[u8; 20], u64>,
    posts: Mapping<([u8; 20], u64), PostData>,
    user_count: u64,
    users: Mapping<u64, [u8; 20]>,
    user_registered: Mapping<[u8; 20], bool>,
}

#[pvm::contract(cdm = "@example/instagram")]
mod instagram {
    use super::*;

    #[pvm::constructor]
    pub fn new() -> Result<(), Error> {
        Storage::user_count().set(&0);
        Ok(())
    }

    #[pvm::method]
    pub fn create_post(description: String, photo_cid: String) -> u64 {
        let caller = *pvm::caller().as_fixed_bytes();

        if !Storage::user_registered().contains(&caller) {
            let count = Storage::user_count().get().unwrap_or(0);
            Storage::users().insert(&count, &caller);
            Storage::user_count().set(&(count + 1));
            Storage::user_registered().insert(&caller, &true);
        }

        let index = Storage::post_counts().get(&caller).unwrap_or(0);

        let mut buf = [0u8; 32];
        pvm::api::now(&mut buf);
        let timestamp = u64::from_le_bytes(buf[0..8].try_into().unwrap());

        let post = PostData { description, photo_cid, timestamp };
        Storage::posts().insert(&(caller, index), &post);
        Storage::post_counts().insert(&caller, &(index + 1));

        index
    }

    #[pvm::method]
    pub fn get_post_count(user: [u8; 20]) -> u64 {
        Storage::post_counts().get(&user).unwrap_or(0)
    }

    #[pvm::method]
    pub fn get_post(user: [u8; 20], index: u64) -> Post {
        match Storage::posts().get(&(user, index)) {
            Some(d) => Post {
                description: d.description,
                photo_cid: d.photo_cid,
                timestamp: d.timestamp,
            },
            None => revert(b"PostNotFound"),
        }
    }

    #[pvm::method]
    pub fn get_user_count() -> u64 {
        Storage::user_count().get().unwrap_or(0)
    }

    #[pvm::method]
    pub fn get_user_at(index: u64) -> [u8; 20] {
        match Storage::users().get(&index) {
            Some(addr) => addr,
            None => revert(b"UserNotFound"),
        }
    }
}
