'use client';

import { useState, useEffect } from 'react';
import { fetchTokenPrices, TokenPrice } from '@/lib/backend';

interface UseTokenPricesResult {
  token0Price: number | null;
  token1Price: number | null;
  token0Symbol: string | null;
  token1Symbol: string | null;
  isLoading: boolean;
  error: string | null;
}

export function useTokenPrices(
  token0Address: string | undefined,
  token1Address: string | undefined,
  chainId: number
): UseTokenPricesResult {
  const [token0Price, setToken0Price] = useState<number | null>(null);
  const [token1Price, setToken1Price] = useState<number | null>(null);
  const [token0Symbol, setToken0Symbol] = useState<string | null>(null);
  const [token1Symbol, setToken1Symbol] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPrices = async () => {
      if (!token0Address || !token1Address) {
        setToken0Price(null);
        setToken1Price(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const addresses = [token0Address, token1Address].filter(Boolean);
        const prices = await fetchTokenPrices(addresses, chainId);

        if (prices.length === 0) {
          setError('Failed to fetch token prices');
          return;
        }

        // Match prices to tokens
        const price0 = prices.find(
          p => p.address.toLowerCase() === token0Address.toLowerCase()
        );
        const price1 = prices.find(
          p => p.address.toLowerCase() === token1Address.toLowerCase()
        );

        setToken0Price(price0?.priceUSD ?? null);
        setToken1Price(price1?.priceUSD ?? null);
        setToken0Symbol(price0?.symbol ?? null);
        setToken1Symbol(price1?.symbol ?? null);
      } catch (err) {
        console.error('Error fetching token prices:', err);
        setError('Failed to fetch token prices');
      } finally {
        setIsLoading(false);
      }
    };

    fetchPrices();
  }, [token0Address, token1Address, chainId]);

  return {
    token0Price,
    token1Price,
    token0Symbol,
    token1Symbol,
    isLoading,
    error,
  };
}
