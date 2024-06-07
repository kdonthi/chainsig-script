use std::collections::HashMap;
// Find all our documentation at https://docs.near.org
use hex::decode;
use near_sdk::{env, ext_contract, near, require, Gas, NearToken, Promise, AccountId};

const MPC_CONTRACT_ACCOUNT_ID: &str = "v2.multichain-mpc.testnet";
const MINUTE: u64 = 60 * 1_000_000_000;

// interface for cross contract call to mpc contract
#[ext_contract(mpc)]
trait MPC {
    fn sign(&self, payload: [u8; 32], path: String, key_version: u32) -> Promise;
}

// automatically init the contract
impl Default for Contract {
    fn default() -> Self {
        Self {
            users_to_time: HashMap::new()
        }
    }
}

#[near(contract_state)]
pub struct Contract {
    users_to_time: HashMap<AccountId, u64>
}

#[near]
impl Contract {
    // proxy to call MPC_CONTRACT_ACCOUNT_ID method sign if COST is deposited
    #[payable]
    pub fn sign(&mut self, rlp_payload: String, path: String, key_version: u32) -> Promise {
        let sender = env::predecessor_account_id();
        let result = self.users_to_time.get(&sender);

        match result {
            None => {}
            Some(ts) => {
                let current_time_rewinded_minute = env::block_timestamp() - MINUTE;
                require!(ts < &current_time_rewinded_minute, "Cannot make more than one call per minute");
            }
        }

        self.users_to_time.insert(sender.clone(), env::block_timestamp());

        // hash and reverse rlp encoded payload
        let payload: [u8; 32] = env::keccak256_array(&decode(rlp_payload).unwrap())
            .into_iter()
            .rev()
            .collect::<Vec<u8>>()
            .try_into()
            .unwrap();


        // call mpc sign and return promise
        mpc::ext(MPC_CONTRACT_ACCOUNT_ID.parse().unwrap())
            .with_static_gas(Gas::from_tgas(100))
            .sign(payload, path, key_version)
    }
}
