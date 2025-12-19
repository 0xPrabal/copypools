'use client';

import { useAccount, useChainId } from 'wagmi';
import { parseUnits } from 'viem';
import Link from 'next/link';
import { RefreshCw, Loader2, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import { usePositions } from '@/hooks/usePonderData';
import { useV4Compoundor } from '@/hooks/useV4Compoundor';
import { useNFTApproval } from '@/hooks/useNFTApproval';
import { getContracts } from '@/config/contracts';

export default function CompoundContent() {
  const { address } = useAccount();
  const chainId = useChainId();
  const CONTRACTS = getContracts(chainId);
  const { data: positions, isLoading } = usePositions();

  const {
    registerPosition,
    selfCompound,
    unregisterPosition,
    isPending,
    isConfirming,
    isSuccess,
    error,
  } = useV4Compoundor();

  // NFT approval hook - V4Compoundor needs to be approved as operator on PositionManager
  const {
    approveAll: approveNFT,
    isApprovedForAll: isNFTApproved,
    isPending: nftApprovalPending,
    isConfirming: nftApprovalConfirming,
    refetch: refetchNFTApproval,
  } = useNFTApproval(CONTRACTS.V4_COMPOUNDOR);

  const isAnyPending = isPending || nftApprovalPending;
  const isAnyConfirming = isConfirming || nftApprovalConfirming;

  // Filter positions with compound enabled and disabled
  const compoundEnabled = positions?.filter(p => p.compoundConfig?.enabled) || [];
  const compoundDisabled = positions?.filter(p => !p.compoundConfig?.enabled) || [];

  const handleEnableCompound = async (tokenId: string) => {
    await registerPosition({
      tokenId: BigInt(tokenId),
      config: {
        enabled: true,
        minCompoundInterval: 3600, // 1 hour
        minRewardAmount: parseUnits('0.001', 18),
      },
    });
  };

  const handleSelfCompound = async (tokenId: string) => {
    await selfCompound(BigInt(tokenId));
  };

  const handleDisableCompound = async (tokenId: string) => {
    await unregisterPosition(BigInt(tokenId));
  };

  if (!address) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Auto-Compound</h1>
          <p className="text-gray-400">
            Automatically compound your position fees to maximize returns
          </p>
        </div>
        <div className="card text-center py-12">
          <RefreshCw className="mx-auto mb-4 text-gray-600" size={48} />
          <p className="text-gray-400">Connect your wallet to manage auto-compound settings</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Auto-Compound</h1>
        <p className="text-gray-400">
          Automatically compound your position fees to maximize returns
        </p>
      </div>

      {/* NFT Approval Banner */}
      {!isNFTApproved && (
        <div className="card bg-yellow-500/10 border border-yellow-500/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="text-yellow-400" size={24} />
              <div>
                <p className="font-semibold text-yellow-400">NFT Approval Required</p>
                <p className="text-sm text-gray-400">
                  V4Compoundor needs permission to manage your positions. This is a one-time approval.
                </p>
              </div>
            </div>
            <button
              onClick={async () => {
                await approveNFT();
                refetchNFTApproval();
              }}
              disabled={isAnyPending || isAnyConfirming}
              className="btn-primary bg-yellow-500 hover:bg-yellow-600 whitespace-nowrap"
            >
              {nftApprovalPending || nftApprovalConfirming ? 'Approving...' : 'Approve V4Compoundor'}
            </button>
          </div>
        </div>
      )}

      {/* Transaction Status */}
      {(isAnyPending || isAnyConfirming || isSuccess || error) && (
        <div className={`p-4 rounded-lg ${
          error ? 'bg-red-500/10 border border-red-500/20' :
          isSuccess ? 'bg-green-500/10 border border-green-500/20' :
          'bg-blue-500/10 border border-blue-500/20'
        }`}>
          <div className="flex items-center gap-3">
            {isAnyPending && <Loader2 className="animate-spin text-blue-400" size={20} />}
            {isAnyConfirming && <Loader2 className="animate-spin text-blue-400" size={20} />}
            {isSuccess && <CheckCircle className="text-green-400" size={20} />}
            {error && <AlertCircle className="text-red-400" size={20} />}
            <span>
              {isAnyPending && 'Waiting for wallet confirmation...'}
              {isAnyConfirming && 'Transaction confirming...'}
              {isSuccess && 'Transaction successful!'}
              {error && `Error: ${error.message}`}
            </span>
          </div>
        </div>
      )}

      {/* Compound Enabled Positions */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <RefreshCw className="text-green-400" size={20} />
          <h2 className="text-lg font-semibold">Auto-Compound Enabled ({compoundEnabled.length})</h2>
        </div>

        {isLoading ? (
          <div className="text-center py-8">
            <Loader2 className="mx-auto animate-spin text-primary-500" size={32} />
          </div>
        ) : compoundEnabled.length > 0 ? (
          <div className="space-y-3">
            {compoundEnabled.map((position) => (
              <div key={position.id} className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="flex -space-x-2">
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-xs font-bold border-2 border-gray-900">
                      {position.pool.token0.symbol.slice(0, 2)}
                    </div>
                    <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center text-xs font-bold border-2 border-gray-900">
                      {position.pool.token1.symbol.slice(0, 2)}
                    </div>
                  </div>
                  <div>
                    <p className="font-medium">{position.pool.token0.symbol}/{position.pool.token1.symbol}</p>
                    <p className="text-sm text-gray-400">ID: #{position.tokenId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSelfCompound(position.tokenId)}
                    disabled={isAnyPending || isAnyConfirming || !isNFTApproved}
                    className="btn-primary text-sm px-3 py-1"
                  >
                    {!isNFTApproved ? 'Approve First' : 'Compound Now'}
                  </button>
                  <button
                    onClick={() => handleDisableCompound(position.tokenId)}
                    disabled={isAnyPending || isAnyConfirming || !isNFTApproved}
                    className="btn-secondary text-sm px-3 py-1"
                  >
                    Disable
                  </button>
                  <Link href={`/positions/${position.tokenId}`} className="p-2 text-gray-400 hover:text-white">
                    <ExternalLink size={16} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-400 text-center py-4">No positions with auto-compound enabled</p>
        )}
      </div>

      {/* Available Positions */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Available Positions ({compoundDisabled.length})</h2>

        {isLoading ? (
          <div className="text-center py-8">
            <Loader2 className="mx-auto animate-spin text-primary-500" size={32} />
          </div>
        ) : compoundDisabled.length > 0 ? (
          <div className="space-y-3">
            {compoundDisabled.map((position) => (
              <div key={position.id} className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="flex -space-x-2">
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-xs font-bold border-2 border-gray-900">
                      {position.pool.token0.symbol.slice(0, 2)}
                    </div>
                    <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center text-xs font-bold border-2 border-gray-900">
                      {position.pool.token1.symbol.slice(0, 2)}
                    </div>
                  </div>
                  <div>
                    <p className="font-medium">{position.pool.token0.symbol}/{position.pool.token1.symbol}</p>
                    <p className="text-sm text-gray-400">ID: #{position.tokenId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEnableCompound(position.tokenId)}
                    disabled={isAnyPending || isAnyConfirming || !isNFTApproved}
                    className="btn-primary text-sm px-3 py-1"
                  >
                    {!isNFTApproved ? 'Approve First' : 'Enable Auto-Compound'}
                  </button>
                  <Link href={`/positions/${position.tokenId}`} className="p-2 text-gray-400 hover:text-white">
                    <ExternalLink size={16} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-400 mb-4">No positions available</p>
            <Link href="/initiator" className="btn-primary">
              Create Your First Position
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
