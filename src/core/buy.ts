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
  WalletWithSOL, 
  TokenPlatform, 
  WalletBalances,
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
 * Main unified buy function for both Pump.fun and PumpSwap
 * @param userId Telegram user ID
 * @param mintAddress Token mint address (if provided as string, will be converted to PublicKey)
 * @param selectionMode Wallet selection mode (which wallets to use)
 * @param totalSOL Total SOL amount to spend
 * @param slippagePercent Slippage tolerance percentage
 * @param jitoTipAmt Jito tip amount in SOL
 * @returns Result of the operation
 */
export async function unifiedBuy(
  userId: number,
  mintAddress: PublicKey | string, 
  selectionMode: WalletSelectionMode,
  totalSOL: number,
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

    // Load user-specific token info
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

    // Get wallets with SOL based on selection mode
    const walletsWithSOL = await getWalletsWithSOL(userId, selectionMode, totalSOL);
    
    if (walletsWithSOL.length === 0) {
      return {
        success: false,
        message: "❌ No wallets with sufficient SOL found!"
      };
    }

    console.log(`💰 Using ${walletsWithSOL.length} wallets for buying`);

    // Execute buy based on platform
    let result;
    if (platform === TokenPlatform.PUMP_FUN) {
      result = await executePumpFunBuy(userId, mintPk, walletsWithSOL, slippagePercent, jitoTipAmt, lookupTableAccount);
    } else {
      result = await executePumpSwapBuy(userId, mintPk, walletsWithSOL, slippagePercent, jitoTipAmt, lookupTableAccount);
    }

    return {
      success: result.success,
      message: result.message,
      platform: platform,
      transactions: result.transactions
    };

  } catch (error: any) {
    console.error("Buy operation error:", error);
    return {
      success: false,
      message: `❌ Buy operation failed: ${error.message || "Unknown error"}`
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
 * Get wallets with SOL based on selection mode
 * @param userId User ID
 * @param selectionMode Wallet selection mode
 * @param totalSOL Total SOL to distribute
 * @returns Array of wallets with allocated SOL
 */
async function getWalletsWithSOL(
  userId: number,
  selectionMode: WalletSelectionMode, 
  totalSOL: number
): Promise<WalletWithSOL[]> {
  const keypairs = loadUserKeypairs(userId);
  const walletsWithSOL: WalletWithSOL[] = [];

  // Determine which wallets to include
  let walletsToUse: Keypair[] = [];
  
  switch (selectionMode) {
    case WalletSelectionMode.ALL_WALLETS:
      walletsToUse = [wallet, ...keypairs]; // Include creator + bundle wallets
      break;
    case WalletSelectionMode.BUNDLE_ONLY:
      walletsToUse = keypairs; // Only bundle wallets
      break;
    case WalletSelectionMode.CREATOR_ONLY:
      walletsToUse = [wallet]; // Only creator wallet
      break;
  }

  // Check balances and allocate SOL
  const validWallets: WalletWithSOL[] = [];
  
  for (let i = 0; i < walletsToUse.length; i++) {
    const keypair = walletsToUse[i];
    
    try {
      const balance = await connection.getBalance(keypair.publicKey);
      const solBalance = balance / LAMPORTS_PER_SOL;
      
      // Only include wallets with sufficient balance (0.01 SOL minimum)
      if (solBalance >= 0.01) {
        const isCreator = keypair.publicKey.equals(wallet.publicKey);
        const walletName = isCreator ? "CREATOR" : `WALLET ${i}`;
        
        validWallets.push({
          keypair,
          solBalance,
          allocatedSOL: 0, // Will be calculated below
          walletName
        });
      }
    } catch (error) {
      console.error(`Error checking balance for wallet ${i}:`, error);
    }
  }

  if (validWallets.length === 0) {
    return [];
  }

  // Distribute SOL among valid wallets
  const solPerWallet = totalSOL / validWallets.length;
  
  for (const walletData of validWallets) {
    // Ensure wallet has enough SOL for allocation + gas
    const maxUsable = Math.max(0, walletData.solBalance - 0.01); // Reserve 0.01 for gas
    const allocation = Math.min(solPerWallet, maxUsable);
    
    if (allocation > 0) {
      walletData.allocatedSOL = allocation;
      walletsWithSOL.push(walletData);
    }
  }

  return walletsWithSOL;
}

/**
 * Execute Pump.fun buy operation
 * @param userId User ID
 * @param mintAddress Token mint address
 * @param walletsWithSOL Wallets with allocated SOL
 * @param slippagePercent Slippage tolerance
 * @param jitoTipAmt Jito tip amount
 * @param lookupTableAccount Lookup table account
 * @returns Operation result
 */
async function executePumpFunBuy(
  userId: number,
  mintAddress: PublicKey,
  walletsWithSOL: WalletWithSOL[],
  slippagePercent: number,
  jitoTipAmt: number,
  lookupTableAccount: AddressLookupTableAccount
): Promise<{
  success: boolean,
  message: string,
  transactions?: string[]
}> {
  try {
    console.log("🔥 Executing Pump.fun buy operation");

    // Get Pump.fun accounts
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mintAddress.toBytes()], 
      PUMP_PROGRAM
    );

    const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
      [bondingCurve.toBytes(), spl.TOKEN_PROGRAM_ID.toBytes(), mintAddress.toBytes()],
      spl.ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Build buy transactions
    const allBundledTxns: VersionedTransaction[][] = [];
    const allSignatures: string[] = [];

    // Process wallets in chunks
    const chunkSize = 4; // Adjust based on transaction size limits
    const walletChunks = [];
    for (let i = 0; i < walletsWithSOL.length; i += chunkSize) {
      walletChunks.push(walletsWithSOL.slice(i, i + chunkSize));
    }

    const { blockhash } = await connection.getLatestBlockhash();

    for (let chunkIndex = 0; chunkIndex < walletChunks.length; chunkIndex++) {
      const chunk = walletChunks[chunkIndex];
      const bundledTxns: VersionedTransaction[] = [];

      for (const walletData of chunk) {
        const buyData = await buildPumpFunBuyTransaction(
          mintAddress,
          walletData,
          bondingCurve,
          associatedBondingCurve,
          slippagePercent,
          chunkIndex === walletChunks.length - 1 ? jitoTipAmt : 0 // Only tip on last chunk
        );

        if (!buyData) continue;

        const message = new TransactionMessage({
          payerKey: buyData.payer,
          recentBlockhash: blockhash,
          instructions: buyData.instructions,
        }).compileToV0Message([lookupTableAccount]);

        const versionedTx = new VersionedTransaction(message);
        const txSize = versionedTx.serialize().length;
        
        if (txSize > TX_SETTINGS.MAX_TX_SIZE) {
          continue;
        }

        try {
          versionedTx.sign(buyData.signers);
          
          // Store signature
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
      ? `✅ Buy operation completed! ${successCount}/${bundleResults.length} bundles verified.`
      : `❌ Buy operation failed. No bundles were verified.`;

    return {
      success: successCount > 0,
      message,
      transactions: allSignatures
    };

  } catch (error: any) {
    console.error("Pump.fun buy error:", error);
    return {
      success: false,
      message: `❌ Pump.fun buy failed: ${error.message || "Unknown error"}`
    };
  }
}

/**
 * Execute PumpSwap buy operation
 * @param userId User ID
 * @param mintAddress Token mint address
 * @param walletsWithSOL Wallets with allocated SOL
 * @param slippagePercent Slippage tolerance
 * @param jitoTipAmt Jito tip amount
 * @param lookupTableAccount Lookup table account
 * @returns Operation result
 */
async function executePumpSwapBuy(
  userId: number,
  mintAddress: PublicKey,
  walletsWithSOL: WalletWithSOL[],
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
    message: "❌ PumpSwap buy not yet implemented in multi-user version"
  };
}

/**
 * Build Pump.fun buy transaction
 * @param mintAddress Token mint address
 * @param walletData Wallet data with allocated SOL
 * @param bondingCurve Bonding curve address
 * @param associatedBondingCurve Associated bonding curve address
 * @param slippagePercent Slippage tolerance
 * @param jitoTipAmt Jito tip amount (0 if not last transaction)
 * @returns Transaction data or null if failed
 */
async function buildPumpFunBuyTransaction(
  mintAddress: PublicKey,
  walletData: WalletWithSOL,
  bondingCurve: PublicKey,
  associatedBondingCurve: PublicKey,
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

    // Create token account
    const walletTokenATA = spl.getAssociatedTokenAddressSync(mintAddress, walletData.keypair.publicKey);
    
    const createATAIx = spl.createAssociatedTokenAccountIdempotentInstruction(
      walletData.keypair.publicKey,
      walletTokenATA,
      walletData.keypair.publicKey,
      mintAddress
    );
    instructions.push(createATAIx);

    // Calculate buy amounts
    const solAmount = Math.floor(walletData.allocatedSOL * LAMPORTS_PER_SOL);
    const estimatedTokens = await estimatePumpFunTokensOut(mintAddress, new BN(solAmount));
    const minTokensOut = estimatedTokens.muln(100 - slippagePercent).divn(100);

    // Create buy instruction (using anchor program)
    const program = anchor.workspace.PumpFun;
    const buyIx = await (program.methods as any)
      .buy(minTokensOut, new BN(solAmount))
      .accounts({
        global: global,
        feeRecipient: feeRecipient,
        mint: mintAddress,
        bondingCurve: bondingCurve,
        associatedBondingCurve: associatedBondingCurve,
        associatedUser: walletTokenATA,
        user: walletData.keypair.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        eventAuthority: eventAuthority,
        program: PUMP_PROGRAM,
      })
      .instruction();

    instructions.push(buyIx);

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
    console.error(`Error building buy transaction for ${walletData.walletName}:`, error);
    return null;
  }
}

/**
 * Estimate tokens out for Pump.fun buy
 * @param mintAddress Token mint address
 * @param solAmountIn SOL amount in lamports
 * @returns Estimated tokens out
 */
async function estimatePumpFunTokensOut(mintAddress: PublicKey, solAmountIn: BN): Promise<BN> {
  try {
    // This would need to implement the actual Pump.fun bonding curve calculation
    // For now, return a simple estimation
    const tokensPerSOL = new BN(1000000); // 1M tokens per SOL (example)
    return solAmountIn.mul(tokensPerSOL).div(new BN(LAMPORTS_PER_SOL));
  } catch (error) {
    console.error("Token estimation error:", error);
    return new BN(0);
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