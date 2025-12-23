#!/bin/bash

# Approve 0x Router on V4Utils Contract
# Run this script with your private key

set -e

# Contract addresses
V4_UTILS="0x37A199B0Baea8943AD493f04Cc2da8c4fa7C2cE1"
ZEROX_ROUTER="0xDef1C0ded9bec7F1a1670819833240f027b25EfF"
RPC_URL="https://mainnet.base.org"

echo "=========================================="
echo "V4Utils Router Approval Script"
echo "=========================================="
echo ""
echo "V4Utils Contract: $V4_UTILS"
echo "0x Exchange Proxy: $ZEROX_ROUTER"
echo ""

# Check current owner
echo "Checking contract owner..."
OWNER=$(cast call $V4_UTILS "owner()(address)" --rpc-url $RPC_URL)
echo "Contract Owner: $OWNER"
echo ""

# Check if router is already approved
echo "Checking current router approval status..."
IS_APPROVED=$(cast call $V4_UTILS "approvedRouters(address)(bool)" $ZEROX_ROUTER --rpc-url $RPC_URL)
echo "Router currently approved: $IS_APPROVED"
echo ""

if [ "$IS_APPROVED" = "true" ]; then
    echo "Router is already approved! No action needed."
    exit 0
fi

# Prompt for private key if not set
if [ -z "$PRIVATE_KEY" ]; then
    echo "Enter your private key (owner wallet):"
    read -s PRIVATE_KEY
    echo ""
fi

echo "Approving router..."
echo ""

# Send the transaction
cast send $V4_UTILS \
    "setRouterApproval(address,bool)" \
    $ZEROX_ROUTER \
    true \
    --rpc-url $RPC_URL \
    --private-key $PRIVATE_KEY

echo ""
echo "Transaction sent! Verifying..."
echo ""

# Wait a bit for confirmation
sleep 3

# Verify
IS_APPROVED_NOW=$(cast call $V4_UTILS "approvedRouters(address)(bool)" $ZEROX_ROUTER --rpc-url $RPC_URL)
echo "Router now approved: $IS_APPROVED_NOW"
echo ""

if [ "$IS_APPROVED_NOW" = "true" ]; then
    echo "SUCCESS! Router has been approved."
    echo "One-Click Zap feature is now enabled!"
else
    echo "WARNING: Router approval may not have been confirmed yet."
    echo "Please check the transaction on Basescan."
fi
