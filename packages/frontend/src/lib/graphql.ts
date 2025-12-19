import { GraphQLClient } from 'graphql-request';

const PONDER_URL = process.env.NEXT_PUBLIC_PONDER_URL || 'http://localhost:42069';

export const ponderClient = new GraphQLClient(`${PONDER_URL}/graphql`);

// GraphQL Queries
export const GET_POSITIONS = `
  query GetPositions($owner: String!) {
    positions(where: { owner: $owner }, orderBy: "createdAtTimestamp", orderDirection: "desc") {
      items {
        id
        tokenId
        owner
        poolId
        tickLower
        tickUpper
        liquidity
        depositedToken0
        depositedToken1
        collectedFeesToken0
        collectedFeesToken1
        createdAtTimestamp
        closedAtTimestamp
      }
    }
  }
`;

export const GET_COMPOUND_CONFIGS = `
  query GetCompoundConfigs($positionId: String!) {
    compoundConfigs(where: { positionId: $positionId }) {
      items {
        id
        positionId
        enabled
        minCompoundInterval
        minRewardAmount
        totalCompounds
        lastCompoundTimestamp
      }
    }
  }
`;

export const GET_RANGE_CONFIGS = `
  query GetRangeConfigs($positionId: String!) {
    rangeConfigs(where: { positionId: $positionId }) {
      items {
        id
        positionId
        enabled
        lowerDelta
        upperDelta
        rebalanceThreshold
        totalRebalances
        lastRebalanceTimestamp
      }
    }
  }
`;

export const GET_PROTOCOL_STATS = `
  query GetProtocolStats {
    protocolStats(limit: 1, orderBy: "lastUpdateTimestamp", orderDirection: "desc") {
      items {
        id
        totalPositions
        activePositions
        totalVolumeUSD
        totalFeesUSD
      }
    }
  }
`;
