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
import { loadKeypairs } from './keys';
import { getRandomTipAccount } from '../clients/config';
import { searcherClient } from '../clients/jito';
import { 
  WalletSelectionMode, 
  WalletWithSOL, 
  TokenPlatform, 
  WalletBalances,
  BundleResult 
} from '../shared/types';
import { loadPoolInfo, sleep } from '../shared/utils';
import { PUMPSWAP_PROGRAM_ID, WSOL_MINT, TX_SETTINGS } from '../shared/constants';

/**
 * Main unified buy function for both Pump.fun and PumpSwap
 * @param mintAddress Token mint address (if provided as string, will be converted to PublicKey)
 * @param selectionMode Wallet selection mode (which wallets to use)
 * @param totalSOL Total SOL amount to spend
 * @param slippagePercent Slippage tolerance percentage
 * @param jitoTipAmt Jito tip amount in SOL
 * @returns Result of the operation
 */
export async function unifiedBuy(
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

    // Load token info
    const poolInfo = loadPoolInfo();
    
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

    // Convert Jito tip from SOL to lamports
    const jitoTipLamports = Math.floor(jitoTipAmt * LAMPORTS_PER_SOL);

    // Get wallets with SOL distribution
    const walletsWithSOL = await getWalletsWithSOLDistribution(selectionMode, totalSOL);
    
    if (walletsWithSOL.length === 0) {
      return {
        success: false,
        message: "❌ No wallets found with sufficient SOL!"
      };
    }

    // Execute appropriate buy function based on platform
    if (platform === TokenPlatform.PUMP_FUN) {
      const result = await executePumpFunBuy(
        mintPk, 
        walletsWithSOL, 
        slippagePercent, 
        jitoTipLamports, 
        lookupTableAccount
      );
      
      return {
        success: result.success,
        message: result.message,
        platform: TokenPlatform.PUMP_FUN,
        transactions: result.transactions
      };
    } else {
      const result = await executePumpSwapBuy(
        mintPk, 
        walletsWithSOL, 
        slippagePercent, 
        jitoTipLamports, 
        lookupTableAccount
      );
      
      return {
        success: result.success,
        message: result.message,
        platform: TokenPlatform.PUMPSWAP,
        transactions: result.transactions
      };
    }
  } catch (error) {
    console.error("❌ Unified buy error:", error);
    
    return {
      success: false,
      message: `❌ Error: ${error.message || "Unknown error"}`
    };
  }
}

/**
 * Detect which platform the token is on (Pump.fun or PumpSwap)
 * @param mintAddress Token mint address
 * @returns Platform type or null if not found
 */
async function detectTokenPlatform(mintAddress: PublicKey): Promise<TokenPlatform | null> {
  try {
    // Check if token has Pump.fun bonding curve
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mintAddress.toBytes()], 
      PUMP_PROGRAM
    );
    
    const bondingCurveInfo = await connection.getAccountInfo(bondingCurve);
    
    if (bondingCurveInfo) {
      // Parse bonding curve to check if complete (migrated)
      const completeOffset = 8 + 8 + 8 + 8 + 8 + 8; // Skip to 'complete' field
      const isComplete = bondingCurveInfo.data[completeOffset] === 1;
      
      if (isComplete) {
        // Token migrated, check if PumpSwap pool exists
        const pumpSwapPool = await findPumpSwapPool(mintAddress);
        if (pumpSwapPool) {
          return TokenPlatform.PUMPSWAP;
        }
      } else {
        // Token still on bonding curve
        return TokenPlatform.PUMP_FUN;
      }
    }
    
    // If no bonding curve, check directly for PumpSwap pool
    const pumpSwapPool = await findPumpSwapPool(mintAddress);
    if (pumpSwapPool) {
      return TokenPlatform.PUMPSWAP;
    }
    
    return null;
  } catch (error) {
    console.error("Error detecting platform:", error);
    return null;
  }
}

/**
 * Find PumpSwap pool for token
 * @param mintAddress Token mint address
 * @returns Pool public key or null if not found
 */
async function findPumpSwapPool(mintAddress: PublicKey): Promise<PublicKey | null> {
  try {
    const pools = await connection.getProgramAccounts(PUMPSWAP_PROGRAM_ID, {
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: bs58.encode([241, 154, 109, 4, 17, 177, 109, 188])
          }
        },
        {
          memcmp: {
            offset: 8 + 1 + 2 + 32,
            bytes: mintAddress.toBase58()
          }
        }
      ]
    });

    return pools.length > 0 ? pools[0].pubkey : null;
  } catch (error) {
    return null;
  }
}

/**
 * Get wallet balances (SOL and wSOL)
 * @param keypair Wallet keypair
 * @param walletName Wallet name/label
 * @returns Wallet balances
 */
async function getWalletBalances(keypair: Keypair, walletName: string): Promise<WalletBalances> {
  try {
    // Get native SOL balance
    const nativeBalance = await connection.getBalance(keypair.publicKey);
    const nativeSOL = nativeBalance / LAMPORTS_PER_SOL;
    
    // Get wrapped SOL balance
    let wrappedSOL = 0;
    try {
      const wsolTokenAccount = spl.getAssociatedTokenAddressSync(WSOL_MINT, keypair.publicKey);
      const wsolBalance = await connection.getTokenAccountBalance(wsolTokenAccount);
      wrappedSOL = parseFloat(wsolBalance.value.uiAmountString || "0");
    } catch (error) {
      // No wSOL account or zero balance - this is fine
      wrappedSOL = 0;
    }
    
    const totalSOL = nativeSOL + wrappedSOL;
    
    return {
      keypair,
      walletName,
      nativeSOL,
      wrappedSOL,
      totalSOL
    };
  } catch (error) {
    console.log(`⚠️  Error checking balances for ${walletName}`);
    return {
      keypair,
      walletName,
      nativeSOL: 0,
      wrappedSOL: 0,
      totalSOL: 0
    };
  }
}

/**
 * Get wallets with SOL and create distribution
 * @param selectionMode Wallet selection mode
 * @param totalSOL Total SOL to distribute
 * @returns Wallets with SOL allocated
 */
async function getWalletsWithSOLDistribution(
  selectionMode: WalletSelectionMode, 
  totalSOL: number
): Promise<WalletWithSOL[]> {
  const walletsWithSOL: WalletWithSOL[] = [];
  const keypairs = loadKeypairs();
  
  // Step 1: Check both SOL and wSOL balances for all wallets
  const availableWallets: WalletBalances[] = [];
  
  // Check dev wallet (creator) if mode allows
  if (selectionMode === WalletSelectionMode.ALL_WALLETS || selectionMode === WalletSelectionMode.CREATOR_ONLY) {
    try {
      const balances = await getWalletBalances(wallet, "DEV WALLET (CREATOR)");
      if (balances.totalSOL > 0.01) {
        availableWallets.push(balances);
      }
    } catch (error) {
      console.error("Error checking DEV WALLET balance:", error);
    }
  }

  // Check bundle wallets if mode allows  
  if (selectionMode === WalletSelectionMode.ALL_WALLETS || selectionMode === WalletSelectionMode.BUNDLE_ONLY) {
    for (let i = 0; i < keypairs.length; i++) {
      const keypair = keypairs[i];
      try {
        const balances = await getWalletBalances(keypair, `Wallet ${i + 1} (BUNDLE)`);
        
        if (balances.totalSOL > 0.01) {
          availableWallets.push(balances);
        }
      } catch (error) {
        console.error(`Error checking Wallet ${i + 1} balance:`, error);
      }
    }
  }

  if (availableWallets.length === 0) {
    return [];
  }

  // Step 2: Calculate total available SOL+wSOL
  const totalAvailableSOL = availableWallets.reduce((sum, w) => sum + w.totalSOL, 0);
  
  if (totalSOL > totalAvailableSOL * 0.95) { // Leave 5% buffer for fees
    return [];
  }

  // Step 3: Create randomized distribution
  const baseAllocation = totalSOL / availableWallets.length;
  let remainingSOL = totalSOL;
  let processedWallets = 0;

  for (const wallet of availableWallets) {
    processedWallets++;
    const isLastWallet = processedWallets === availableWallets.length;
    
    let allocatedSOL: number;
    
    if (isLastWallet) {
      // Last wallet gets all remaining SOL
      allocatedSOL = remainingSOL;
    } else {
      // Random allocation ±30%
      const randomFactor = 0.7 + Math.random() * 0.6; // 0.7 to 1.3 (±30%)
      let randomAllocation = baseAllocation * randomFactor;
      
      // Cap at wallet's available SOL+wSOL (minus 0.02 SOL for fees)
      const maxAllocation = Math.min(wallet.totalSOL - 0.02, remainingSOL * 0.8);
      allocatedSOL = Math.min(randomAllocation, maxAllocation);
      
      // Ensure minimum allocation
      allocatedSOL = Math.max(allocatedSOL, 0.01);
    }

    // Final validation
    if (allocatedSOL > wallet.totalSOL - 0.02) {
      allocatedSOL = wallet.totalSOL - 0.02;
    }

    if (allocatedSOL > 0.01) {
      walletsWithSOL.push({
        keypair: wallet.keypair,
        solBalance: wallet.totalSOL,
        allocatedSOL: allocatedSOL,
        walletName: wallet.walletName
      });

      remainingSOL -= allocatedSOL;
    }
  }

  return walletsWithSOL;
}

/**
 * Execute Pump.fun buy
 * @param mintAddress Token mint address
 * @param walletsWithSOL Wallets with SOL
 * @param slippagePercent Slippage tolerance percentage
 * @param jitoTipAmt Jito tip amount in lamports
 * @param lookupTableAccount Lookup table account
 * @returns Result of the operation
 */
async function executePumpFunBuy(
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
    // Setup Anchor
    const provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(wallet),
      { commitment: "confirmed" }
    );

    // Load IDL from file (relative to the current working directory)
    const idlPath = "./pumpfun-IDL.json"; 
    if (!fs.existsSync(idlPath)) {
      return {
        success: false,
        message: "❌ Missing pumpfun-IDL.json file!"
      };
    }

    const IDL_PumpFun = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
    const program = new anchor.Program(IDL_PumpFun, provider);

    // Pre-calculate PDAs
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mintAddress.toBytes()], 
      PUMP_PROGRAM
    );
    const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
      [bondingCurve.toBytes(), spl.TOKEN_PROGRAM_ID.toBytes(), mintAddress.toBytes()],
      spl.ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), wallet.publicKey.toBytes()], 
      PUMP_PROGRAM
    );

    // Build transactions
    const bundledTxns: VersionedTransaction[] = [];
    const { blockhash } = await connection.getLatestBlockhash();

    // Group wallets (5 per transaction for Pump.fun)
    const WALLETS_PER_TX = TX_SETTINGS.WALLETS_PER_TX_PUMPFUN;
    const walletChunks: WalletWithSOL[][] = [];
    
    for (let i = 0; i < walletsWithSOL.length; i += WALLETS_PER_TX) {
      walletChunks.push(walletsWithSOL.slice(i, i + WALLETS_PER_TX));
    }

    for (let chunkIndex = 0; chunkIndex < walletChunks.length; chunkIndex++) {
      const chunk = walletChunks[chunkIndex];
      const isLastChunk = chunkIndex === walletChunks.length - 1;
      
      const buyTxIxs: TransactionInstruction[] = [];
      
      // Compute budget for multiple buys
      buyTxIxs.push(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 + (chunk.length * 120000) }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150000 })
      );

      const signers: Keypair[] = [payer];

      // Add buy instructions for each wallet
      for (const walletData of chunk) {
        const solAmount = Math.floor(walletData.allocatedSOL * LAMPORTS_PER_SOL);
        if (solAmount <= 0) continue;

        const walletTokenATA = spl.getAssociatedTokenAddressSync(mintAddress, walletData.keypair.publicKey);

        // Create token account instruction
        const createATAIx = spl.createAssociatedTokenAccountIdempotentInstruction(
          walletData.keypair.publicKey,
          walletTokenATA,
          walletData.keypair.publicKey,
          mintAddress
        );
        buyTxIxs.push(createATAIx);

        // Calculate minimum tokens with slippage
        const estimatedTokens = await estimatePumpFunTokensOut(mintAddress, new BN(solAmount));
        const minTokensOut = estimatedTokens.muln(100 - slippagePercent).divn(100);

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
            creatorVault: creatorVault,
            eventAuthority: eventAuthority,
            program: PUMP_PROGRAM,
          })
          .instruction();

        buyTxIxs.push(buyIx);
        signers.push(walletData.keypair);
      }

      // Add Jito tip to last transaction
      if (isLastChunk) {
        buyTxIxs.push(
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: getRandomTipAccount(),
            lamports: BigInt(jitoTipAmt),
          })
        );
      }

      // Build transaction
      const message = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions: buyTxIxs,
      }).compileToV0Message([lookupTableAccount]);

      const versionedTx = new VersionedTransaction(message);
      
      const txSize = versionedTx.serialize().length;
      if (txSize > TX_SETTINGS.MAX_TX_SIZE) {
        continue; // Skip this transaction if it's too large
      }

      versionedTx.sign(signers);
      bundledTxns.push(versionedTx);
    }

    if (bundledTxns.length === 0) {
      return {
        success: false,
        message: "❌ No valid transactions built!"
      };
    }

    // Send bundle
    const result = await sendBundleAndVerify([bundledTxns]);
    const signatures = bundledTxns.map(tx => bs58.encode(tx.signatures[0]));
    
    return {
      success: result.verified,
      message: result.verified ? 
        `✅ Pump.fun buy successful! Bundle ID: ${result.bundleId}` : 
        "❌ Failed to verify bundle",
      transactions: signatures
    };
  } catch (error) {
    console.error("❌ Pump.fun buy error:", error);
    return {
      success: false,
      message: `❌ Error: ${error.message || "Unknown error"}`
    };
  }
}

/**
 * Execute PumpSwap buy
 * @param mintAddress Token mint address
 * @param walletsWithSOL Wallets with SOL
 * @param slippagePercent Slippage tolerance percentage
 * @param jitoTipAmt Jito tip amount in lamports
 * @param lookupTableAccount Lookup table account
 * @returns Result of the operation
 */
async function executePumpSwapBuy(
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
    // Load PumpSwap IDL from file (relative to the current working directory)
    const idlPath = "./pumpswap-IDL.json";
    if (!fs.existsSync(idlPath)) {
      return {
        success: false,
        message: "❌ Missing pumpswap-IDL.json file!"
      };
    }

    const PUMPSWAP_IDL = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
    const provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(wallet),
      { commitment: "confirmed" }
    );
    const program = new anchor.Program(PUMPSWAP_IDL, provider);

    // Find pool
    const poolAddress = await findPumpSwapPool(mintAddress);
    if (!poolAddress) {
      return {
        success: false,
        message: "❌ PumpSwap pool not found!"
      };
    }

    // Create smart bundles (3 wallets per TX for PumpSwap)
    const bundles = createSmartBundles(walletsWithSOL);
    const allBundledTxns: VersionedTransaction[][] = [];
    const allSignatures: string[] = [];

    // Build all bundles
    for (let bundleIndex = 0; bundleIndex < bundles.length; bundleIndex++) {
      const bundleWallets = bundles[bundleIndex];
      const bundleNumber = bundleIndex + 1;
      
      const bundledTxns: VersionedTransaction[] = [];
      const { blockhash } = await connection.getLatestBlockhash();
      
      // Group wallets into transactions (3 wallets per tx)
      const WALLETS_PER_TX = TX_SETTINGS.WALLETS_PER_TX_PUMPSWAP;
      const walletChunks: WalletWithSOL[][] = [];
      
      for (let i = 0; i < bundleWallets.length; i += WALLETS_PER_TX) {
        walletChunks.push(bundleWallets.slice(i, i + WALLETS_PER_TX));
      }

      // Build each transaction
      for (let txIndex = 0; txIndex < walletChunks.length; txIndex++) {
        const walletChunk = walletChunks[txIndex];
        const isLastTxInBundle = txIndex === walletChunks.length - 1;
        
        const buyData = await buildPumpSwapBuyInstructions(
          program,
          walletChunk,
          mintAddress,
          poolAddress,
          slippagePercent
        );
        
        if (!buyData) {
          continue;
        }

        const txInstructions = [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 + (walletChunk.length * 150000) }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }),
          ...buyData.instructions
        ];

        // Add Jito tip to last TX of each bundle
        if (isLastTxInBundle) {
          txInstructions.push(
            SystemProgram.transfer({
              fromPubkey: buyData.payer,
              toPubkey: getRandomTipAccount(),
              lamports: BigInt(jitoTipAmt),
            })
          );
        }

        const message = new TransactionMessage({
          payerKey: buyData.payer,
          recentBlockhash: blockhash,
          instructions: txInstructions,
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
    let overallSuccess = true;
    let bundleResults: BundleResult[] = [];
    
    for (const bundle of allBundledTxns) {
      const result = await sendBundleAndVerify([bundle]);
      bundleResults.push(result);
      if (!result.verified) {
        overallSuccess = false;
      }
    }
    
    const successCount = bundleResults.filter(r => r.verified).length;
    
    return {
      success: overallSuccess,
      message: `${successCount}/${bundleResults.length} PumpSwap buy bundles successful!`,
      transactions: allSignatures
    };
  } catch (error) {
    console.error("❌ PumpSwap buy error:", error);
    return {
      success: false,
      message: `❌ Error: ${error.message || "Unknown error"}`
    };
  }
}

/**
 * Create smart bundles for PumpSwap
 * @param walletsWithSOL Wallets with SOL
 * @returns Wallet chunks for bundles
 */
function createSmartBundles(walletsWithSOL: WalletWithSOL[]): WalletWithSOL[][] {
  const MAX_BUYS_PER_BUNDLE = 15;
  
  if (walletsWithSOL.length <= MAX_BUYS_PER_BUNDLE) {
    return [walletsWithSOL];
  } else {
    // Split into multiple bundles
    const mid = Math.ceil(walletsWithSOL.length / 2);
    return [
      walletsWithSOL.slice(0, mid),
      walletsWithSOL.slice(mid)
    ];
  }
}

/**
 * Build PumpSwap buy instructions
 * @param program Anchor program
 * @param walletsData Wallets with SOL data
 * @param mintAddress Token mint address
 * @param poolAddress Pool address
 * @param slippagePercent Slippage tolerance percentage
 * @returns Instructions, payer, and signers
 */
async function buildPumpSwapBuyInstructions(
  program: anchor.Program,
  walletsData: WalletWithSOL[],
  mintAddress: PublicKey,
  poolAddress: PublicKey,
  slippagePercent: number
): Promise<{
  instructions: TransactionInstruction[];
  payer: PublicKey;
  signers: Keypair[];
} | null> {
  try {
    const instructions: TransactionInstruction[] = [];
    const signers: Keypair[] = [];
    
    // Get shared accounts
    const coinCreator = await getPoolCoinCreator(poolAddress);
    if (!coinCreator) return null;

    const protocolFeeRecipients = await getProtocolFeeRecipients();
    if (protocolFeeRecipients.length === 0) return null;
    
    const protocolFeeRecipient = protocolFeeRecipients[0];
    const [protocolFeeRecipientTokenAccount] = PublicKey.findProgramAddressSync(
      [protocolFeeRecipient.toBytes(), spl.TOKEN_PROGRAM_ID.toBytes(), WSOL_MINT.toBytes()],
      spl.ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Shared PDAs
    const [poolBaseTokenAccount] = PublicKey.findProgramAddressSync(
      [poolAddress.toBytes(), spl.TOKEN_PROGRAM_ID.toBytes(), mintAddress.toBytes()],
      spl.ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const [poolQuoteTokenAccount] = PublicKey.findProgramAddressSync(
      [poolAddress.toBytes(), spl.TOKEN_PROGRAM_ID.toBytes(), WSOL_MINT.toBytes()],
      spl.ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const [coinCreatorVaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator_vault"), coinCreator.toBytes()],
      PUMPSWAP_PROGRAM_ID
    );
    const [coinCreatorVaultAta] = PublicKey.findProgramAddressSync(
      [coinCreatorVaultAuthority.toBytes(), spl.TOKEN_PROGRAM_ID.toBytes(), WSOL_MINT.toBytes()],
      spl.ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const [eventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      PUMPSWAP_PROGRAM_ID
    );
    const [globalConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_config")],
      PUMPSWAP_PROGRAM_ID
    );

    const payerWallet = walletsData[0].keypair;

    // Build instructions for each wallet
    for (const walletData of walletsData) {
      const solAmount = Math.floor(walletData.allocatedSOL * LAMPORTS_PER_SOL);
      
      // Get wallet's current balances to determine wrap/unwrap strategy
      const balances = await getWalletBalances(walletData.keypair, walletData.walletName);
      const neededSOL = walletData.allocatedSOL;
      const availableNativeSOL = balances.nativeSOL - 0.01; // Reserve for fees
      const availableWrappedSOL = balances.wrappedSOL;
      
      const userBaseTokenAccount = spl.getAssociatedTokenAddressSync(mintAddress, walletData.keypair.publicKey);
      const userQuoteTokenAccount = spl.getAssociatedTokenAddressSync(WSOL_MINT, walletData.keypair.publicKey);

      // Create token accounts
      const createBaseTokenAccountIx = spl.createAssociatedTokenAccountIdempotentInstruction(
        payerWallet.publicKey,
        userBaseTokenAccount,
        walletData.keypair.publicKey,
        mintAddress
      );
      instructions.push(createBaseTokenAccountIx);

      const createWSOLIx = spl.createAssociatedTokenAccountIdempotentInstruction(
        payerWallet.publicKey,
        userQuoteTokenAccount,
        walletData.keypair.publicKey,
        WSOL_MINT
      );
      instructions.push(createWSOLIx);

      // Smart wrapping strategy based on available balances
      if (availableWrappedSOL >= neededSOL) {
        // Case 1: Enough wSOL already - use it directly
      } else if (availableNativeSOL >= neededSOL) {
        // Case 2: Enough native SOL - wrap what we need
        const wrapSOLIx = SystemProgram.transfer({
          fromPubkey: walletData.keypair.publicKey,
          toPubkey: userQuoteTokenAccount,
          lamports: solAmount
        });
        instructions.push(wrapSOLIx);

        const syncNativeIx = spl.createSyncNativeInstruction(userQuoteTokenAccount);
        instructions.push(syncNativeIx);
      } else {
        // Case 3: Need to combine both - use all wSOL + wrap some native SOL
        const additionalWrapNeeded = neededSOL - availableWrappedSOL;
        
        if (additionalWrapNeeded > 0 && availableNativeSOL >= additionalWrapNeeded) {
          const wrapSOLIx = SystemProgram.transfer({
            fromPubkey: walletData.keypair.publicKey,
            toPubkey: userQuoteTokenAccount,
            lamports: Math.floor(additionalWrapNeeded * LAMPORTS_PER_SOL)
          });
          instructions.push(wrapSOLIx);

          const syncNativeIx = spl.createSyncNativeInstruction(userQuoteTokenAccount);
          instructions.push(syncNativeIx);
        } else {
          continue; // Skip this wallet if not enough combined funds
        }
      }

      const expectedTokensOut = await getExpectedTokensOut(poolAddress, new BN(solAmount), mintAddress);
      const minTokensOut = expectedTokensOut.muln(100 - slippagePercent).divn(100);

      const buyIx = await program.methods
        .buy(minTokensOut, new BN(solAmount))
        .accounts({
          pool: poolAddress,
          user: walletData.keypair.publicKey,
          globalConfig: globalConfig,
          baseMint: mintAddress,
          quoteMint: WSOL_MINT,
          userBaseTokenAccount: userBaseTokenAccount,
          userQuoteTokenAccount: userQuoteTokenAccount,
          poolBaseTokenAccount: poolBaseTokenAccount,
          poolQuoteTokenAccount: poolQuoteTokenAccount,
          protocolFeeRecipient: protocolFeeRecipient,
          protocolFeeRecipientTokenAccount: protocolFeeRecipientTokenAccount,
          baseTokenProgram: spl.TOKEN_PROGRAM_ID,
          quoteTokenProgram: spl.TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
          eventAuthority: eventAuthority,
          program: PUMPSWAP_PROGRAM_ID,
          coinCreatorVaultAta: coinCreatorVaultAta,
          coinCreatorVaultAuthority: coinCreatorVaultAuthority,
        })
        .instruction();

      instructions.push(buyIx);
      
      if (!walletData.keypair.publicKey.equals(payerWallet.publicKey)) {
        signers.push(walletData.keypair);
      }
    }

    signers.unshift(payerWallet);
    
    return { instructions, payer: payerWallet.publicKey, signers };

  } catch (error) {
    console.error("Error building PumpSwap buy instructions:", error);
    return null;
  }
}

/**
 * Estimate tokens out for Pump.fun
 * @param mintAddress Token mint address
 * @param solAmount SOL amount in lamports
 * @returns Estimated token amount
 */
async function estimatePumpFunTokensOut(mintAddress: PublicKey, solAmount: BN): Promise<BN> {
  try {
    // Get bonding curve data
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mintAddress.toBytes()], 
      PUMP_PROGRAM
    );
    
    const bondingCurveInfo = await connection.getAccountInfo(bondingCurve);
    if (!bondingCurveInfo) {
      return new BN(1000000); // Fallback
    }

    // Parse bonding curve data
    const data = bondingCurveInfo.data;
    const virtualTokenReserves = new BN(data.subarray(8, 16), 'le');
    const virtualSolReserves = new BN(data.subarray(16, 24), 'le');

    // Simple bonding curve calculation
    const k = virtualTokenReserves.mul(virtualSolReserves);
    const newSolReserves = virtualSolReserves.add(solAmount);
    const newTokenReserves = k.div(newSolReserves);
    const tokensOut = virtualTokenReserves.sub(newTokenReserves);

    return tokensOut;
  } catch (error) {
    return new BN(1000000); // Fallback
  }
}

/**
 * Get expected tokens out for PumpSwap
 * @param poolAddress Pool address
 * @param solAmount SOL amount in lamports
 * @param baseMint Base mint (token mint)
 * @returns Expected token amount
 */
async function getExpectedTokensOut(
  poolAddress: PublicKey, 
  solAmount: BN, 
  baseMint: PublicKey
): Promise<BN> {
  try {
    const poolBaseTokenAccount = PublicKey.findProgramAddressSync(
      [poolAddress.toBytes(), spl.TOKEN_PROGRAM_ID.toBytes(), baseMint.toBytes()],
      spl.ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
    
    const poolQuoteTokenAccount = PublicKey.findProgramAddressSync(
      [poolAddress.toBytes(), spl.TOKEN_PROGRAM_ID.toBytes(), WSOL_MINT.toBytes()],
      spl.ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];

    const baseReserveInfo = await connection.getTokenAccountBalance(poolBaseTokenAccount);
    const quoteReserveInfo = await connection.getTokenAccountBalance(poolQuoteTokenAccount);
    
    const baseReserve = new BN(baseReserveInfo.value.amount);
    const quoteReserve = new BN(quoteReserveInfo.value.amount);

    // AMM calculation: x * y = k
    const k = baseReserve.mul(quoteReserve);
    const newQuoteReserve = quoteReserve.add(solAmount);
    const newBaseReserve = k.div(newQuoteReserve);
    const tokensOut = baseReserve.sub(newBaseReserve);
    
    return tokensOut;
    
  } catch (error) {
    return new BN(1000000); // Fallback
  }
}

/**
 * Get protocol fee recipients for PumpSwap
 * @returns Array of protocol fee recipient public keys
 */
async function getProtocolFeeRecipients(): Promise<PublicKey[]> {
  try {
    const [globalConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_config")],
      PUMPSWAP_PROGRAM_ID
    );

    const globalConfigInfo = await connection.getAccountInfo(globalConfig);
    if (!globalConfigInfo) return [];

    const data = globalConfigInfo.data;
    const protocolFeeRecipientsOffset = 8 + 32 + 8 + 8 + 1; 
    const protocolFeeRecipients: PublicKey[] = [];
    
    for (let i = 0; i < 8; i++) {
      const recipientOffset = protocolFeeRecipientsOffset + (i * 32);
      const recipientBytes = data.slice(recipientOffset, recipientOffset + 32);
      const recipient = new PublicKey(recipientBytes);
      
      if (!recipient.equals(PublicKey.default)) {
        protocolFeeRecipients.push(recipient);
      }
    }
    
    return protocolFeeRecipients;
    
  } catch (error) {
    return [];
  }
}

/**
 * Get pool coin creator for PumpSwap
 * @param poolAddress Pool address
 * @returns Coin creator public key or null
 */
async function getPoolCoinCreator(poolAddress: PublicKey): Promise<PublicKey | null> {
  try {
    const poolAccountInfo = await connection.getAccountInfo(poolAddress);
    if (!poolAccountInfo) return null;

    const coinCreatorOffset = 8 + 1 + 2 + 32 + 32 + 32 + 32 + 32 + 32 + 8;
    const coinCreatorBytes = poolAccountInfo.data.slice(coinCreatorOffset, coinCreatorOffset + 32);
    
    return new PublicKey(coinCreatorBytes);
  } catch (error) {
    return null;
  }
}

/**
 * Send bundle and verify results
 * @param bundlesList List of bundles (arrays of transactions)
 * @returns Bundle result
 */
async function sendBundleAndVerify(bundlesList: VersionedTransaction[][]): Promise<BundleResult> {
  try {
    if (bundlesList.length === 1) {
      // Single bundle
      const bundledTxns = bundlesList[0];
      
      if (!searcherClient) {
        throw new Error("Searcher client is not initialized");
      }
      const bundleId = await searcherClient.sendBundle(new JitoBundle(bundledTxns, bundledTxns.length));
      const bundleIdString = bundleId.toString();
      
      // Wait and verify
      await sleep(10000); // Wait 10 seconds
      
      const success = await verifyBundleManually(bundledTxns, 1);
      
      return {
        bundleId: bundleIdString,
        sent: true,
        verified: success,
        bundleNumber: 1
      };
      
    } else {
      // Multiple bundles - send simultaneously
      const bundlePromises = bundlesList.map(async (bundledTxns, index) => {
        const bundleNumber = index + 1;
        
        try {
          if (!searcherClient) {
            throw new Error("Searcher client is not initialized");
          }
          const bundleId = await searcherClient.sendBundle(new JitoBundle(bundledTxns, bundledTxns.length));
          const bundleIdString = bundleId.toString();
          return { bundleNumber, success: true, bundledTxns, bundleId: bundleIdString };
        } catch (error) {
          console.error(`Bundle ${bundleNumber} failed:`, error);
          return { bundleNumber, success: false, bundledTxns, bundleId: null };
        }
      });
      
      const results = await Promise.allSettled(bundlePromises);
      
      // Wait and verify all bundles
      await sleep(10000); // Wait 10 seconds
      
      let successCount = 0;
      let verifiedBundleId = null;
      
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success) {
          const verified = await verifyBundleManually(result.value.bundledTxns, result.value.bundleNumber);
          if (verified) {
            successCount++;
            verifiedBundleId = result.value.bundleId;
          }
        }
      }
      
      return {
        bundleId: verifiedBundleId,
        sent: true,
        verified: successCount > 0,
        bundleNumber: successCount
      };
    }
    
  } catch (error) {
    console.error("Bundle error:", error);
    return {
      bundleId: null,
      sent: false,
      verified: false,
      bundleNumber: 0
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