use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Vault,
    Token,
    Paused,
    MemberCount,
    TotalContributed,
    TotalDisbursed,
    ProposalCounter,
    Contribution(Address),
    Proposal(u64),
    Voted(u64, Address),
}

pub const DAY_IN_LEDGERS: u32 = 17_280;

pub const INSTANCE_BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = INSTANCE_BUMP_AMOUNT - DAY_IN_LEDGERS;

pub const ENTRY_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;
pub const ENTRY_LIFETIME_THRESHOLD: u32 = ENTRY_BUMP_AMOUNT - DAY_IN_LEDGERS;
