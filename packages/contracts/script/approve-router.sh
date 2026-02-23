#!/bin/bash

# Approve KyberSwap Router on all CopyPools contracts
# Usage: PRIVATE_KEY=0x... ./script/approve-router.sh

set -e

# Contract proxy addresses on Base Mainnet
V4_UTILS="0x8d81Bb4daA4c8D6ad99a741d1E7C9563EAFda423"
V4_COMPOUNDOR="0x2056eDc7590B42b5464f357589810fA3441216E3"
V4_AUTO_RANGE="0xB6E684266259d172a8CC85F524ab2E845886242b"
V4_AUTO_EXIT="0xb9ab855339036df10790728A773dD3a8c9e538B0"

# KyberSwap Meta Aggregation Router V2 on Base
KYBERSWAP_ROUTER="0x6131B5fae19EA4f9D964eAc0408E4408b66337b5"

RPC_URL="${RPC_URL:-https://mainnet.base.org}"

echo "=========================================="
echo "KyberSwap Router Approval Script"
echo "=========================================="
echo ""
echo "KyberSwap Router: $KYBERSWAP_ROUTER"
echo "RPC URL: $RPC_URL"
echo ""

CONTRACTS=("$V4_UTILS" "$V4_COMPOUNDOR" "$V4_AUTO_RANGE" "$V4_AUTO_EXIT")
NAMES=("V4Utils" "V4Compoundor" "V4AutoRange" "V4AutoExit")

# Prompt for private key if not set
if [ -z "$PRIVATE_KEY" ]; then
    echo "Enter your private key (owner wallet):"
    read -s PRIVATE_KEY
    echo ""
fi

for i in "${!CONTRACTS[@]}"; do
    CONTRACT="${CONTRACTS[$i]}"
    NAME="${NAMES[$i]}"

    echo "--- $NAME ($CONTRACT) ---"

    # Check owner
    OWNER=$(cast call "$CONTRACT" "owner()(address)" --rpc-url "$RPC_URL")
    echo "  Owner: $OWNER"

    # Check current approval
    IS_APPROVED=$(cast call "$CONTRACT" "approvedRouters(address)(bool)" "$KYBERSWAP_ROUTER" --rpc-url "$RPC_URL")
    echo "  Currently approved: $IS_APPROVED"

    if [ "$IS_APPROVED" = "true" ]; then
        echo "  -> Already approved, skipping"
    else
        echo "  -> Approving..."
        cast send "$CONTRACT" \
            "setRouterApproval(address,bool)" \
            "$KYBERSWAP_ROUTER" \
            true \
            --rpc-url "$RPC_URL" \
            --private-key "$PRIVATE_KEY"
        echo "  -> Transaction sent!"
    fi
    echo ""
done

# Wait for confirmations
echo "Waiting for confirmations..."
sleep 5

# Verify
echo ""
echo "=== Verification ==="
for i in "${!CONTRACTS[@]}"; do
    CONTRACT="${CONTRACTS[$i]}"
    NAME="${NAMES[$i]}"
    IS_APPROVED=$(cast call "$CONTRACT" "approvedRouters(address)(bool)" "$KYBERSWAP_ROUTER" --rpc-url "$RPC_URL")
    echo "$NAME: approved=$IS_APPROVED"
done

echo ""
echo "Done! One-Click Zap should now work."
