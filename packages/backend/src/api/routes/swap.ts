import { Router, Request, Response } from 'express';
import axios from 'axios';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

const swapRouter = Router();
const swapLogger = logger.child({ module: 'swap-api' });

// 0x API v2 unified endpoint
const ZEROX_API_URL = 'https://api.0x.org';

// Supported chains for 0x API v2
const SUPPORTED_CHAINS = [1, 8453]; // Mainnet, Base

// WETH addresses per chain
const WETH_ADDRESSES: Record<number, string> = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  8453: '0x4200000000000000000000000000000000000006',
};

interface SwapQuoteRequest {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  chainId: number;
  slippagePercentage?: string;
  taker?: string; // Required for v2 API
}

interface SwapQuoteResponse {
  router: string;
  data: string;
  expectedOutput: string;
  priceImpact: number;
  gasEstimate?: string;
}

/**
 * Get swap quote from 0x API
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

    // Check if 0x API key is configured
    if (!config.ZEROX_API_KEY) {
      swapLogger.warn('0x API key not configured');
      return res.status(503).json({
        error: 'Swap service unavailable - API key not configured',
      });
    }

    // Check if chain is supported
    if (!SUPPORTED_CHAINS.includes(chainId)) {
      return res.status(400).json({
        error: `Unsupported chain ID: ${chainId}`,
      });
    }

    // Handle native ETH - convert to WETH for 0x API
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const weth = WETH_ADDRESSES[chainId];

    const normalizedSellToken = sellToken.toLowerCase() === ZERO_ADDRESS.toLowerCase()
      ? weth
      : sellToken;
    const normalizedBuyToken = buyToken.toLowerCase() === ZERO_ADDRESS.toLowerCase()
      ? weth
      : buyToken;

    swapLogger.info({
      sellToken: normalizedSellToken,
      buyToken: normalizedBuyToken,
      sellAmount,
      chainId,
    }, 'Fetching 0x swap quote (v2 API)');

    // Call 0x API v2 - using allowance-holder flow
    const response = await axios.get(`${ZEROX_API_URL}/swap/allowance-holder/quote`, {
      headers: {
        '0x-api-key': config.ZEROX_API_KEY,
        '0x-version': 'v2',
      },
      params: {
        chainId,
        sellToken: normalizedSellToken,
        buyToken: normalizedBuyToken,
        sellAmount,
        taker, // Required for v2 API
        slippageBps: Math.round(parseFloat(slippagePercentage) * 10000), // Convert to basis points
      },
    });

    const data = response.data;

    // v2 API response structure
    const quoteResponse: SwapQuoteResponse = {
      router: data.transaction?.to || data.to,
      data: data.transaction?.data || data.data,
      expectedOutput: data.buyAmount,
      priceImpact: parseFloat(data.estimatedPriceImpact || '0'),
      gasEstimate: data.transaction?.gas || data.gas,
    };

    swapLogger.info({
      expectedOutput: quoteResponse.expectedOutput,
      priceImpact: quoteResponse.priceImpact,
    }, '0x quote received');

    return res.json(quoteResponse);
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      swapLogger.error({
        status: error.response?.status,
        data: error.response?.data,
      }, '0x API error');

      // Return specific error from 0x
      if (error.response?.status === 400) {
        return res.status(400).json({
          error: error.response?.data?.reason || 'Invalid swap parameters',
          validationErrors: error.response?.data?.validationErrors,
        });
      }

      return res.status(error.response?.status || 500).json({
        error: 'Failed to get swap quote',
        details: error.response?.data?.reason,
      });
    }

    swapLogger.error({ error }, 'Swap quote failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get swap price (lightweight, for UI estimates)
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

    if (!config.ZEROX_API_KEY) {
      return res.status(503).json({ error: 'Swap service unavailable' });
    }

    const chainIdNum = Number(chainId);
    if (!SUPPORTED_CHAINS.includes(chainIdNum)) {
      return res.status(400).json({ error: `Unsupported chain ID: ${chainId}` });
    }

    // Handle native ETH
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const weth = WETH_ADDRESSES[chainIdNum];

    const normalizedSellToken = (sellToken as string).toLowerCase() === ZERO_ADDRESS.toLowerCase()
      ? weth
      : sellToken;
    const normalizedBuyToken = (buyToken as string).toLowerCase() === ZERO_ADDRESS.toLowerCase()
      ? weth
      : buyToken;

    // Use 0x API v2 price endpoint
    const response = await axios.get(`${ZEROX_API_URL}/swap/allowance-holder/price`, {
      headers: {
        '0x-api-key': config.ZEROX_API_KEY,
        '0x-version': 'v2',
      },
      params: {
        chainId: chainIdNum,
        sellToken: normalizedSellToken,
        buyToken: normalizedBuyToken,
        sellAmount,
      },
    });

    return res.json({
      buyAmount: response.data.buyAmount,
      price: response.data.price,
      estimatedPriceImpact: response.data.estimatedPriceImpact,
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
        error: 'Missing required fields',
      });
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
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const weth = WETH_ADDRESSES[chainId];

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
