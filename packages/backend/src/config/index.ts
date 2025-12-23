import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  // Server
  PORT: z.string().default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Blockchain
  RPC_URL: z.string().url(),
  CHAIN_ID: z.string().transform(Number),
  PRIVATE_KEY: z.string().optional(),

  // Contract Addresses
  POOL_MANAGER_ADDRESS: z.string(),
  POSITION_MANAGER_ADDRESS: z.string(),
  STATE_VIEW_ADDRESS: z.string().optional(),
  V4_UTILS_ADDRESS: z.string(),
  V4_COMPOUNDOR_ADDRESS: z.string(),
  V4_AUTO_RANGE_ADDRESS: z.string(),

  // Optional - Not yet implemented
  V4_AUTO_EXIT_ADDRESS: z.string().optional(),
  V4_VAULT_ADDRESS: z.string().optional(),

  // Subgraph/Database
  SUBGRAPH_URL: z.string().url().optional(),
  DATABASE_URL: z.string().optional(),

  // Redis
  REDIS_URL: z.string().url().optional(),

  // External APIs
  ZEROX_API_KEY: z.string().optional(),
  COINGECKO_API_KEY: z.string().optional(),

  // Bot Configuration (optimized for minimal RPC usage)
  BOT_ENABLED: z.string().transform((v) => v === 'true').default('false'),
  COMPOUND_INTERVAL_MS: z.string().transform(Number).default('900000'),      // 15 minutes
  AUTO_EXIT_INTERVAL_MS: z.string().transform(Number).default('900000'),     // 15 minutes
  AUTO_RANGE_INTERVAL_MS: z.string().transform(Number).default('900000'),    // 15 minutes
  LIQUIDATION_INTERVAL_MS: z.string().transform(Number).default('900000'),   // 15 minutes

  // Gas Settings
  MAX_GAS_PRICE_GWEI: z.string().transform(Number).default('100'),
  GAS_PRICE_BUFFER_PERCENT: z.string().transform(Number).default('20'),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Configuration validation failed:');
    console.error(result.error.format());
    throw new Error('Invalid configuration');
  }

  return result.data;
}

export const config = loadConfig();

// Default StateView addresses by chain
const STATE_VIEW_DEFAULTS: Record<number, string> = {
  8453: '0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71', // Base Mainnet
  11155111: '0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c', // Sepolia
};

export const contracts = {
  poolManager: config.POOL_MANAGER_ADDRESS,
  positionManager: config.POSITION_MANAGER_ADDRESS,
  stateView: config.STATE_VIEW_ADDRESS || STATE_VIEW_DEFAULTS[config.CHAIN_ID] || '',
  v4Utils: config.V4_UTILS_ADDRESS,
  v4Compoundor: config.V4_COMPOUNDOR_ADDRESS,
  v4AutoRange: config.V4_AUTO_RANGE_ADDRESS,
  // Optional - Only include if deployed
  v4AutoExit: config.V4_AUTO_EXIT_ADDRESS || undefined,
  v4Vault: config.V4_VAULT_ADDRESS || undefined,
};
