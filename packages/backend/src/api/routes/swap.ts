import { Router, Request, Response } from 'express';
import axios from 'axios';
import { logger } from '../../utils/logger.js';
import { getTokenPriceUSD, getTokenInfo } from '../../services/price.js';

const swapRouter = Router();
const swapLogger = logger.child({ module: 'swap-api' });

// KyberSwap Aggregator API (free, no API key needed)
const KYBERSWAP_CHAIN_MAP: Record<number, string> = {
  8453: 'base',
  1: 'ethereum',
};

// Supported chains
const SUPPORTED_CHAINS = [1, 8453]; // Mainnet, Base

// WETH addresses per chain
const WETH_ADDRESSES: Record<number, string> = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  8453: '0x4200000000000000000000000000000000000006',
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

interface SwapQuoteRequest {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  chainId: number;
  slippagePercentage?: string;
  taker?: string;
}

interface SwapQuoteResponse {
  router: string;
  data: string;
  expectedOutput: string;
  priceImpact: number;
  gasEstimate?: string;
  source: string;
}

/**
 * Normalize native ETH to WETH for DEX APIs
 */
function normalizeToken(token: string, chainId: number): string {
  return token.toLowerCase() === ZERO_ADDRESS.toLowerCase()
    ? WETH_ADDRESSES[chainId] || token
    : token;
}

/**
 * Get swap quote via KyberSwap Aggregator
 * POST /api/swap/quote
 */
swapRouter.post('/quote', async (req: Request, res: Response) => {
  try {
    const {
      sellToken,
      buyToken,
      sellAmount,
      chainId,
      slippagePercentage = '0.01', // 1% default
      taker,
    } = req.body as SwapQuoteRequest;

    // Validate required fields
    if (!sellToken || !buyToken || !sellAmount || !chainId || !taker) {
      return res.status(400).json({
        error: 'Missing required fields: sellToken, buyToken, sellAmount, chainId, taker',
      });
    }

    // Validate address formats (must be 0x-prefixed hex, 42 chars)
    const addressRegex = /^0x[0-9a-fA-F]{40}$/;
    if (!addressRegex.test(sellToken) || !addressRegex.test(buyToken) || !addressRegex.test(taker)) {
      return res.status(400).json({ error: 'Invalid address format for sellToken, buyToken, or taker' });
    }

    // Validate sellAmount is a positive numeric string
    if (!/^\d+$/.test(sellAmount) || sellAmount === '0') {
      return res.status(400).json({ error: 'sellAmount must be a positive integer string' });
    }

    // Validate slippage bounds (0.0001 to 0.50 = 0.01% to 50%)
    const slippage = parseFloat(slippagePercentage);
    if (isNaN(slippage) || slippage < 0.0001 || slippage > 0.50) {
      return res.status(400).json({ error: 'slippagePercentage must be between 0.0001 and 0.50' });
    }

    // Check if chain is supported
    if (!SUPPORTED_CHAINS.includes(chainId)) {
      return res.status(400).json({ error: `Unsupported chain ID: ${chainId}` });
    }

    const kyberChain = KYBERSWAP_CHAIN_MAP[chainId];
    if (!kyberChain) {
      return res.status(400).json({ error: `KyberSwap not available for chain ${chainId}` });
    }

    const normalizedSellToken = normalizeToken(sellToken, chainId);
    const normalizedBuyToken = normalizeToken(buyToken, chainId);

    swapLogger.info({
      sellToken: normalizedSellToken,
      buyToken: normalizedBuyToken,
      sellAmount,
      chainId,
    }, 'Fetching KyberSwap route');

    // Step 1: Get route from KyberSwap
    const routeResponse = await axios.get(
      `https://aggregator-api.kyberswap.com/${kyberChain}/api/v1/routes`,
      {
        params: {
          tokenIn: normalizedSellToken,
          tokenOut: normalizedBuyToken,
          amountIn: sellAmount,
          saveGas: '0',
          gasInclude: 'true',
        },
        timeout: 15_000,
      }
    );

    const routeData = routeResponse.data?.data;
    if (!routeData?.routeSummary) {
      swapLogger.warn({ response: routeResponse.data }, 'KyberSwap returned no route');
      return res.status(404).json({ error: 'No swap route found' });
    }

    // Step 2: Build transaction from route
    const slippageBps = Math.round(slippage * 10000);
    const buildResponse = await axios.post(
      `https://aggregator-api.kyberswap.com/${kyberChain}/api/v1/route/build`,
      {
        routeSummary: routeData.routeSummary,
        sender: taker,
        recipient: taker,
        slippageTolerance: slippageBps,
      },
      { timeout: 15_000 }
    );

    const buildData = buildResponse.data?.data;
    if (!buildData) {
      swapLogger.warn({ response: buildResponse.data }, 'KyberSwap build returned no data');
      return res.status(500).json({ error: 'Failed to build swap transaction' });
    }

    const quoteResponse: SwapQuoteResponse = {
      router: buildData.routerAddress || routeData.routerAddress,
      data: buildData.data,
      expectedOutput: routeData.routeSummary.amountOut,
      priceImpact: parseFloat(routeData.routeSummary.priceImpact || '0'),
      gasEstimate: buildData.gas || routeData.routeSummary.gas,
      source: 'kyberswap',
    };

    swapLogger.info({
      expectedOutput: quoteResponse.expectedOutput,
      priceImpact: quoteResponse.priceImpact,
      source: 'kyberswap',
    }, 'Swap quote received');

    return res.json(quoteResponse);
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      swapLogger.error({
        status: error.response?.status,
        data: error.response?.data,
        url: error.config?.url,
      }, 'KyberSwap API error');

      if (error.response?.status === 400) {
        return res.status(400).json({
          error: error.response?.data?.message || 'Invalid swap parameters',
          details: error.response?.data,
        });
      }

      return res.status(error.response?.status || 500).json({
        error: 'Failed to get swap quote',
        details: error.response?.data?.message || error.message,
      });
    }

    swapLogger.error({ error }, 'Swap quote failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get swap price estimate (lightweight, for UI estimates)
 * Uses price service to compute token-to-token rates.
 * Falls back to KyberSwap route API for on-chain accuracy.
 * GET /api/swap/price
 */
swapRouter.get('/price', async (req: Request, res: Response) => {
  try {
    const { sellToken, buyToken, sellAmount, chainId } = req.query;

    if (!sellToken || !buyToken || !sellAmount || !chainId) {
      return res.status(400).json({
        error: 'Missing required query params: sellToken, buyToken, sellAmount, chainId',
      });
    }

    // Validate address formats
    const addressRegex = /^0x[0-9a-fA-F]{40}$/;
    if (!addressRegex.test(sellToken as string) || !addressRegex.test(buyToken as string)) {
      return res.status(400).json({ error: 'Invalid address format for sellToken or buyToken' });
    }

    // Validate sellAmount is numeric
    if (!/^\d+$/.test(sellAmount as string) || sellAmount === '0') {
      return res.status(400).json({ error: 'sellAmount must be a positive integer string' });
    }

    const chainIdNum = Number(chainId);
    if (!SUPPORTED_CHAINS.includes(chainIdNum)) {
      return res.status(400).json({ error: `Unsupported chain ID: ${chainId}` });
    }

    const normalizedSellToken = normalizeToken(sellToken as string, chainIdNum);
    const normalizedBuyToken = normalizeToken(buyToken as string, chainIdNum);

    // Try KyberSwap route API first for accurate on-chain pricing
    const kyberChain = KYBERSWAP_CHAIN_MAP[chainIdNum];
    if (kyberChain) {
      try {
        const routeResponse = await axios.get(
          `https://aggregator-api.kyberswap.com/${kyberChain}/api/v1/routes`,
          {
            params: {
              tokenIn: normalizedSellToken,
              tokenOut: normalizedBuyToken,
              amountIn: sellAmount,
              saveGas: '0',
            },
            timeout: 10_000,
          }
        );

        const routeData = routeResponse.data?.data?.routeSummary;
        if (routeData?.amountOut) {
          return res.json({
            buyAmount: routeData.amountOut,
            price: routeData.amountOut && sellAmount
              ? (Number(routeData.amountOut) / Number(sellAmount)).toString()
              : null,
            estimatedPriceImpact: routeData.priceImpact || '0',
            source: 'kyberswap',
          });
        }
      } catch (kyberError) {
        swapLogger.debug({ error: kyberError }, 'KyberSwap price estimate failed, falling back to price service');
      }
    }

    // Fallback: compute from USD prices via price service
    const [sellPrice, buyPrice] = await Promise.all([
      getTokenPriceUSD(normalizedSellToken, chainIdNum),
      getTokenPriceUSD(normalizedBuyToken, chainIdNum),
    ]);

    if (sellPrice.priceUSD === null || buyPrice.priceUSD === null) {
      return res.status(503).json({
        error: 'Unable to determine token prices',
        sellTokenPrice: sellPrice.priceUSD,
        buyTokenPrice: buyPrice.priceUSD,
      });
    }

    // Calculate estimated buy amount from USD price ratio
    const sellTokenInfo = getTokenInfo(normalizedSellToken, chainIdNum);
    const buyTokenInfo = getTokenInfo(normalizedBuyToken, chainIdNum);
    const priceRatio = sellPrice.priceUSD / buyPrice.priceUSD;
    const decimalAdjustment = 10 ** (buyTokenInfo.decimals - sellTokenInfo.decimals);
    const buyAmountFloat = Number(sellAmount) * priceRatio * decimalAdjustment;
    const buyAmount = BigInt(Math.floor(buyAmountFloat));

    return res.json({
      buyAmount: buyAmount.toString(),
      price: priceRatio.toString(),
      estimatedPriceImpact: '0',
      source: 'price-service',
      note: 'Estimate based on spot prices, actual swap may differ',
    });
  } catch (error: any) {
    swapLogger.error({ error }, 'Swap price failed');
    return res.status(500).json({ error: 'Failed to get swap price' });
  }
});

/**
 * Calculate optimal zap amounts for a position
 * POST /api/swap/zap-calculate
 */
swapRouter.post('/zap-calculate', async (req: Request, res: Response) => {
  try {
    const {
      inputToken,
      inputAmount,
      token0,
      token1,
      sqrtPriceX96,
      tickLower,
      tickUpper,
      chainId,
    } = req.body;

    if (!inputToken || !inputAmount || !token0 || !token1 || !sqrtPriceX96 || tickLower === undefined || tickUpper === undefined || !chainId) {
      return res.status(400).json({
        error: 'Missing required fields: inputToken, inputAmount, token0, token1, sqrtPriceX96, tickLower, tickUpper, chainId',
      });
    }

    if (!SUPPORTED_CHAINS.includes(chainId)) {
      return res.status(400).json({ error: `Unsupported chain ID: ${chainId}` });
    }

    // Calculate optimal ratio based on current price and range
    const Q96 = BigInt(2) ** BigInt(96);
    const sqrtPrice = BigInt(sqrtPriceX96);
    const price = Number((sqrtPrice * sqrtPrice * BigInt(10) ** BigInt(18)) / Q96 / Q96) / 1e18;

    const sqrtRatioA = Math.sqrt(1.0001 ** tickLower);
    const sqrtRatioB = Math.sqrt(1.0001 ** tickUpper);
    const sqrtPriceNum = Math.sqrt(price);

    let ratio0: number;
    let ratio1: number;

    if (sqrtPriceNum <= sqrtRatioA) {
      ratio0 = 100;
      ratio1 = 0;
    } else if (sqrtPriceNum >= sqrtRatioB) {
      ratio0 = 0;
      ratio1 = 100;
    } else {
      const amount0 = (1 / sqrtPriceNum - 1 / sqrtRatioB) * 1e18;
      const amount1 = (sqrtPriceNum - sqrtRatioA) * 1e18;
      const total = amount0 * price + amount1;
      ratio0 = Math.round((amount0 * price / total) * 100);
      ratio1 = 100 - ratio0;
    }

    // Determine if input is token0 or token1
    const weth = WETH_ADDRESSES[chainId];
    if (!weth) {
      return res.status(400).json({ error: `WETH address not configured for chain ${chainId}` });
    }

    const normalizedInput = inputToken.toLowerCase() === ZERO_ADDRESS.toLowerCase()
      ? weth.toLowerCase()
      : inputToken.toLowerCase();
    const normalizedToken0 = token0.toLowerCase() === ZERO_ADDRESS.toLowerCase()
      ? weth.toLowerCase()
      : token0.toLowerCase();

    const inputIsToken0 = normalizedInput === normalizedToken0;

    // Calculate swap amount
    const inputAmountBn = BigInt(inputAmount);
    let swapAmount: bigint;
    let swapFromToken: string;
    let swapToToken: string;

    if (inputIsToken0) {
      swapAmount = (inputAmountBn * BigInt(ratio1)) / 100n;
      swapFromToken = token0;
      swapToToken = token1;
    } else {
      swapAmount = (inputAmountBn * BigInt(ratio0)) / 100n;
      swapFromToken = token1;
      swapToToken = token0;
    }

    return res.json({
      ratio0,
      ratio1,
      swapAmount: swapAmount.toString(),
      swapFromToken,
      swapToToken,
      remainingInput: (inputAmountBn - swapAmount).toString(),
    });
  } catch (error: any) {
    swapLogger.error({ error }, 'Zap calculation failed');
    return res.status(500).json({ error: 'Failed to calculate zap amounts' });
  }
});

export { swapRouter };
