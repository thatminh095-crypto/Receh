use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ProposalStatus {
    Active = 0,
    Approved = 1,
    Disbursed = 2,
    Rejected = 3,
}

#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub proposer: Address,
    pub recipient: Address,
    pub amount: i128,
    pub title_hash: soroban_sdk::BytesN<32>,
    pub votes_yes: u32,
    pub votes_no: u32,
    pub weight_yes: i128,
    pub weight_no: i128,
    pub status: ProposalStatus,
    pub disbursed_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct Contribution {
    pub contributor: Address,
    pub muxed_id: u64,
    pub total: i128,
    pub count: u32,
}
