import { PublicKey } from '@solana/web3.js';
import { unifiedBuy } from './buy';
import { unifiedSell, sellAll } from './sell';
import { WalletSelectionMode, TokenPlatform, OperationResult } from '../shared/types';

/**
 * Buy tokens on Pump.fun or PumpSwap
 * @param mintAddress Token mint address
 * @param selectionMode Wallet selection mode (which wallets to use)
 * @param totalSOL Total SOL amount to spend
 * @param slippagePercent Slippage tolerance percentage
 * @param jitoTipAmt Jito tip amount in SOL
 * @returns Operation result
 */
export async function buyToken(
  mintAddress: string | PublicKey, 
  selectionMode: WalletSelectionMode, 
  totalSOL: number,
  slippagePercent: number = 10,
  jitoTipAmt: number = 0.01
): Promise<OperationResult> {
  const result = await unifiedBuy(
    mintAddress,
    selectionMode,
    totalSOL,
    slippagePercent,
    jitoTipAmt
  );

  return {
    success: result.success,
    message: result.message,
    data: {
      platform: result.platform,
      transactions: result.transactions || []
    }
  };
}

/**
 * Sell tokens on Pump.fun or PumpSwap
 * @param mintAddress Token mint address
 * @param selectionMode Wallet selection mode (which wallets to use)
 * @param sellPercentage Percentage of tokens to sell (0-100)
 * @param slippagePercent Slippage tolerance percentage
 * @param jitoTipAmt Jito tip amount in SOL
 * @returns Operation result
 */
export async function sellToken(
  mintAddress: string | PublicKey, 
  selectionMode: WalletSelectionMode, 
  sellPercentage: number,
  slippagePercent: number = 10,
  jitoTipAmt: number = 0.01
): Promise<OperationResult> {
  const result = await unifiedSell(
    mintAddress,
    selectionMode,
    sellPercentage,
    slippagePercent,
    jitoTipAmt
  );

  return {
    success: result.success,
    message: result.message,
    data: {
      platform: result.platform,
      transactions: result.transactions || []
    }
  };
}

/**
 * Sell all tokens from all wallets
 * @param mintAddress Token mint address
 * @param slippagePercent Slippage tolerance percentage
 * @param jitoTipAmt Jito tip amount in SOL
 * @returns Operation result
 */
export async function sellAllTokens(
  mintAddress: string | PublicKey,
  slippagePercent: number = 10,
  jitoTipAmt: number = 0.01
): Promise<OperationResult> {
  const result = await sellAll(
    mintAddress,
    slippagePercent,
    jitoTipAmt
  );

  return {
    success: result.success,
    message: result.message,
    data: {
      platform: result.platform,
      transactions: result.transactions || []
    }
  };
}

/**
 * Detect which platform a token is on
 * @param mintAddress Token mint address
 * @returns Object with platform information
 */
export async function detectTokenPlatform(
  mintAddress: string | PublicKey
): Promise<OperationResult> {
  try {
    // Call the unified buy with minimal parameters to get platform detection
    const mintPk = typeof mintAddress === 'string' ? new PublicKey(mintAddress) : mintAddress;
    
    // First try to do platform detection using buy module
    const result = await unifiedBuy(
      mintPk,
      WalletSelectionMode.CREATOR_ONLY, // Doesn't matter, we're just detecting
      0.0001, // Minimal amount
      10,
      0.001
    );
    
    if (!result.platform) {
      return {
        success: false,
        message: "Token not found on Pump.fun or PumpSwap",
        data: { platform: null }
      };
    }
    
    return {
      success: true,
      message: `Token found on ${result.platform}`,
      data: { 
        platform: result.platform,
        mintAddress: mintPk.toString(),
        url: result.platform === TokenPlatform.PUMP_FUN 
          ? `https://pump.fun/${mintPk.toString()}`
          : `https://pumpswap.co/${mintPk.toString()}`
      }
    };
  } catch (error) {
    return {
      success: false,
      message: `Error detecting platform: ${error.message || "Unknown error"}`,
      data: { platform: null }
    };
  }
}