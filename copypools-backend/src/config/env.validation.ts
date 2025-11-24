import { plainToInstance } from 'class-transformer';
import { IsString, IsNumber, IsBoolean, IsOptional, validateSync, IsEnum } from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  // Network Configuration
  @IsString()
  NETWORK: string;

  @IsString()
  RPC_URL: string;

  @IsNumber()
  CHAIN_ID: number;

  // Contract Addresses
  @IsString()
  LP_MANAGER_ADDRESS: string;

  @IsString()
  ADAPTER_ADDRESS: string;

  @IsString()
  POOL_MANAGER_ADDRESS: string;

  // Private Keys
  @IsString()
  @IsOptional()
  OPERATOR_PRIVATE_KEY?: string;

  // Database Configuration
  @IsString()
  DATABASE_URL: string;

  @IsString()
  @IsOptional()
  DATABASE_TYPE: string;

  @IsString()
  @IsOptional()
  DATABASE_HOST: string;

  @IsNumber()
  @IsOptional()
  DATABASE_PORT: number;

  @IsString()
  @IsOptional()
  DATABASE_USERNAME: string;

  @IsString()
  @IsOptional()
  DATABASE_PASSWORD: string;

  @IsString()
  @IsOptional()
  DATABASE_NAME: string;

  // API Configuration
  @IsNumber()
  @IsOptional()
  PORT: number = 3000;

  @IsString()
  @IsOptional()
  API_PREFIX: string = 'api/v1';

  // CORS Configuration
  @IsString()
  @IsOptional()
  CORS_ORIGIN: string = 'http://localhost:3001,http://localhost:5173,http://localhost:5174';

  // Monitoring Configuration
  @IsNumber()
  @IsOptional()
  BLOCK_POLLING_INTERVAL: number = 12000;

  @IsNumber()
  @IsOptional()
  AUTO_COMPOUND_CHECK_INTERVAL: number = 3600000;

  // Feature Flags
  @IsBoolean()
  @IsOptional()
  ENABLE_AUTO_COMPOUND: boolean = true;

  @IsBoolean()
  @IsOptional()
  ENABLE_MONITORING: boolean = true;

  // Rate Limiting
  @IsNumber()
  @IsOptional()
  RATE_LIMIT_TTL: number = 60000; // 1 minute

  @IsNumber()
  @IsOptional()
  RATE_LIMIT_MAX: number = 100; // 100 requests per minute

  // Logging
  @IsString()
  @IsOptional()
  LOG_LEVEL: string = 'info';
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors.map((error) => Object.values(error.constraints || {}).join(', ')).join('\n')}`,
    );
  }

  return validatedConfig;
}
