/**
 * Input validation utilities for liquidity management
 */

import { parseUnits } from 'ethers'
import { ValidationError } from '@/lib/types/liquidity'

/**
 * Validate token amount input
 */
export function validateAmount(
  amount: string,
  balance: string,
  decimals: number,
  tokenSymbol: string
): ValidationError[] {
  const errors: ValidationError[] = []

  // Check if empty
  if (!amount || amount.trim() === '') {
    errors.push({
      field: 'amount',
      message: `Please enter ${tokenSymbol} amount`,
      type: 'error'
    })
    return errors
  }

  // Check if valid number
  const numAmount = parseFloat(amount)
  if (isNaN(numAmount)) {
    errors.push({
      field: 'amount',
      message: 'Invalid amount format',
      type: 'error'
    })
    return errors
  }

  // Check if positive
  if (numAmount <= 0) {
    errors.push({
      field: 'amount',
      message: 'Amount must be greater than 0',
      type: 'error'
    })
    return errors
  }

  // Check if exceeds balance
  const numBalance = parseFloat(balance)
  if (numAmount > numBalance) {
    errors.push({
      field: 'amount',
      message: `Insufficient ${tokenSymbol} balance. You have ${numBalance.toFixed(4)} ${tokenSymbol}`,
      type: 'error'
    })
  }

  // Check for dust amounts (too small)
  try {
    const amountWei = parseUnits(amount, decimals)
    if (amountWei === 0n) {
      errors.push({
        field: 'amount',
        message: 'Amount too small (dust amount)',
        type: 'error'
      })
    }
  } catch (err) {
    errors.push({
      field: 'amount',
      message: 'Amount precision too high',
      type: 'error'
    })
  }

  // Warning for amounts close to balance
  if (numAmount > numBalance * 0.99) {
    errors.push({
      field: 'amount',
      message: 'Using almost all your balance. Make sure to leave some for gas fees.',
      type: 'warning'
    })
  }

  return errors
}

/**
 * Validate price range
 */
export function validatePriceRange(
  minPrice: string,
  maxPrice: string,
  currentPrice: number
): ValidationError[] {
  const errors: ValidationError[] = []

  // Check if prices are provided
  if (!minPrice || !maxPrice) {
    errors.push({
      field: 'priceRange',
      message: 'Please set price range',
      type: 'error'
    })
    return errors
  }

  const min = parseFloat(minPrice)
  const max = parseFloat(maxPrice)

  // Check if valid numbers
  if (isNaN(min) || isNaN(max)) {
    errors.push({
      field: 'priceRange',
      message: 'Invalid price format',
      type: 'error'
    })
    return errors
  }

  // Check if positive
  if (min <= 0 || max <= 0) {
    errors.push({
      field: 'priceRange',
      message: 'Prices must be greater than 0',
      type: 'error'
    })
    return errors
  }

  // Check if min < max
  if (min >= max) {
    errors.push({
      field: 'priceRange',
      message: 'Min price must be less than max price',
      type: 'error'
    })
    return errors
  }

  // Check for unrealistic ranges
  if (max / min > 1000) {
    errors.push({
      field: 'priceRange',
      message: 'Price range too wide (max/min > 1000x). This may result in very low capital efficiency.',
      type: 'warning'
    })
  }

  // Warning if out of range
  if (currentPrice > 0 && (currentPrice < min || currentPrice > max)) {
    errors.push({
      field: 'priceRange',
      message: 'Position will be out of range and will not earn fees until price moves into range',
      type: 'warning'
    })
  }

  // Warning for very narrow ranges
  if (max / min < 1.01) {
    errors.push({
      field: 'priceRange',
      message: 'Very narrow range (< 1% width). Position will go out of range easily and require frequent management.',
      type: 'warning'
    })
  }

  return errors
}

/**
 * Validate tick spacing alignment
 */
export function validateTickSpacing(
  tick: number,
  tickSpacing: number
): ValidationError | null {
  if (tick % tickSpacing !== 0) {
    return {
      field: 'tick',
      message: `Tick must be divisible by ${tickSpacing}. It will be automatically rounded.`,
      type: 'warning'
    }
  }
  return null
}

/**
 * Validate minimum liquidity
 */
export function validateMinimumLiquidity(
  liquidity: bigint,
  minLiquidity: bigint = 1000n
): ValidationError | null {
  if (liquidity < minLiquidity) {
    return {
      field: 'liquidity',
      message: `Liquidity too low. Minimum required: ${minLiquidity.toString()}`,
      type: 'error'
    }
  }
  return null
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(errors: ValidationError[]): {
  hasErrors: boolean
  hasWarnings: boolean
  errorMessages: string[]
  warningMessages: string[]
} {
  const errorMessages = errors
    .filter(e => e.type === 'error')
    .map(e => e.message)

  const warningMessages = errors
    .filter(e => e.type === 'warning')
    .map(e => e.message)

  return {
    hasErrors: errorMessages.length > 0,
    hasWarnings: warningMessages.length > 0,
    errorMessages,
    warningMessages
  }
}

/**
 * Validate pool exists and is initialized
 */
export function validatePoolState(
  sqrtPriceX96: bigint,
  tick: number
): ValidationError | null {
  if (sqrtPriceX96 === 0n || tick === 0) {
    return {
      field: 'pool',
      message: 'Pool not initialized or does not exist. Please check token pair and fee tier.',
      type: 'error'
    }
  }
  return null
}
