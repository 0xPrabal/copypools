/**
 * Example: How to mint a new position with SlippageCheck integration
 * ✅ UPDATED for amount0Max/amount1Max parameters
 */

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useV4Utils } from '../hooks/useV4Utils';
import { SLIPPAGE_PRESETS } from '../lib/slippage';
import { parseUnits } from 'viem';

export function MintPositionExample() {
  const { address } = useAccount();
  const { mintPosition, isPending, isConfirming, isSuccess } = useV4Utils();
  const [slippage, setSlippage] = useState<number>(SLIPPAGE_PRESETS.MEDIUM); // 1%

  const handleMintPosition = async () => {
    if (!address) return;

    // Amounts to deposit
    const amount0Desired = parseUnits('0.1', 18); // 0.1 WETH
    const amount1Desired = parseUnits('100', 6); // 100 USDC

    // Calculate max amounts with slippage
    const slippageMultiplier = BigInt(10000 + slippage);
    const amount0Max = (amount0Desired * slippageMultiplier) / BigInt(10000);
    const amount1Max = (amount1Desired * slippageMultiplier) / BigInt(10000);

    try {
      await mintPosition({
        currency0: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9', // WETH on Sepolia
        currency1: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // USDC on Sepolia
        fee: 3000, // 0.3%
        tickLower: -887220, // Example tick range
        tickUpper: 887220,
        amount0Desired,
        amount1Desired,
        amount0Max,
        amount1Max,
        recipient: address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour from now
      });
    } catch (error) {
      console.error('Error minting position:', error);
    }
  };

  return (
    <div className="space-y-4">
      <h2>Mint New Position (with SlippageCheck)</h2>

      <div>
        <label>Slippage Tolerance:</label>
        <select value={slippage} onChange={(e) => setSlippage(Number(e.target.value))}>
          <option value={SLIPPAGE_PRESETS.VERY_LOW}>0.1% (Very Low)</option>
          <option value={SLIPPAGE_PRESETS.LOW}>0.5% (Low)</option>
          <option value={SLIPPAGE_PRESETS.MEDIUM}>1% (Recommended)</option>
          <option value={SLIPPAGE_PRESETS.HIGH}>3% (High)</option>
        </select>
      </div>

      <button
        onClick={handleMintPosition}
        disabled={!address || isPending || isConfirming}
      >
        {isPending ? 'Confirming...' : isConfirming ? 'Processing...' : 'Mint Position'}
      </button>

      {isSuccess && <p>Position minted successfully!</p>}
    </div>
  );
}
