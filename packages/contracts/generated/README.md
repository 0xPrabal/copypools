# @revert-v4/contracts

Auto-generated contract ABIs and addresses for Revert V4 protocol.

## Contents

- **V4Utils.json** - ABI for V4Utils contract
- **V4Compoundor.json** - ABI for V4Compoundor contract
- **V4AutoRange.json** - ABI for V4AutoRange contract
- **addresses.ts** - Contract addresses by network (Sepolia, Mainnet)
- **index.ts** - Main export file

## Usage

### In Backend (Node.js/TypeScript)

```typescript
import { ABIS, getAddresses } from '@revert-v4/contracts';

const addresses = getAddresses(11155111); // Sepolia
console.log(addresses.V4_UTILS);

// Use with viem
const { data } = await publicClient.readContract({
  address: addresses.V4_UTILS,
  abi: ABIS.V4Utils,
  functionName: 'VERSION',
});
```

### In Frontend (Next.js/React)

```typescript
import { ABIS, getAddresses } from '@revert-v4/contracts';
import { useReadContract } from 'wagmi';

function MyComponent() {
  const addresses = getAddresses(11155111);

  const { data } = useReadContract({
    address: addresses.V4_UTILS,
    abi: ABIS.V4Utils,
    functionName: 'VERSION',
  });
}
```

## TypeScript Configuration

This package requires proper TypeScript configuration:

### tsconfig.json
```json
{
  "compilerOptions": {
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "paths": {
      "@revert-v4/contracts": ["../contracts/generated/index.ts"]
    }
  }
}
```

## Regenerating ABIs

When contracts are updated:

```bash
cd packages/contracts
forge inspect src/utils/V4Utils.sol:V4Utils abi > generated/V4Utils.json
forge inspect src/automators/V4Compoundor.sol:V4Compoundor abi > generated/V4Compoundor.json
forge inspect src/automators/V4AutoRange.sol:V4AutoRange abi > generated/V4AutoRange.json
```

## Networks

### Sepolia Testnet (11155111)
- V4Utils: `0xff9C5B6F76444144a36de91F4d2F3289E37Cf956`
- V4Compoundor: `0xBA8bc095e0BEA3C6B1C6F5FfB56F67AaD76914Ad`
- V4AutoRange: `0xD6e1ED971f2A83EB94dDC0Ceb6841D6D7628EEfD`

### Mainnet (1)
Not yet deployed - addresses will be updated when deployed.

## Notes

- All files in this directory are auto-generated
- Do not manually edit JSON files
- TypeScript requires `resolveJsonModule: true`
- JSON imports use import assertions: `import X from './X.json' assert { type: 'json' };`
