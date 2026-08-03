#!/usr/bin/env bash
#
# Deploy RecehPool to Stellar Testnet with the Stellar CLI.
#
# Usage:
#   NETWORK=testnet ./scripts/deploy.sh
#
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
IDENTITY="${IDENTITY:-receh}"
WASM="target/wasm32v1-none/release/receh_pool.wasm"

cd "$(dirname "$0")/.."

echo "▶ Network: $NETWORK   Identity: $IDENTITY"

if ! stellar keys address "$IDENTITY" >/dev/null 2>&1; then
  echo "▶ Creating identity '$IDENTITY'…"
  if [ "$NETWORK" = "testnet" ]; then
    stellar keys generate "$IDENTITY" --network testnet --fund
  else
    stellar keys generate "$IDENTITY"
    echo "  Fund $(stellar keys address "$IDENTITY") on mainnet, then re-run."
    exit 1
  fi
fi

ADMIN_ADDR="$(stellar keys address "$IDENTITY")"
echo "▶ Admin/Deployer address: $ADMIN_ADDR"

echo "▶ Building contract…"
stellar contract build
stellar contract optimize --wasm "$WASM" || true

echo "▶ Deploying…"
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM" \
  --source "$IDENTITY" \
  --network "$NETWORK")
echo "▶ Contract id: $CONTRACT_ID"

USDC_ISSUER="${USDC_ASSET_ISSUER_TESTNET:-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5}"
echo "▶ Resolving USDC SAC for USDC:$USDC_ISSUER on $NETWORK…"
USDC_SAC=$(stellar contract id asset --asset "USDC:$USDC_ISSUER" --network "$NETWORK")
stellar contract asset deploy --asset "USDC:$USDC_ISSUER" --source "$IDENTITY" --network "$NETWORK" 2>/dev/null || true

VAULT_ADDR="${VAULT_ADDRESS:-$ADMIN_ADDR}"

echo "▶ Writing deployment to .stellar/deploy.json…"
mkdir -p .stellar
cat > .stellar/deploy.json <<EOF
{
  "network": "$NETWORK",
  "identity": "$IDENTITY",
  "admin": "$ADMIN_ADDR",
  "vault": "$VAULT_ADDR",
  "usdcIssuer": "$USDC_ISSUER",
  "usdcSac": "$USDC_SAC",
  "contractId": "$CONTRACT_ID",
  "wasm": "$WASM",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo ""
echo "✅ Deployed RecehPool."
echo "   Contract ID : $CONTRACT_ID"
echo "   USDC SAC    : $USDC_SAC"
echo "   Network     : $NETWORK"
echo ""
echo "Next: ./scripts/init.sh"
