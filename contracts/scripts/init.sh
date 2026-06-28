#!/usr/bin/env bash
#
# Initialize the deployed RecehPool with admin / vault / USDC SAC addresses.
# Reads the contract id from .stellar/deploy.json (produced by deploy.sh).
#
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .stellar/deploy.json ]; then
  echo "Missing .stellar/deploy.json — run scripts/deploy.sh first."
  exit 1
fi

NETWORK="$(grep -oE '"network": *"[^"]+"' .stellar/deploy.json | sed 's/.*: *"//;s/"//')"
IDENTITY="$(grep -oE '"identity": *"[^"]+"' .stellar/deploy.json | sed 's/.*: *"//;s/"//')"
ADMIN="$(grep -oE '"admin": *"[^"]+"' .stellar/deploy.json | sed 's/.*: *"//;s/"//')"
VAULT="$(grep -oE '"vault": *"[^"]+"' .stellar/deploy.json | sed 's/.*: *"//;s/"//')"
USDC_SAC="$(grep -oE '"usdcSac": *"[^"]+"' .stellar/deploy.json | sed 's/.*: *"//;s/"//')"
CONTRACT_ID="$(grep -oE '"contractId": *"[^"]+"' .stellar/deploy.json | sed 's/.*: *"//;s/"//')"

echo "▶ Initializing contract $CONTRACT_ID"
echo "   admin:  $ADMIN"
echo "   vault:  $VAULT"
echo "   token:  $USDC_SAC"

INIT_TX=$(stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$IDENTITY" \
  --network "$NETWORK" \
  -- \
  initialize \
  --admin "$ADMIN" \
  --vault "$VAULT" \
  --token "$USDC_SAC")

echo "▶ init tx: $INIT_TX"

python3 - <<PY
import json, pathlib
p = pathlib.Path('.stellar/deploy.json')
data = json.loads(p.read_text())
data['initTx'] = "$INIT_TX"
p.write_text(json.dumps(data, indent=2))
PY

echo ""
echo "✅ Initialized."
echo "   Contract ID : $CONTRACT_ID"
echo "   Init tx     : $INIT_TX"
echo ""
echo "Add to your app .env:"
echo "   RECEH_POOL_CONTRACT_ID=$CONTRACT_ID"
echo "   USDC_SAC_CONTRACT_ID=$USDC_SAC"
echo "   SOROBAN_RPC_URL=https://soroban-${NETWORK}.stellar.org"
