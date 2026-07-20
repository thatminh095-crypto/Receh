DEPLOYMENT
==========

Contract: RecehPool
Network: Test SDF Network ; September 2015 (Stellar testnet)

LIVE DEPLOYED VALUES
--------------------

Contract id: CDNZX5D3WXVXMCBFZYCEB5SSRM5VHB2UZ55PKH55KSSOIJKCAACK6KUW
WASM hash: 1734ecec913837d70a534217b3fb46c606defb0a2c6935922f37e2f7afffbb7a
WASM size: 21222 bytes (optimized)
WASM upload tx: 3bd1ff9df7a65ee76fdcf93d93c34bf72b7ca78e5ff04647ff040db7096fe981
Contract deploy tx: debb90d22f4305f1a69eeada51f8e81a9f31314a4af86fd277ed83b3f76cb0a0
Initialize tx: d83626adf97e4227e5c45e48733bca17a1f2872da6a78261b07e4cdc962277f1
Admin / vault signer: GBL5RJKF4QNJ4ZPLJZ7PS7K5A4J44VEZJRV2CRTFFDRVSY2N76AIIE47
USDC SAC on testnet: CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA

Verify on stellar.expert:
https://stellar.expert/explorer/testnet/contract/CDNZX5D3WXVXMCBFZYCEB5SSRM5VHB2UZ55PKH55KSSOIJKCAACK6KUW
https://stellar.expert/explorer/testnet/tx/d83626adf97e4227e5c45e48733bca17a1f2872da6a78261b07e4cdc962277f1

STEPS TO REDEPLOY
-----------------

1. Install Rust + wasm32-unknown-unknown target + Stellar CLI.

   curl https://sh.rustup.rs -sSf | sh
   rustup target add wasm32-unknown-unknown
   cargo install --locked stellar-cli

2. Provision an identity with a funded testnet account.

   stellar keys generate deployer --network testnet --fund

3. Build and optimize the wasm.

   cd contracts/receh-pool
   cargo build --release --target wasm32-unknown-unknown
   stellar contract optimize \
     --wasm ../../target/wasm32-unknown-unknown/release/receh_pool.wasm

4. Deploy.

   stellar contract deploy \
     --wasm ../../target/wasm32-unknown-unknown/release/receh_pool.optimized.wasm \
     --source deployer --network testnet

5. Initialize with admin, vault, USDC SAC.

   stellar contract invoke --id <CONTRACT_ID> --source deployer --network testnet -- \
     initialize \
     --admin <ADMIN> --vault <VAULT> \
     --token <USDC_SAC>

6. Wire the frontend env vars.

   RECEH_POOL_CONTRACT_ID=<CONTRACT_ID>
   USDC_SAC_CONTRACT_ID=<USDC_SAC>

   Redeploy the Next.js app (Vercel) so the new env vars take effect.

CONTRACT ENTRY POINTS
---------------------

1. initialize(admin, vault, token)
2. record_roundup(contributor, muxed_id, amount)
3. create_grant(proposer, recipient, amount, title_hash) -> u64
4. vote(voter, proposal_id, in_favor) -> ProposalStatus
5. disburse_grant(proposal_id) -> i128
6. get_total_pool() -> i128
7. get_available() -> i128
8. get_contribution(contributor) -> (i128, u32, u64)
9. get_proposal(id) -> Proposal
10. get_vote_count(id) -> (u32, u32)
11. get_disbursed(id) -> bool
12. pause() / unpause() (admin only)
13. get_admin() / get_vault_address() / get_token() / is_paused()

SCRIPTS
-------

scripts/deploy.sh — builds wasm, deploys contract, writes .stellar/deploy.json
scripts/init.sh   — reads .stellar/deploy.json, invokes initialize, records init tx