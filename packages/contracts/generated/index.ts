// Contract ABIs and addresses export
import V4UtilsABI from './V4Utils.json' with { type: 'json' };
import V4CompoundorABI from './V4Compoundor.json' with { type: 'json' };
import V4AutoRangeABI from './V4AutoRange.json' with { type: 'json' };

export { SEPOLIA_ADDRESSES, MAINNET_ADDRESSES, ADDRESSES, getAddresses } from './addresses.js';
export type { ChainId } from './addresses.js';

export const ABIS = {
  V4Utils: V4UtilsABI,
  V4Compoundor: V4CompoundorABI,
  V4AutoRange: V4AutoRangeABI,
} as const;

export { V4UtilsABI, V4CompoundorABI, V4AutoRangeABI };
