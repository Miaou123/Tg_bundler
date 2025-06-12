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
  WalletWithTokens, 
  TokenPlatform,
  BundleResult
} from '../shared/types';
import { loadPoolInfo, sleep } from '../shared/utils';
import { PUMPSWAP_PROGRAM_ID, WSOL_MINT, TX_SETTINGS } from '../shared/constants';

/**
 * Main unified sell function for both Pump.fun and PumpSwap
 * @param mintAddress Token mint address (if provided as string, will be converted to PublicKey)
 * @param selectionMode Wallet selection mode (which wallets to use)
 * @param sellPercentage Percentage of tokens to sell (0-100)
 * @param slippagePercent Slippage tolerance percentage
 * @param jitoTipAmt Jito tip amount in SOL
 * @returns Result of the operation
 */
export async function unifiedSell(
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

    // Load pool info
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

    // Execute appropriate sell function based on platform
    if (platform === TokenPlatform.PUMP_FUN) {
      const result = await executePumpFunSell(
        mintPk, 
        selectionMode, 
        supplyPercent, 
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
      const result = await executePumpSwapSell(
        mintPk, 
        selectionMode, 
        supplyPercent, 
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
    console.error("❌ Unified sell error:", error);
    
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
 * Get wallets with tokens based on selection mode
 * @param mintAddress Token mint address
 * @param selectionMode Wallet selection mode
 * @returns Wallets with tokens
 */
async function getAllWalletsWithTokens(
  mintAddress: PublicKey, 
  selectionMode: WalletSelectionMode
): Promise<WalletWithTokens[]> {
  const walletsWithTokens: WalletWithTokens[] = [];
  const keypairs = loadKeypairs();
  
  // Check dev wallet (creator) if mode allows
  if (selectionMode === WalletSelectionMode.ALL_WALLETS || selectionMode === WalletSelectionMode.CREATOR_ONLY) {
    try {
      const devTokenAccount = spl.getAssociatedTokenAddressSync(mintAddress, wallet.publicKey);
      const devBalance = await connection.getTokenAccountBalance(devTokenAccount);
      const devTokens = Number(devBalance.value.amount);
      
      if (devTokens > 0) {
        walletsWithTokens.push({
          keypair: wallet,
          tokenBalance: devTokens,
          walletName: "DEV WALLET (CREATOR)"
        });
      }
    } catch (error) {
      // No token account or zero balance
    }
  }

  // Check bundle wallets if mode allows  
  if (selectionMode === WalletSelectionMode.ALL_WALLETS || selectionMode === WalletSelectionMode.BUNDLE_ONLY) {
    for (let i = 0; i < keypairs.length; i++) {
      const keypair = keypairs[i];
      try {
        const tokenAccount = spl.getAssociatedTokenAddressSync(mintAddress, keypair.publicKey);
        const balance = await connection.getTokenAccountBalance(tokenAccount);
        const tokens = Number(balance.value.amount);
        
        if (tokens > 1000000) { // More than 1 token (assuming 6 decimals)
          walletsWithTokens.push({
            keypair: keypair,
            tokenBalance: tokens,
            walletName: `Wallet ${i + 1} (BUNDLE)`
          });
        }
      } catch (error) {
        // No token account or zero balance
      }
    }
  }

  return walletsWithTokens;
}

/**
 * Execute Pump.fun sell
 * @param mintAddress Token mint address
 * @param selectionMode Wallet selection mode
 * @param supplyPercent Supply percentage to sell (0-1)
 * @param slippagePercent Slippage tolerance percentage
 * @param jitoTipAmt Jito tip amount in lamports
 * @param lookupTableAccount Lookup table account
 * @returns Result of the operation
 */
async function executePumpFunSell(
  mintAddress: PublicKey,
  selectionMode: WalletSelectionMode,
  supplyPercent: number,
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

    // Get wallets with tokens
    const walletsWithTokens = await getAllWalletsWithTokens(mintAddress, selectionMode);
    if (walletsWithTokens.length === 0) {
      return {
        success: false,
        message: "❌ No wallets found with tokens!"
      };
    }

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
    const signatures: string[] = [];

    // Group wallets (5 per transaction for Pump.fun)
    const WALLETS_PER_TX = TX_SETTINGS.WALLETS_PER_TX_PUMPFUN;
    const walletChunks: WalletWithTokens[][] = [];
    
    for (let i = 0; i < walletsWithTokens.length; i += WALLETS_PER_TX) {
      walletChunks.push(walletsWithTokens.slice(i, i + WALLETS_PER_TX));
    }

    for (let chunkIndex = 0; chunkIndex < walletChunks.length; chunkIndex++) {
      const chunk = walletChunks[chunkIndex];
      const isLastChunk = chunkIndex === walletChunks.length - 1;
      
      const sellTxIxs: TransactionInstruction[] = [];
      
      // Compute budget for multiple sells
      sellTxIxs.push(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 + (chunk.length * 80000) }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150000 })
      );

      const signers: Keypair[] = [payer];

      // Add sell instructions for each wallet
      for (const walletData of chunk) {
        const sellAmount = Math.floor(walletData.tokenBalance * supplyPercent);
        if (sellAmount <= 0) continue;

        const walletTokenATA = spl.getAssociatedTokenAddressSync(mintAddress, walletData.keypair.publicKey);

        const sellIx = await (program.methods as any)
          .sell(new BN(sellAmount), new BN(0)) // min SOL out = 0 (accept any slippage)
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

        sellTxIxs.push(sellIx);
        signers.push(walletData.keypair);
      }

      // Add Jito tip to last transaction
      if (isLastChunk) {
        sellTxIxs.push(
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
        instructions: sellTxIxs,
      }).compileToV0Message([lookupTableAccount]);

      const versionedTx = new VersionedTransaction(message);
      
      const txSize = versionedTx.serialize().length;
      
      if (txSize > TX_SETTINGS.MAX_TX_SIZE) {
        continue; // Skip this transaction if it's too large
      }

      versionedTx.sign(signers);
      bundledTxns.push(versionedTx);
      signatures.push(bs58.encode(versionedTx.signatures[0]));
    }

    if (bundledTxns.length === 0) {
      return {
        success: false,
        message: "❌ No valid transactions built!"
      };
    }

    // Send bundle
    const result = await sendBundleAndVerify([bundledTxns]);
    
    return {
      success: result.verified,
      message: result.verified ? 
        `✅ Pump.fun sell successful! Bundle ID: ${result.bundleId}` : 
        "❌ Failed to verify bundle",
      transactions: signatures
    };
  } catch (error) {
    console.error("❌ Pump.fun sell error:", error);
    return {
      success: false,
      message: `❌ Error: ${error.message || "Unknown error"}`
    };
  }
}

/**
 * Execute PumpSwap sell
 * @param mintAddress Token mint address
 * @param selectionMode Wallet selection mode
 * @param supplyPercent Supply percentage to sell (0-1)
 * @param slippagePercent Slippage tolerance percentage
 * @param jitoTipAmt Jito tip amount in lamports
 * @param lookupTableAccount Lookup table account
 * @returns Result of the operation
 */
async function executePumpSwapSell(
  mintAddress: PublicKey,
  selectionMode: WalletSelectionMode,
  supplyPercent: number,
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

    // Get wallets with tokens
    const walletsWithTokens = await getAllWalletsWithTokens(mintAddress, selectionMode);
    if (walletsWithTokens.length === 0) {
      return {
        success: false,
        message: "❌ No wallets found with tokens!"
      };
    }

    // Create smart bundles (3 wallets per TX for PumpSwap)
    const bundles = createSmartBundles(walletsWithTokens);
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
      const walletChunks: WalletWithTokens[][] = [];
      
      for (let i = 0; i < bundleWallets.length; i += WALLETS_PER_TX) {
        walletChunks.push(bundleWallets.slice(i, i + WALLETS_PER_TX));
      }

      // Build each transaction
      for (let txIndex = 0; txIndex < walletChunks.length; txIndex++) {
        const walletChunk = walletChunks[txIndex];
        const isLastTxInBundle = txIndex === walletChunks.length - 1;
        
        const sellData = await buildPumpSwapSellInstructions(
          program,
          walletChunk,
          mintAddress,
          poolAddress,
          supplyPercent,
          slippagePercent
        );
        
        if (!sellData) {
          continue;
        }

        const txInstructions = [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 + (walletChunk.length * 150000) }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }),
          ...sellData.instructions
        ];

        // Add Jito tip to last TX of each bundle
        if (isLastTxInBundle) {
          txInstructions.push(
            SystemProgram.transfer({
              fromPubkey: sellData.payer,
              toPubkey: getRandomTipAccount(),
              lamports: BigInt(jitoTipAmt),
            })
          );
        }

        const message = new TransactionMessage({
          payerKey: sellData.payer,
          recentBlockhash: blockhash,
          instructions: txInstructions,
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
      message: `${successCount}/${bundleResults.length} PumpSwap sell bundles successful!`,
      transactions: allSignatures
    };
  } catch (error) {
    console.error("❌ PumpSwap sell error:", error);
    return {
      success: false,
      message: `❌ Error: ${error.message || "Unknown error"}`
    };
  }
}

/**
 * Create smart bundles for PumpSwap
 * @param walletsWithTokens Wallets with tokens
 * @returns Wallet chunks for bundles
 */
function createSmartBundles(walletsWithTokens: WalletWithTokens[]): WalletWithTokens[][] {
  const MAX_SELLS_PER_BUNDLE = 15;
  
  if (walletsWithTokens.length <= MAX_SELLS_PER_BUNDLE) {
    return [walletsWithTokens];
  } else {
    // Split into multiple bundles
    const mid = Math.ceil(walletsWithTokens.length / 2);
    return [
      walletsWithTokens.slice(0, mid),
      walletsWithTokens.slice(mid)
    ];
  }
}

/**
 * Build PumpSwap sell instructions
 * @param program Anchor program
 * @param walletsData Wallets with tokens data
 * @param mintAddress Token mint address
 * @param poolAddress Pool address
 * @param supplyPercent Supply percentage to sell (0-1)
 * @param slippagePercent Slippage tolerance percentage
 * @returns Instructions, payer, and signers
 */
async function buildPumpSwapSellInstructions(
  program: anchor.Program,
  walletsData: WalletWithTokens[],
  mintAddress: PublicKey,
  poolAddress: PublicKey,
  supplyPercent: number,
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
      const sellAmount = Math.floor(walletData.tokenBalance * supplyPercent);
      if (sellAmount <= 0) continue;
      
      const expectedSolOutput = await getExpectedSolOutput(poolAddress, new BN(sellAmount), mintAddress);
      const slippageFactor = new BN(100 - slippagePercent);
      const minQuoteOut = expectedSolOutput.mul(slippageFactor).div(new BN(100));

      const userBaseTokenAccount = spl.getAssociatedTokenAddressSync(mintAddress, walletData.keypair.publicKey);
      const userQuoteTokenAccount = spl.getAssociatedTokenAddressSync(WSOL_MINT, walletData.keypair.publicKey);

      const createWSOLIx = spl.createAssociatedTokenAccountIdempotentInstruction(
        payerWallet.publicKey,
        userQuoteTokenAccount,
        walletData.keypair.publicKey,
        WSOL_MINT
      );
      instructions.push(createWSOLIx);

      const sellIx = await program.methods
        .sell(new BN(sellAmount), minQuoteOut)
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

      instructions.push(sellIx);
      
      if (!walletData.keypair.publicKey.equals(payerWallet.publicKey)) {
        signers.push(walletData.keypair);
      }
    }

    signers.unshift(payerWallet);
    
    return { instructions, payer: payerWallet.publicKey, signers };
  } catch (error) {
    console.error("Error building PumpSwap sell instructions:", error);
    return null;
  }
}

/**
 * Get expected SOL output for PumpSwap
 * @param poolAddress Pool address
 * @param sellTokenAmount Token amount to sell
 * @param baseMint Base mint (token mint)
 * @returns Expected SOL output
 */
async function getExpectedSolOutput(
  poolAddress: PublicKey, 
  sellTokenAmount: BN, 
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
    const newBaseReserve = baseReserve.add(sellTokenAmount);
    const newQuoteReserve = k.div(newBaseReserve);
    const expectedSolOutput = quoteReserve.sub(newQuoteReserve);
    
    return expectedSolOutput;
    
  } catch (error) {
    return new BN(Math.floor(sellTokenAmount.toNumber() * 0.000001)); // Fallback
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

/**
 * Sells all tokens in all wallets from the given mint
 * @param mintAddress Token mint address
 * @param slippagePercent Slippage tolerance percentage
 * @param jitoTipAmt Jito tip amount in SOL
 * @returns Result of the operation
 */
export async function sellAll(
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
    mintAddress, 
    WalletSelectionMode.ALL_WALLETS, 
    100, // 100% - sell everything
    slippagePercent,
    jitoTipAmt
  );
}