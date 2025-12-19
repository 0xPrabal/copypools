/**
 * Ponder GraphQL Client Configuration
 *
 * This client connects to the Ponder indexer GraphQL API
 * to query indexed blockchain data.
 */

import { GraphQLClient } from 'graphql-request';

const PONDER_URL = process.env.NEXT_PUBLIC_PONDER_URL || 'http://localhost:42069';

export const ponderClient = new GraphQLClient(PONDER_URL, {
  headers: {
    'Content-Type': 'application/json',
  },
});

// GraphQL query helper with error handling
export async function queryPonder<T>(query: string, variables?: Record<string, any>): Promise<T> {
  try {
    return await ponderClient.request<T>(query, variables);
  } catch (error) {
    console.error('Ponder query error:', error);
    throw error;
  }
}
