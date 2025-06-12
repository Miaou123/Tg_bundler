import { 
  PublicKey, 
  Transaction, 
  SystemProgram, 
  Keypair, 
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram, 
  TransactionInstruction,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import { connection, wallet, payer, PUMP_PROGRAM, feeRecipient, eventAuthority, global } from '../shared/config';
import * as spl from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import BN from 'bn.js';
import fs from 'fs';
import { loadKeypairs } from './keys';
import { WalletSelectionMode } from '../shared/types';
import { WSOL_MINT } from '../shared/constants';
import { sleep } from '../shared/utils';

/**
 * Token account information
 */
interface TokenAccount {
  mint: string;
  balance: number;
  decimals: number;
  rawBalance: string;
}

/**
 * Wallet with tokens information
 */
interface WalletWithTokens {
  keypair: Keypair;
  walletName: string;
  tokenAccounts: TokenAccount[];
  solBalance: number;
}

/**
 * Cleanup wallets by selling all tokens and optionally transferring SOL
 * @param selectionMode Which wallets to clean
 * @param transferCreatorSOL Whether to transfer SOL from creator wallet
 * @returns Result of the operation
 */
export async function cleanupWallets(
  selectionMode: WalletSelectionMode, 
  transferCreatorSOL: boolean = false
): Promise<{
  success: boolean;
  message: string;
  cleanedWallets: number;
  failedWallets: number;
  walletsWithTokens?: number;
  transferredSOL?: number;
}> {
  try {
    // Scan wallets to find which ones need cleaning
    const walletsData = await scanWalletsWithSelection(selectionMode);
    
    if (walletsData.length === 0) {
      return {
        success: true,
        message: "✅ No wallets found that need cleaning!",
        cleanedWallets: 0,
        failedWallets: 0,
        walletsWithTokens: 0
      };
    }

    // Calculate SOL to recover based on transfer settings
    const solToRecover = walletsData
      .filter(w => {
        if (w.walletName === "DEV WALLET (CREATOR)") {
          return transferCreatorSOL; // Only count creator SOL if we're transferring it
        }
        return true; // Always count bundle wallet SOL
      })
      .reduce((sum, w) => sum + w.solBalance, 0);

    // Execute cleanup individually for each wallet
    let successCount = 0;
    let failedCount = 0;
    
    for (const walletData of walletsData) {
      const walletSuccess = await processWallet(walletData, transferCreatorSOL);
      
      if (walletSuccess) {
        successCount++;
      } else {
        failedCount++;
      }
      
      // Add delay between wallets to prevent rate limiting
      await sleep(2000);
    }
    
    // Return results
    return {
      success: successCount > 0,
      message: `Cleaned ${successCount} wallets successfully${failedCount > 0 ? `, ${failedCount} failed` : ''}`,
      cleanedWallets: successCount,
      failedWallets: failedCount,
      walletsWithTokens: walletsData.reduce((sum, w) => sum + (w.tokenAccounts.length > 0 ? 1 : 0), 0),
      transferredSOL: solToRecover / LAMPORTS_PER_SOL
    };
  } catch (error) {
    console.error("Cleanup error:", error);
    
    return {
      success: false,
      message: `❌ Error during cleanup: ${error.message || "Unknown error"}`,
      cleanedWallets: 0,
      failedWallets: 0
    };
  }
}

/**
 * Scan wallets based on selection mode to find which ones need cleaning
 * @param selectionMode Which wallets to scan
 * @returns Wallets with tokens or SOL
 */
async function scanWalletsWithSelection(
  selectionMode: WalletSelectionMode
): Promise<WalletWithTokens[]> {
  const walletsData: WalletWithTokens[] = [];
  const keypairs = loadKeypairs();

  // Check dev wallet (creator) if mode allows
  if (selectionMode === WalletSelectionMode.ALL_WALLETS || selectionMode === WalletSelectionMode.CREATOR_ONLY) {
    try {
      const devSolBalance = await connection.getBalance(wallet.publicKey);
      const devTokens = await getWalletTokenAccounts(wallet.publicKey);
      
      if (devTokens.length > 0 || devSolBalance > 0.01 * LAMPORTS_PER_SOL) {
        walletsData.push({
          keypair: wallet,
          walletName: "DEV WALLET (CREATOR)",
          tokenAccounts: devTokens,
          solBalance: devSolBalance
        });
      }
    } catch (error) {
      console.error("Error checking DEV WALLET:", error);
    }
  }

  // Check bundle wallets if mode allows  
  if (selectionMode === WalletSelectionMode.ALL_WALLETS || selectionMode === WalletSelectionMode.BUNDLE_ONLY) {
    for (let i = 0; i < keypairs.length; i++) {
      const keypair = keypairs[i];
      
      try {
        const solBalance = await connection.getBalance(keypair.publicKey);
        const tokenAccounts = await getWalletTokenAccounts(keypair.publicKey);
        
        const hasTokensOrSol = tokenAccounts.length > 0 || solBalance > 0.005 * LAMPORTS_PER_SOL; // More than 0.005 SOL
        
        if (hasTokensOrSol) {
          walletsData.push({
            keypair: keypair,
            walletName: `Wallet ${i + 1} (BUNDLE)`,
            tokenAccounts: tokenAccounts,
            solBalance: solBalance
          });
        }
      } catch (error) {
        console.error(`Error checking Wallet ${i + 1}:`, error);
      }
    }
  }

  return walletsData;
}

/**
 * Get all token accounts for a wallet
 * @param walletPubkey Wallet public key
 * @returns Array of token accounts with balances
 */
async function getWalletTokenAccounts(walletPubkey: PublicKey): Promise<TokenAccount[]> {
  try {
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      walletPubkey,
      { programId: spl.TOKEN_PROGRAM_ID }
    );

    const tokens: TokenAccount[] = [];
    
    for (const account of tokenAccounts.value) {
      const parsedInfo = account.account.data.parsed.info as any;
      const balance = parsedInfo.tokenAmount.uiAmount;
      const rawBalance = parsedInfo.tokenAmount.amount;
      
      // Only include accounts with actual token balance
      if (balance && balance > 0) {
        tokens.push({
          mint: parsedInfo.mint,
          balance: balance,
          decimals: parsedInfo.tokenAmount.decimals,
          rawBalance: rawBalance
        });
      }
    }

    return tokens;
  } catch (error) {
    console.error(`Error getting token accounts:`, error);
    return [];
  }
}

/**
 * Process a single wallet - sell all tokens and transfer SOL
 * @param walletData Wallet with tokens data
 * @param transferCreatorSOL Whether to transfer SOL from creator wallet
 * @returns Whether the operation was successful
 */
async function processWallet(
  walletData: WalletWithTokens, 
  transferCreatorSOL: boolean
): Promise<boolean> {
  let success = true;
  const isCreatorWallet = walletData.walletName === "DEV WALLET (CREATOR)";

  // Step 1: Sell all tokens (but skip tiny amounts)
  for (const tokenAccount of walletData.tokenAccounts) {
    try {
      // Handle tokens with very small amounts (burn them first, then close ATA)
      if (tokenAccount.balance <= 0.001) {
        try {
          const mintAddress = new PublicKey(tokenAccount.mint);
          const tokenAccountAddress = spl.getAssociatedTokenAddressSync(
            mintAddress, 
            walletData.keypair.publicKey
          );
          
          // Get actual balance from chain
          const tokenAccountInfo = await connection.getTokenAccountBalance(tokenAccountAddress);
          const actualBalance = BigInt(tokenAccountInfo.value.amount);
          
          if (actualBalance > BigInt(0)) {
            // Create burn transaction
            const burnTransaction = new Transaction();
            burnTransaction.add(
              ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }),
              ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 })
            );

            // Burn all tokens
            const burnIx = spl.createBurnInstruction(
              tokenAccountAddress, // account to burn from
              mintAddress, // mint
              walletData.keypair.publicKey, // owner
              actualBalance // amount to burn
            );

            burnTransaction.add(burnIx);
            
            const burnSignature = await sendAndConfirmTransaction(
              connection,
              burnTransaction,
              [walletData.keypair],
              { commitment: "confirmed", maxRetries: 3 }
            );
            
            // Wait for burn to settle
            await sleep(2000);
          }

          // Now close the account (should have zero balance after burn)
          const closeTransaction = new Transaction();
          closeTransaction.add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 })
          );

          const closeAccountIx = spl.createCloseAccountInstruction(
            tokenAccountAddress,
            walletData.keypair.publicKey, // Rent goes back to wallet
            walletData.keypair.publicKey
          );
          
          closeTransaction.add(closeAccountIx);
          
          await sendAndConfirmTransaction(
            connection,
            closeTransaction,
            [walletData.keypair],
            { commitment: "confirmed", maxRetries: 3 }
          );
          
        } catch (error) {
          console.error("Failed to burn/close token account:", error);
        }
        
        continue; // Skip to next token
      }

      const mintAddress = new PublicKey(tokenAccount.mint);
      
      // Check if it's wrapped SOL
      if (mintAddress.equals(WSOL_MINT)) {
        try {
          const tokenAccountAddress = spl.getAssociatedTokenAddressSync(
            mintAddress, 
            walletData.keypair.publicKey
          );
          
          // Create unwrap transaction
          const transaction = new Transaction();
          transaction.add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 })
          );

          // Close the WSOL account to unwrap to native SOL
          const closeAccountIx = spl.createCloseAccountInstruction(
            tokenAccountAddress,
            walletData.keypair.publicKey, // SOL goes back to wallet
            walletData.keypair.publicKey
          );
          
          transaction.add(closeAccountIx);
          
          await sendAndConfirmTransaction(
            connection,
            transaction,
            [walletData.keypair],
            { commitment: "confirmed", maxRetries: 3 }
          );
          
        } catch (error) {
          console.error("Failed to unwrap WSOL:", error);
          success = false;
        }
        
        continue; // Skip to next token
      }
      
      // Check if it's a Pump.fun token
      const isPumpToken = await isPumpFunToken(mintAddress);
      
      if (isPumpToken) {
        // Create sell transaction
        const transaction = new Transaction();
        
        // More reasonable gas fees for cleanup (not high priority)
        transaction.add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 })
        );

        // Add sell instruction
        const sellIx = await createPumpFunSellInstruction(
          walletData.keypair,
          mintAddress,
          tokenAccount.rawBalance
        );

        if (sellIx) {
          transaction.add(sellIx);

          // Send transaction
          try {
            await sendAndConfirmTransaction(
              connection,
              transaction,
              [walletData.keypair],
              {
                commitment: "confirmed",
                maxRetries: 3
              }
            );
          } catch (error) {
            console.error("Failed to sell tokens:", error);
            success = false;
          }
        } else {
          console.error("Failed to create sell instruction");
          success = false;
        }
      } else {
        // For non-Pump.fun tokens, just close the token account to reclaim rent
        try {
          const transaction = new Transaction();
          transaction.add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 })
          );

          const tokenAccountAddress = spl.getAssociatedTokenAddressSync(
            mintAddress, 
            walletData.keypair.publicKey
          );
          const closeAccountIx = spl.createCloseAccountInstruction(
            tokenAccountAddress,
            walletData.keypair.publicKey, // Rent goes back to wallet
            walletData.keypair.publicKey
          );
          
          transaction.add(closeAccountIx);
          
          await sendAndConfirmTransaction(
            connection,
            transaction,
            [walletData.keypair],
            { commitment: "confirmed", maxRetries: 3 }
          );
          
        } catch (error) {
          console.error("Failed to close token account:", error);
        }
      }

      // Wait between token sales to avoid rate limiting
      await sleep(1000);

    } catch (error) {
      console.error(`Error processing token ${tokenAccount.mint}:`, error);
      success = false;
    }
  }

  // Step 2: Transfer SOL based on user preference
  const shouldTransferSOL = isCreatorWallet ? transferCreatorSOL : true; // Always transfer from bundle wallets

  if (shouldTransferSOL) {
    // Transfer SOL to payer
    try {
      // Get current balance (may have changed after token sales)
      const currentBalance = await connection.getBalance(walletData.keypair.publicKey);
      const fee = 0.001 * LAMPORTS_PER_SOL; // Reserve for transaction fee
      const transferAmount = currentBalance - fee;

      if (transferAmount > 0) {
        const transaction = new Transaction();
        transaction.add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 50000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 25000 })
        );

        transaction.add(
          SystemProgram.transfer({
            fromPubkey: walletData.keypair.publicKey,
            toPubkey: payer.publicKey,
            lamports: Math.floor(transferAmount),
          })
        );

        await sendAndConfirmTransaction(
          connection,
          transaction,
          [walletData.keypair],
          {
            commitment: "confirmed",
            maxRetries: 3
          }
        );
      }

    } catch (error) {
      console.error("Failed to transfer SOL:", error);
      success = false;
    }
  }

  return success;
}

/**
 * Check if a token is a Pump.fun token
 * @param mintAddress Token mint address
 * @returns Whether the token is a Pump.fun token
 */
async function isPumpFunToken(mintAddress: PublicKey): Promise<boolean> {
  try {
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mintAddress.toBytes()], 
      PUMP_PROGRAM
    );
    
    const bondingCurveInfo = await connection.getAccountInfo(bondingCurve);
    return bondingCurveInfo !== null;
  } catch (error) {
    return false;
  }
}

/**
 * Get the creator of a Pump.fun token
 * @param mintAddress Token mint address
 * @returns Creator public key or null
 */
async function getTokenCreator(mintAddress: PublicKey): Promise<PublicKey | null> {
  try {
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mintAddress.toBytes()], 
      PUMP_PROGRAM
    );

    const bondingCurveInfo = await connection.getAccountInfo(bondingCurve);
    if (!bondingCurveInfo) {
      return null;
    }

    // Parse bonding curve data correctly
    // Bonding curve layout: discriminator(8) + virtual_token_reserves(8) + virtual_sol_reserves(8) + 
    // real_token_reserves(8) + real_sol_reserves(8) + token_total_supply(8) + complete(1) + creator(32)
    const creatorOffset = 8 + 8 + 8 + 8 + 8 + 8 + 1; // = 49 bytes
    const creatorBytes = bondingCurveInfo.data.slice(creatorOffset, creatorOffset + 32);
    const creator = new PublicKey(creatorBytes);
    
    return creator;
  } catch (error) {
    console.error("Could not get token creator:", error);
    return null;
  }
}

/**
 * Create a Pump.fun sell instruction
 * @param wallet Wallet keypair
 * @param mintAddress Token mint address
 * @param tokenAmount Token amount to sell
 * @returns Sell instruction or null if failed
 */
async function createPumpFunSellInstruction(
  wallet: Keypair,
  mintAddress: PublicKey,
  tokenAmount: string
): Promise<TransactionInstruction | null> {
  try {
    // Make sure IDL file exists
    const idlPath = "./pumpfun-IDL.json";
    if (!fs.existsSync(idlPath)) {
      console.error("Missing pumpfun-IDL.json file!");
      return null;
    }
  
    // Setup Anchor
    const provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(wallet),
      { commitment: "confirmed" }
    );

    const IDL_PumpFun = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
    const program = new anchor.Program(IDL_PumpFun, provider);

    // Get the actual token creator from bonding curve
    const tokenCreator = await getTokenCreator(mintAddress);
    if (!tokenCreator) {
      console.error("Could not determine token creator");
      return null;
    }

    // Calculate PDAs
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mintAddress.toBytes()], 
      PUMP_PROGRAM
    );
    const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
      [bondingCurve.toBytes(), spl.TOKEN_PROGRAM_ID.toBytes(), mintAddress.toBytes()],
      spl.ASSOCIATED_TOKEN_PROGRAM_ID
    );
    // Use actual token creator, not the selling wallet
    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), tokenCreator.toBytes()], 
      PUMP_PROGRAM
    );

    const walletTokenATA = spl.getAssociatedTokenAddressSync(mintAddress, wallet.publicKey);

    // Create sell instruction
    const sellAmount = new BN(tokenAmount);
    const minSolOut = new BN(0); // Accept any amount of SOL (no slippage protection)

    const sellIx = await (program.methods as any)
      .sell(sellAmount, minSolOut)
      .accounts({
        global: global,
        feeRecipient: feeRecipient,
        mint: mintAddress,
        bondingCurve: bondingCurve,
        associatedBondingCurve: associatedBondingCurve,
        associatedUser: walletTokenATA,
        user: wallet.publicKey,
        systemProgram: SystemProgram.programId,
        creatorVault: creatorVault,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
        eventAuthority: eventAuthority,
        program: PUMP_PROGRAM,
      })
      .instruction();

    return sellIx;
  } catch (error) {
    console.error(`Failed to create sell instruction:`, error);
    return null;
  }
}

/**
 * Sell all tokens and transfer SOL from all wallets
 * @param transferCreatorSOL Whether to transfer SOL from creator wallet
 * @returns Result of the operation
 */
export async function sellAllTokensAndCleanup(transferCreatorSOL: boolean = false): Promise<{
  success: boolean;
  message: string;
  cleanedWallets: number;
  failedWallets: number;
  transferredSOL?: number;
}> {
  // Use the cleanup wallets function with ALL_WALLETS selection mode
  return cleanupWallets(WalletSelectionMode.ALL_WALLETS, transferCreatorSOL);
}