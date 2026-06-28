#![no_std]

mod error;
mod storage;
mod types;

#[cfg(test)]
mod test;

use error::Error;
use storage::{
    DataKey, ENTRY_BUMP_AMOUNT, ENTRY_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT,
    INSTANCE_LIFETIME_THRESHOLD,
};
use types::{Contribution, Proposal, ProposalStatus};

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, BytesN, Env};

#[contract]
pub struct RecehPool;

#[contractimpl]
impl RecehPool {
    pub fn initialize(
        env: Env,
        admin: Address,
        vault: Address,
        token: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        let i = env.storage().instance();
        i.set(&DataKey::Admin, &admin);
        i.set(&DataKey::Vault, &vault);
        i.set(&DataKey::Token, &token);
        i.set(&DataKey::Paused, &false);
        i.set(&DataKey::MemberCount, &0u32);
        i.set(&DataKey::TotalContributed, &0i128);
        i.set(&DataKey::TotalDisbursed, &0i128);
        i.set(&DataKey::ProposalCounter, &0u64);
        bump_instance(&env);
        env.events().publish((symbol_short!("init"),), (admin, vault, token));
        Ok(())
    }

    pub fn record_roundup(
        env: Env,
        contributor: Address,
        muxed_id: u64,
        amount: i128,
    ) -> Result<i128, Error> {
        contributor.require_auth();
        require_not_paused(&env)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let token = get_token(&env)?;
        token::Client::new(&env, &token).transfer(
            &contributor,
            &env.current_contract_address(),
            &amount,
        );

        let key = DataKey::Contribution(contributor.clone());
        let prev: Contribution = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Contribution {
                contributor: contributor.clone(),
                muxed_id,
                total: 0,
                count: 0,
            });

        let next = Contribution {
            contributor: contributor.clone(),
            muxed_id,
            total: prev.total + amount,
            count: prev.count + 1,
        };

        if prev.count == 0 {
            let count: u32 = instance_u32(&env, &DataKey::MemberCount);
            env.storage()
                .instance()
                .set(&DataKey::MemberCount, &(count + 1));
        }

        env.storage().persistent().set(&key, &next);
        bump_entry(&env, &key);

        let total: i128 = instance_i128(&env, &DataKey::TotalContributed);
        env.storage()
            .instance()
            .set(&DataKey::TotalContributed, &(total + amount));
        bump_instance(&env);

        env.events()
            .publish((symbol_short!("roundup"),), (contributor, muxed_id, amount));
        Ok(next.total)
    }

    pub fn create_grant(
        env: Env,
        proposer: Address,
        recipient: Address,
        amount: i128,
        title_hash: BytesN<32>,
    ) -> Result<u64, Error> {
        proposer.require_auth();
        require_not_paused(&env)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let id = next_proposal_id(&env);
        let proposal = Proposal {
            proposer,
            recipient,
            amount,
            title_hash,
            votes_yes: 0,
            votes_no: 0,
            weight_yes: 0,
            weight_no: 0,
            status: ProposalStatus::Active,
            disbursed_at: 0,
        };
        save_proposal(&env, id, &proposal);
        bump_instance(&env);

        env.events()
            .publish((symbol_short!("grant"), id), (proposal.recipient, amount));
        Ok(id)
    }

    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        in_favor: bool,
    ) -> Result<ProposalStatus, Error> {
        voter.require_auth();
        require_not_paused(&env)?;

        let mut proposal = load_proposal(&env, proposal_id)?;
        if proposal.status == ProposalStatus::Disbursed
            || proposal.status == ProposalStatus::Rejected
        {
            return Err(Error::ProposalNotActive);
        }

        let voted_key = DataKey::Voted(proposal_id, voter.clone());
        if env.storage().persistent().has(&voted_key) {
            return Err(Error::AlreadyVoted);
        }

        let weight = contributor_weight(&env, &voter);
        if weight <= 0 {
            return Err(Error::NotAuthorized);
        }

        env.storage().persistent().set(&voted_key, &true);
        bump_entry(&env, &voted_key);

        if in_favor {
            proposal.votes_yes += 1;
            proposal.weight_yes += weight;
        } else {
            proposal.votes_no += 1;
            proposal.weight_no += weight;
        }

        if proposal.weight_yes * 2 > proposal.weight_yes + proposal.weight_no
            && proposal.weight_yes > proposal.weight_no
        {
            proposal.status = ProposalStatus::Approved;
        }

        save_proposal(&env, proposal_id, &proposal);
        bump_instance(&env);

        env.events().publish(
            (symbol_short!("vote"), proposal_id),
            (voter, in_favor, weight, proposal.status),
        );
        Ok(proposal.status)
    }

    pub fn disburse_grant(env: Env, proposal_id: u64) -> Result<i128, Error> {
        require_not_paused(&env)?;

        let mut proposal = load_proposal(&env, proposal_id)?;
        if proposal.status == ProposalStatus::Disbursed {
            return Err(Error::AlreadyDisbursed);
        }
        if proposal.status != ProposalStatus::Approved && proposal.status != ProposalStatus::Active
        {
            return Err(Error::NotApproved);
        }
        if proposal.status == ProposalStatus::Active {
            let total_weight = proposal.weight_yes + proposal.weight_no;
            if total_weight <= 0 || proposal.weight_yes * 2 <= total_weight {
                return Err(Error::NotApproved);
            }
            proposal.status = ProposalStatus::Approved;
        }

        if available(&env) < proposal.amount {
            return Err(Error::InsufficientFunds);
        }

        let token = get_token(&env)?;
        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &proposal.recipient,
            &proposal.amount,
        );

        proposal.status = ProposalStatus::Disbursed;
        proposal.disbursed_at = env.ledger().timestamp();
        save_proposal(&env, proposal_id, &proposal);

        let released: i128 = instance_i128(&env, &DataKey::TotalDisbursed);
        env.storage()
            .instance()
            .set(&DataKey::TotalDisbursed, &(released + proposal.amount));
        bump_instance(&env);

        env.events()
            .publish((symbol_short!("disburse"), proposal_id), proposal.amount);
        Ok(proposal.amount)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        admin(&env)
    }

    pub fn get_vault_address(env: Env) -> Result<Address, Error> {
        get_vault(&env)
    }

    pub fn get_token(env: Env) -> Result<Address, Error> {
        get_token(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn get_total_pool(env: Env) -> i128 {
        instance_i128(&env, &DataKey::TotalContributed)
    }

    pub fn get_total_disbursed(env: Env) -> i128 {
        instance_i128(&env, &DataKey::TotalDisbursed)
    }

    pub fn get_available(env: Env) -> i128 {
        available(&env)
    }

    pub fn get_member_count(env: Env) -> u32 {
        instance_u32(&env, &DataKey::MemberCount)
    }

    pub fn get_proposal_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::ProposalCounter)
            .unwrap_or(0u64)
    }

    pub fn get_contribution(env: Env, contributor: Address) -> (i128, u32, u64) {
        match env
            .storage()
            .persistent()
            .get::<DataKey, Contribution>(&DataKey::Contribution(contributor))
        {
            Some(c) => (c.total, c.count, c.muxed_id),
            None => (0, 0, 0),
        }
    }

    pub fn get_contribution_detail(env: Env, contributor: Address) -> Option<Contribution> {
        env.storage()
            .persistent()
            .get(&DataKey::Contribution(contributor))
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, Error> {
        load_proposal(&env, proposal_id)
    }

    pub fn get_vote_count(env: Env, proposal_id: u64) -> (u32, u32) {
        match load_proposal(&env, proposal_id) {
            Ok(p) => (p.votes_yes, p.votes_no),
            Err(_) => (0, 0),
        }
    }

    pub fn get_disbursed(env: Env, proposal_id: u64) -> bool {
        match load_proposal(&env, proposal_id) {
            Ok(p) => p.status == ProposalStatus::Disbursed,
            Err(_) => false,
        }
    }

    pub fn pause(env: Env) -> Result<(), Error> {
        admin(&env)?.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        bump_instance(&env);
        env.events().publish((symbol_short!("pause"),), true);
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), Error> {
        admin(&env)?.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        bump_instance(&env);
        env.events().publish((symbol_short!("pause"),), false);
        Ok(())
    }
}

fn admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

fn get_vault(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Vault)
        .ok_or(Error::NotInitialized)
}

fn get_token(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .ok_or(Error::NotInitialized)
}

fn require_not_paused(env: &Env) -> Result<(), Error> {
    let paused: bool = env
        .storage()
        .instance()
        .get(&DataKey::Paused)
        .ok_or(Error::NotInitialized)?;
    if paused {
        return Err(Error::Paused);
    }
    Ok(())
}

fn instance_u32(env: &Env, key: &DataKey) -> u32 {
    env.storage().instance().get(key).unwrap_or(0u32)
}

fn instance_i128(env: &Env, key: &DataKey) -> i128 {
    env.storage().instance().get(key).unwrap_or(0i128)
}

fn available(env: &Env) -> i128 {
    instance_i128(env, &DataKey::TotalContributed) - instance_i128(env, &DataKey::TotalDisbursed)
}

fn contributor_weight(env: &Env, contributor: &Address) -> i128 {
    env.storage()
        .persistent()
        .get::<DataKey, Contribution>(&DataKey::Contribution(contributor.clone()))
        .map(|c| c.total)
        .unwrap_or(0)
}

fn next_proposal_id(env: &Env) -> u64 {
    let current: u64 = env
        .storage()
        .instance()
        .get(&DataKey::ProposalCounter)
        .unwrap_or(0u64);
    let id = current + 1;
    env.storage().instance().set(&DataKey::ProposalCounter, &id);
    id
}

fn load_proposal(env: &Env, id: u64) -> Result<Proposal, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Proposal(id))
        .ok_or(Error::ProposalNotFound)
}

fn save_proposal(env: &Env, id: u64, proposal: &Proposal) {
    let key = DataKey::Proposal(id);
    env.storage().persistent().set(&key, proposal);
    bump_entry(env, &key);
}

fn bump_entry(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, ENTRY_LIFETIME_THRESHOLD, ENTRY_BUMP_AMOUNT);
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}
