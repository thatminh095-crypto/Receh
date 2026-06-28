#![cfg(test)]

use crate::error::Error;
use crate::types::ProposalStatus;
use crate::{RecehPool, RecehPoolClient};

use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{Address, BytesN, Env};

struct Setup<'a> {
    env: Env,
    client: RecehPoolClient<'a>,
    token_client: TokenClient<'a>,
    sac: StellarAssetClient<'a>,
    admin: Address,
    vault: Address,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let vault = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();

    let contract_id = env.register(RecehPool, ());
    let client = RecehPoolClient::new(&env, &contract_id);
    client.initialize(&admin, &vault, &token);

    Setup {
        token_client: TokenClient::new(&env, &token),
        sac: StellarAssetClient::new(&env, &token),
        env,
        client,
        admin,
        vault,
    }
}

fn member(s: &Setup, balance: i128) -> Address {
    let m = Address::generate(&s.env);
    s.sac.mint(&m, &balance);
    m
}

fn title_hash(s: &Setup, label: &str) -> BytesN<32> {
    let env = &s.env;
    let mut buf = [0u8; 32];
    let bytes = label.as_bytes();
    for (i, b) in bytes.iter().enumerate() {
        if i >= 32 {
            break;
        }
        buf[i] = *b;
    }
    BytesN::from_array(env, &buf)
}

#[test]
fn initialize_records_admin_vault_and_token() {
    let s = setup();
    assert_eq!(s.client.get_admin(), s.admin);
    assert_eq!(s.client.get_vault_address(), s.vault);
    assert_eq!(s.client.get_token(), s.sac.address);
    assert_eq!(s.client.get_member_count(), 0);
    assert_eq!(s.client.get_total_pool(), 0);
    assert!(!s.client.is_paused());
}

#[test]
fn double_initialize_fails() {
    let s = setup();
    let res = s.client.try_initialize(&s.admin, &s.vault, &s.sac.address);
    assert_eq!(res, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn record_roundup_tracks_contributor_and_pool() {
    let s = setup();
    let a = member(&s, 5_000);
    let b = member(&s, 5_000);

    assert_eq!(s.client.record_roundup(&a, &1u64, &1_000i128), 1_000);
    assert_eq!(s.client.record_roundup(&a, &1u64, &500i128), 1_500);
    assert_eq!(s.client.record_roundup(&b, &2u64, &700i128), 700);

    let (total_a, count_a, mux_a) = s.client.get_contribution(&a);
    assert_eq!(total_a, 1_500);
    assert_eq!(count_a, 2);
    assert_eq!(mux_a, 1);

    let (total_b, count_b, mux_b) = s.client.get_contribution(&b);
    assert_eq!(total_b, 700);
    assert_eq!(count_b, 1);
    assert_eq!(mux_b, 2);

    assert_eq!(s.client.get_member_count(), 2);
    assert_eq!(s.client.get_total_pool(), 2_200);
    assert_eq!(s.client.get_available(), 2_200);
}

#[test]
fn record_roundup_zero_fails() {
    let s = setup();
    let a = member(&s, 1_000);
    assert_eq!(
        s.client.try_record_roundup(&a, &1u64, &0i128),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn create_grant_starts_active_and_increments_counter() {
    let s = setup();
    let a = member(&s, 1_000);
    let recipient = Address::generate(&s.env);
    let h = title_hash(&s, "Solar lamps");
    let id = s.client.create_grant(&a, &recipient, &500i128, &h);
    assert_eq!(id, 1);
    let p = s.client.get_proposal(&id);
    assert_eq!(p.status, ProposalStatus::Active);
    assert_eq!(p.amount, 500);
    assert_eq!(s.client.get_proposal_count(), 1);
}

#[test]
fn vote_tally_with_weighted_majority_marks_approved() {
    let s = setup();
    let a = member(&s, 5_000);
    let b = member(&s, 5_000);
    s.client.record_roundup(&a, &1u64, &3_000i128);
    s.client.record_roundup(&b, &2u64, &1_000i128);

    let recipient = Address::generate(&s.env);
    let h = title_hash(&s, "Mangrove");
    let id = s.client.create_grant(&a, &recipient, &500i128, &h);

    assert_eq!(s.client.vote(&a, &id, &true), ProposalStatus::Approved);
    let p = s.client.get_proposal(&id);
    assert_eq!(p.votes_yes, 1);
    assert_eq!(p.weight_yes, 3_000);
    assert_eq!(p.status, ProposalStatus::Approved);

    assert_eq!(s.client.vote(&b, &id, &false), ProposalStatus::Approved);
    let (yes, no) = s.client.get_vote_count(&id);
    assert_eq!(yes, 1);
    assert_eq!(no, 1);
}

#[test]
fn double_vote_is_rejected() {
    let s = setup();
    let a = member(&s, 5_000);
    s.client.record_roundup(&a, &1u64, &1_000i128);

    let recipient = Address::generate(&s.env);
    let h = title_hash(&s, "School");
    let id = s.client.create_grant(&a, &recipient, &100i128, &h);

    s.client.vote(&a, &id, &true);
    assert_eq!(
        s.client.try_vote(&a, &id, &true),
        Err(Ok(Error::AlreadyVoted))
    );
}

#[test]
fn disburse_grant_pays_recipient_from_contract() {
    let s = setup();
    s.env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);

    let a = member(&s, 5_000);
    s.client.record_roundup(&a, &1u64, &2_000i128);

    let recipient = Address::generate(&s.env);
    let h = title_hash(&s, "Disburse test");
    let id = s.client.create_grant(&a, &recipient, &500i128, &h);
    s.client.vote(&a, &id, &true);

    assert_eq!(s.client.disburse_grant(&id), 500);
    assert_eq!(s.token_client.balance(&recipient), 500);
    assert_eq!(s.client.get_total_disbursed(), 500);
    assert_eq!(s.client.get_available(), 1_500);
    assert!(s.client.get_disbursed(&id));

    let p = s.client.get_proposal(&id);
    assert_eq!(p.status, ProposalStatus::Disbursed);
    assert!(p.disbursed_at >= 1_700_000_000);
}

#[test]
fn double_disburse_is_rejected() {
    let s = setup();
    let a = member(&s, 5_000);
    s.client.record_roundup(&a, &1u64, &2_000i128);

    let recipient = Address::generate(&s.env);
    let h = title_hash(&s, "double disburse");
    let id = s.client.create_grant(&a, &recipient, &300i128, &h);
    s.client.vote(&a, &id, &true);
    s.client.disburse_grant(&id);
    assert_eq!(
        s.client.try_disburse_grant(&id),
        Err(Ok(Error::AlreadyDisbursed))
    );
}

#[test]
fn disburse_without_majority_fails() {
    let s = setup();
    let a = member(&s, 5_000);
    let b = member(&s, 5_000);
    s.client.record_roundup(&a, &1u64, &1_000i128);
    s.client.record_roundup(&b, &2u64, &1_000i128);

    let recipient = Address::generate(&s.env);
    let h = title_hash(&s, "no majority");
    let id = s.client.create_grant(&a, &recipient, &300i128, &h);

    s.client.vote(&b, &id, &false);
    assert_eq!(s.client.try_disburse_grant(&id), Err(Ok(Error::NotApproved)));
}

#[test]
fn pause_blocks_writes() {
    let s = setup();
    let a = member(&s, 5_000);
    s.client.pause();
    assert_eq!(
        s.client.try_record_roundup(&a, &1u64, &100i128),
        Err(Ok(Error::Paused))
    );
    s.client.unpause();
    assert_eq!(s.client.record_roundup(&a, &1u64, &100i128), 100);
}

#[test]
fn vote_on_missing_proposal_fails() {
    let s = setup();
    let a = member(&s, 5_000);
    s.client.record_roundup(&a, &1u64, &1_000i128);
    assert_eq!(
        s.client.try_vote(&a, &999, &true),
        Err(Ok(Error::ProposalNotFound))
    );
}
