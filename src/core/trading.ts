import { PublicKey } from '@solana/web3.js';
import { unifiedBuy } from './buy';
import { unifiedSell, sellAll } from './sell';
import { WalletSelectionMode, TokenPlatform, OperationResult } from '../shared/types';

/**
 * Buy tokens on Pump.fun or PumpSwap
 * @param userId User ID
 * @param mintAddress Token mint address
 * @param selectionMode Wallet selection mode (which wallets to use)
 * @param totalSOL Total SOL amount to spend
 * @param slippagePercent Slippage tolerance percentage
 * @param jitoTipAmt Jito tip amount in SOL
 * @returns Operation result
 */
export async function buyToken(
  userId: number,
  mintAddress: string | PublicKey, 
  selectionMode: WalletSelectionMode, 
  totalSOL: number,
  slippagePercent: number = 10,
  jitoTipAmt: number = 0.01
): Promise<OperationResult> {
  const result = await unifiedBuy(
    userId,
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
 * @param userId User ID
 * @param mintAddress Token mint address
 * @param selectionMode Wallet selection mode (which wallets to use)
 * @param sellPercentage Percentage of tokens to sell (0-100)
 * @param slippagePercent Slippage tolerance percentage
 * @param jitoTipAmt Jito tip amount in SOL
 * @returns Operation result
 */
export async function sellToken(
  userId: number,
  mintAddress: string | PublicKey, 
  selectionMode: WalletSelectionMode, 
  sellPercentage: number,
  slippagePercent: number = 10,
  jitoTipAmt: number = 0.01
): Promise<OperationResult> {
  const result = await unifiedSell(
    userId,
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
 * @param userId User ID
 * @param mintAddress Token mint address
 * @param slippagePercent Slippage tolerance percentage
 * @param jitoTipAmt Jito tip amount in SOL
 * @returns Operation result
 */
export async function sellAllTokens(
  userId: number,
  mintAddress: string | PublicKey,
  slippagePercent: number = 10,
  jitoTipAmt: number = 0.01
): Promise<OperationResult> {
  const result = await sellAll(
    userId,
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
 * @param userId User ID
 * @param mintAddress Token mint address
 * @returns Object with platform information
 */
export async function detectTokenPlatform(
  userId: number,
  mintAddress: string | PublicKey
): Promise<OperationResult> {
  try {
    // Convert string mint address to PublicKey if needed
    const mintPk = typeof mintAddress === 'string' ? new PublicKey(mintAddress) : mintAddress;
    
    // Try to detect platform by checking for platform-specific accounts
    // This is more efficient than trying to do a minimal buy operation
    const { connection } = await import('../shared/config');
    const { PUMP_PROGRAM } = await import('../shared/config');
    const { PUMPSWAP_PROGRAM_ID } = await import('../shared/constants');
    
    // Check for Pump.fun bonding curve
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mintPk.toBytes()], 
      PUMP_PROGRAM
    );

    const bondingCurveInfo = await connection.getAccountInfo(bondingCurve);
    if (bondingCurveInfo) {
      return {
        success: true,
        message: `Token found on ${TokenPlatform.PUMP_FUN}`,
        data: { 
          platform: TokenPlatform.PUMP_FUN,
          mintAddress: mintPk.toString(),
          url: `https://pump.fun/${mintPk.toString()}`
        }
      };
    }

    // Check for PumpSwap pool
    const [poolAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), mintPk.toBytes()],
      PUMPSWAP_PROGRAM_ID
    );

    const poolInfo = await connection.getAccountInfo(poolAddress);
    if (poolInfo) {
      return {
        success: true,
        message: `Token found on ${TokenPlatform.PUMPSWAP}`,
        data: { 
          platform: TokenPlatform.PUMPSWAP,
          mintAddress: mintPk.toString(),
          url: `https://pumpswap.co/${mintPk.toString()}`
        }
      };
    }
    
    // Token not found on either platform
    return {
      success: false,
      message: "Token not found on Pump.fun or PumpSwap",
      data: { platform: null }
    };
    
  } catch (error: any) {
    return {
      success: false,
      message: `Error detecting platform: ${error.message || "Unknown error"}`,
      data: { platform: null }
    };
  }
}