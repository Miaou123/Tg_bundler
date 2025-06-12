import { 
  PublicKey, 
  VersionedTransaction, 
  TransactionMessage, 
  SystemProgram, 
  Keypair, 
  LAMPORTS_PER_SOL, 
  ComputeBudgetProgram, 
  TransactionInstruction,
  AddressLookupTableAccount 
} from '@solana/web3.js';
import { connection, wallet, payer, PUMP_PROGRAM, feeRecipient, eventAuthority, global } from '../shared/config';
import * as spl from '@solana/spl-token';
import bs58 from 'bs58';
import fs from 'fs';
import { Bundle as JitoBundle } from 'jito-ts/dist/sdk/block-engine/types.js';
import * as anchor from '@coral-xyz/anchor';
import BN from 'bn.js';
import { loadUserKeypairs } from './keys';
import { getRandomTipAccount } from '../clients/config';
import { searcherClient } from '../clients/jito';
import { 
  WalletSelectionMode, 
  WalletWithTokens, 
  TokenPlatform,
  BundleResult
} from '../shared/types';
import { loadUserPoolInfo, sleep } from '../shared/utils';
import { PUMPSWAP_PROGRAM_ID, WSOL_MINT, TX_SETTINGS } from '../shared/constants';

// Extended bundle result for internal use
interface ExtendedBundleResult extends BundleResult {
  success?: boolean;
  bundledTxns?: VersionedTransaction[];
}

/**
 * Main unified sell function for both Pump.fun and PumpSwap
 * @param userId Telegram user ID
 * @param mintAddress Token mint address (if provided as string, will be converted to PublicKey)
 * @param selectionMode Wallet selection mode (which wallets to use)
 * @param sellPercentage Percentage of tokens to sell (0-100)
 * @param slippagePercent Slippage tolerance percentage
 * @param jitoTipAmt Jito tip amount in SOL
 * @returns Result of the operation
 */
export async function unifiedSell(
  userId: number,
  mintAddress: PublicKey | string, 
  selectionMode: WalletSelectionMode,
  sellPercentage: number,
  slippagePercent: number = 10,
  jitoTipAmt: number = 0.01
): Promise<{
  success: boolean,
  message: string,
  platform?: TokenPlatform,
  transactions?: string[]
}> {
  try {
    // Convert string mint address to PublicKey if needed
    const mintPk = typeof mintAddress === 'string' 
      ? new PublicKey(mintAddress) 
      : mintAddress;

    // Normalize percentage (convert from 0-100 to 0-1)
    const supplyPercent = sellPercentage / 100;
    if (supplyPercent <= 0 || supplyPercent > 1) {
      return {
        success: false,
        message: "❌ Invalid percentage! Must be between 0 and 100."
      };
    }

    // Load user-specific pool info
    const poolInfo = loadUserPoolInfo(userId);
    
    if (!poolInfo.addressLUT) {
      return {
        success: false,
        message: "❌ Missing LUT in pool info. Please run the Pre Launch Checklist first."
      };
    }

    const lut = new PublicKey(poolInfo.addressLUT.toString());
    const lookupTableAccount = (await connection.getAddressLookupTable(lut)).value;
    
    if (!lookupTableAccount) {
      return {
        success: false,
        message: "❌ Lookup table not found!"
      };
    }

    // Detect platform
    const platform = await detectTokenPlatform(mintPk);
    
    if (!platform) {
      return {
        success: false,
        message: "❌ Token not found on Pump.fun or PumpSwap!"
      };
    }

    console.log(`🎯 Detected platform: ${platform}`);

    // Load user keypairs
    const keypairs = loadUserKeypairs(userId);
    
    if (keypairs.length === 0) {
      return {
        success: false,
        message: "❌ No keypairs found for user. Please create keypairs first."
      };
    }

    // Get wallets with tokens based on selection mode
    const walletsWithTokens = await getWalletsWithTokens(userId, mintPk, selectionMode, supplyPercent);
    
    if (walletsWithTokens.length === 0) {
      return {
        success: false,
        message: "❌ No wallets with tokens found!"
      };
    }

    console.log(`💰 Using ${walletsWithTokens.length} wallets for selling`);

    // Execute sell based on platform
    let result;
    if (platform === TokenPlatform.PUMP_FUN) {
      result = await executePumpFunSell(userId, mintPk, walletsWithTokens, slippagePercent, jitoTipAmt, lookupTableAccount);
    } else {
      result = await executePumpSwapSell(userId, mintPk, walletsWithTokens, slippagePercent, jitoTipAmt, lookupTableAccount);
    }

    return {
      success: result.success,
      message: result.message,
      platform: platform,
      transactions: result.transactions
    };

  } catch (error: any) {
    console.error("Sell operation error:", error);
    return {
      success: false,
      message: `❌ Sell operation failed: ${error.message || "Unknown error"}`
    };
  }
}

/**
 * Detect which platform a token is on
 * @param mintAddress Token mint address
 * @returns Token platform or null if not found
 */
async function detectTokenPlatform(mintAddress: PublicKey): Promise<TokenPlatform | null> {
  try {
    // Try Pump.fun first
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mintAddress.toBytes()], 
      PUMP_PROGRAM
    );

    const bondingCurveInfo = await connection.getAccountInfo(bondingCurve);
    if (bondingCurveInfo) {
      return TokenPlatform.PUMP_FUN;
    }

    // Try PumpSwap
    const [poolAddress] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), mintAddress.toBytes()],
      PUMPSWAP_PROGRAM_ID
    );

    const poolInfo = await connection.getAccountInfo(poolAddress);
    if (poolInfo) {
      return TokenPlatform.PUMPSWAP;
    }

    return null;
  } catch (error) {
    console.error("Platform detection error:", error);
    return null;
  }
}

/**
 * Get wallets with tokens based on selection mode
 * @param userId User ID
 * @param mintAddress Token mint address
 * @param selectionMode Wallet selection mode
 * @param supplyPercent Percentage of tokens to sell (0-1)
 * @returns Array of wallets with tokens to sell
 */
async function getWalletsWithTokens(
  userId: number,
  mintAddress: PublicKey,
  selectionMode: WalletSelectionMode, 
  supplyPercent: number
): Promise<WalletWithTokens[]> {
  const keypairs = loadUserKeypairs(userId);
  const walletsWithTokens: WalletWithTokens[] = [];

  // Determine which wallets to check
  let walletsToCheck: Keypair[] = [];
  
  switch (selectionMode) {
    case WalletSelectionMode.ALL_WALLETS:
      walletsToCheck = [wallet, ...keypairs]; // Include creator + bundle wallets
      break;
    case WalletSelectionMode.BUNDLE_ONLY:
      walletsToCheck = keypairs; // Only bundle wallets
      break;
    case WalletSelectionMode.CREATOR_ONLY:
      walletsToCheck = [wallet]; // Only creator wallet
      break;
  }

  // Check token balances
  for (let i = 0; i < walletsToCheck.length; i++) {
    const keypair = walletsToCheck[i];
    
    try {
      const tokenAccount = spl.getAssociatedTokenAddressSync(mintAddress, keypair.publicKey);
      const tokenAccountInfo = await connection.getAccountInfo(tokenAccount);
      
      if (tokenAccountInfo) {
        const tokenBalance = await connection.getTokenAccountBalance(tokenAccount);
        const tokenAmount = parseInt(tokenBalance.value.amount);
        
        if (tokenAmount > 0) {
          const isCreator = keypair.publicKey.equals(wallet.publicKey);
          const walletName = isCreator ? "CREATOR" : `WALLET ${i}`;
          
          walletsWithTokens.push({
            keypair,
            tokenBalance: Math.floor(tokenAmount * supplyPercent),
            walletName
          });
        }
      }
    } catch (error) {
      // Token account doesn't exist or other error - skip this wallet
      console.log(`No tokens found in ${keypair.publicKey.toString().slice(0, 8)}...`);
    }
  }

  return walletsWithTokens;
}

/**
 * Execute Pump.fun sell operation
 * @param userId User ID
 * @param mintAddress Token mint address
 * @param walletsWithTokens Wallets with tokens to sell
 * @param slippagePercent Slippage tolerance
 * @param jitoTipAmt Jito tip amount
 * @param lookupTableAccount Lookup table account
 * @returns Operation result
 */
async function executePumpFunSell(
  userId: number,
  mintAddress: PublicKey,
  walletsWithTokens: WalletWithTokens[],
  slippagePercent: number,
  jitoTipAmt: number,
  lookupTableAccount: AddressLookupTableAccount
): Promise<{
  success: boolean,
  message: string,
  transactions?: string[]
}> {
  try {
    console.log("🔥 Executing Pump.fun sell operation");

    // Get Pump.fun accounts
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mintAddress.toBytes()], 
      PUMP_PROGRAM
    );

    const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
      [bondingCurve.toBytes(), spl.TOKEN_PROGRAM_ID.toBytes(), mintAddress.toBytes()],
      spl.ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Get creator vault (needed for sell)
    const poolInfo = loadUserPoolInfo(userId);
    const creatorPublicKey = new PublicKey(poolInfo.creatorPublicKey || wallet.publicKey.toString());
    
    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), creatorPublicKey.toBytes()], 
      PUMP_PROGRAM
    );

    // Build sell transactions
    const allBundledTxns: VersionedTransaction[][] = [];
    const allSignatures: string[] = [];

    // Process wallets in chunks
    const chunkSize = 4;
    const walletChunks = [];
    for (let i = 0; i < walletsWithTokens.length; i += chunkSize) {
      walletChunks.push(walletsWithTokens.slice(i, i + chunkSize));
    }

    const { blockhash } = await connection.getLatestBlockhash();

    for (let chunkIndex = 0; chunkIndex < walletChunks.length; chunkIndex++) {
      const chunk = walletChunks[chunkIndex];
      const bundledTxns: VersionedTransaction[] = [];

      for (const walletData of chunk) {
        const sellData = await buildPumpFunSellTransaction(
          mintAddress,
          walletData,
          bondingCurve,
          associatedBondingCurve,
          creatorVault,
          slippagePercent,
          chunkIndex === walletChunks.length - 1 ? jitoTipAmt : 0
        );

        if (!sellData) continue;

        const message = new TransactionMessage({
          payerKey: sellData.payer,
          recentBlockhash: blockhash,
          instructions: sellData.instructions,
        }).compileToV0Message([lookupTableAccount]);

        const versionedTx = new VersionedTransaction(message);
        const txSize = versionedTx.serialize().length;
        
        if (txSize > TX_SETTINGS.MAX_TX_SIZE) {
          continue;
        }

        try {
          versionedTx.sign(sellData.signers);
          allSignatures.push(bs58.encode(versionedTx.signatures[0]));
          
          // Simulate transaction
          const simResult = await connection.simulateTransaction(versionedTx, {
            commitment: "processed",
            sigVerify: false,
            replaceRecentBlockhash: true
          });

          if (simResult.value.err) {
            continue;
          }

          bundledTxns.push(versionedTx);
          
        } catch (error) {
          console.error("TX build error:", error);
          continue;
        }
      }

      if (bundledTxns.length > 0) {
        allBundledTxns.push(bundledTxns);
      }
    }

    if (allBundledTxns.length === 0) {
      return {
        success: false,
        message: "❌ No valid bundles were built!"
      };
    }

    // Send bundles
    const bundleResults = await Promise.allSettled(
      allBundledTxns.map((bundledTxns, index) => 
        sendBundleWithRetry(bundledTxns, index + 1)
      )
    );

    let successCount = 0;
    let verifiedBundleId = null;
    
    for (const result of bundleResults) {
      if (result.status === 'fulfilled' && result.value.success) {
        const verified = await verifyBundleManually(result.value.bundledTxns!, result.value.bundleNumber);
        if (verified) {
          successCount++;
          verifiedBundleId = result.value.bundleId;
        }
      }
    }

    const message = successCount > 0 
      ? `✅ Sell operation completed! ${successCount}/${bundleResults.length} bundles verified.`
      : `❌ Sell operation failed. No bundles were verified.`;

    return {
      success: successCount > 0,
      message,
      transactions: allSignatures
    };

  } catch (error: any) {
    console.error("Pump.fun sell error:", error);
    return {
      success: false,
      message: `❌ Pump.fun sell failed: ${error.message || "Unknown error"}`
    };
  }
}

/**
 * Execute PumpSwap sell operation
 * @param userId User ID
 * @param mintAddress Token mint address
 * @param walletsWithTokens Wallets with tokens to sell
 * @param slippagePercent Slippage tolerance
 * @param jitoTipAmt Jito tip amount
 * @param lookupTableAccount Lookup table account
 * @returns Operation result
 */
async function executePumpSwapSell(
  userId: number,
  mintAddress: PublicKey,
  walletsWithTokens: WalletWithTokens[],
  slippagePercent: number,
  jitoTipAmt: number,
  lookupTableAccount: AddressLookupTableAccount
): Promise<{
  success: boolean,
  message: string,
  transactions?: string[]
}> {
  // PumpSwap implementation would go here
  // Similar structure to Pump.fun but with PumpSwap-specific accounts and instructions
  return {
    success: false,
    message: "❌ PumpSwap sell not yet implemented in multi-user version"
  };
}

/**
 * Build Pump.fun sell transaction
 * @param mintAddress Token mint address
 * @param walletData Wallet data with tokens to sell
 * @param bondingCurve Bonding curve address
 * @param associatedBondingCurve Associated bonding curve address
 * @param creatorVault Creator vault address
 * @param slippagePercent Slippage tolerance
 * @param jitoTipAmt Jito tip amount (0 if not last transaction)
 * @returns Transaction data or null if failed
 */
async function buildPumpFunSellTransaction(
  mintAddress: PublicKey,
  walletData: WalletWithTokens,
  bondingCurve: PublicKey,
  associatedBondingCurve: PublicKey,
  creatorVault: PublicKey,
  slippagePercent: number,
  jitoTipAmt: number
): Promise<{
  instructions: TransactionInstruction[],
  signers: Keypair[],
  payer: PublicKey
} | null> {
  try {
    const instructions: TransactionInstruction[] = [];
    const signers: Keypair[] = [walletData.keypair];

    // Compute budget
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 120000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150000 })
    );

    // Get token account
    const walletTokenATA = spl.getAssociatedTokenAddressSync(mintAddress, walletData.keypair.publicKey);

    // Calculate sell amounts
    const sellAmount = new BN(walletData.tokenBalance);
    const minSolOut = new BN(0); // Accept any amount of SOL (could add slippage calculation here)

    // Create sell instruction (using anchor program)
    const program = anchor.workspace.PumpFun;
    const sellIx = await (program.methods as any)
      .sell(sellAmount, minSolOut)
      .accounts({
        global: global,
        feeRecipient: feeRecipient,
        mint: mintAddress,
        bondingCurve: bondingCurve,
        associatedBondingCurve: associatedBondingCurve,
        associatedUser: walletTokenATA,
        user: walletData.keypair.publicKey,
        systemProgram: SystemProgram.programId,
        creatorVault: creatorVault,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
        eventAuthority: eventAuthority,
        program: PUMP_PROGRAM,
      })
      .instruction();

    instructions.push(sellIx);

    // Add Jito tip if specified
    if (jitoTipAmt > 0) {
      const tipInstruction = SystemProgram.transfer({
        fromPubkey: walletData.keypair.publicKey,
        toPubkey: getRandomTipAccount(),
        lamports: Math.floor(jitoTipAmt * LAMPORTS_PER_SOL),
      });
      instructions.push(tipInstruction);
    }

    return {
      instructions,
      signers,
      payer: walletData.keypair.publicKey
    };

  } catch (error) {
    console.error(`Error building sell transaction for ${walletData.walletName}:`, error);
    return null;
  }
}

/**
 * Send bundle with retry logic
 * @param bundledTxns Array of bundled transactions
 * @param bundleNumber Bundle number for logging
 * @returns Bundle result
 */
async function sendBundleWithRetry(
  bundledTxns: VersionedTransaction[], 
  bundleNumber: number
): Promise<ExtendedBundleResult> {
  try {
    const jitoBundle = new JitoBundle(bundledTxns, bundledTxns.length);
    const bundleResult = await searcherClient.sendBundle(jitoBundle);
    
    // Handle the Result<string, SearcherClientError> type
    let bundleId: string | null = null;
    if (bundleResult && typeof bundleResult === 'object' && 'value' in bundleResult) {
      bundleId = bundleResult.value;
    } else if (typeof bundleResult === 'string') {
      bundleId = bundleResult;
    }
    
    console.log(`📦 Bundle ${bundleNumber} sent: ${bundleId}`);
    
    // Wait and verify
    await sleep(10000); // Wait 10 seconds
    
    return {
      bundleId: bundleId,
      sent: true,
      verified: true, // Will be verified separately
      bundleNumber: bundleNumber,
      success: true,
      bundledTxns: bundledTxns
    };
    
  } catch (error) {
    console.error(`Bundle ${bundleNumber} error:`, error);
    return {
      bundleId: null,
      sent: false,
      verified: false,
      bundleNumber: bundleNumber,
      success: false,
      bundledTxns: bundledTxns
    };
  }
}

/**
 * Verify bundle manually via signature checks
 * @param bundledTxns Bundle transactions
 * @param bundleNumber Bundle number (for logging)
 * @returns Whether the bundle was verified
 */
async function verifyBundleManually(
  bundledTxns: VersionedTransaction[], 
  bundleNumber: number
): Promise<boolean> {
  try {
    let successCount = 0;
    
    for (let i = 0; i < bundledTxns.length; i++) {
      const signature = bs58.encode(bundledTxns[i].signatures[0]);
      
      try {
        const status = await connection.getSignatureStatus(signature, { 
          searchTransactionHistory: true 
        });
        
        if (status.value?.confirmationStatus && !status.value.err) {
          successCount++;
        }
      } catch (error) {
        // Ignore errors in status checks
      }
    }
    
    return successCount > 0;
    
  } catch (error) {
    console.error(`Bundle ${bundleNumber} verification error:`, error);
    return false;
  }
}

/**
 * Sells all tokens in all wallets from the given mint
 * @param userId User ID
 * @param mintAddress Token mint address
 * @param slippagePercent Slippage tolerance percentage
 * @param jitoTipAmt Jito tip amount in SOL
 * @returns Result of the operation
 */
export async function sellAll(
  userId: number,
  mintAddress: PublicKey | string,
  slippagePercent: number = 10,
  jitoTipAmt: number = 0.01
): Promise<{
  success: boolean,
  message: string,
  platform?: TokenPlatform,
  transactions?: string[]
}> {
  // Call unifiedSell with 100% sell percentage and ALL_WALLETS selection
  return unifiedSell(
    userId,
    mintAddress, 
    WalletSelectionMode.ALL_WALLETS, 
    100, // 100% - sell everything
    slippagePercent,
    jitoTipAmt
  );
}