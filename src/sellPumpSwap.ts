import { connection, wallet, payer } from "../config";
import { PublicKey, VersionedTransaction, TransactionMessage, SystemProgram, Keypair, LAMPORTS_PER_SOL, ComputeBudgetProgram, TransactionInstruction } from "@solana/web3.js";
import { loadKeypairs } from "./createKeys";
import { searcherClient } from "./clients/jito";
import { Bundle as JitoBundle } from "jito-ts/dist/sdk/block-engine/types.js";
const promptSync = require("prompt-sync");
import * as spl from "@solana/spl-token";
import bs58 from "bs58";
import path from "path";
import fs from "fs";
import { getRandomTipAccount } from "./clients/config";
import BN from "bn.js";
import * as anchor from "@coral-xyz/anchor";

const prompt = promptSync();
const keyInfoPath = path.join(__dirname, "keyInfo.json");

// PumpSwap program constants
const PUMPSWAP_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const PUMPSWAP_GLOBAL_CONFIG = new PublicKey("2cNLhWBaB8YSgFCZgkFsP6Ksu9FR6RM7h2YjLJe8nX2H"); // You may need to find this
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// Load PumpSwap IDL from file (create pumpswap-IDL.json)
const PUMPSWAP_IDL = JSON.parse(fs.readFileSync("./pumpswap-IDL.json", "utf-8"));

function chunkArray<T>(array: T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(array.length / size) }, (v, i) => array.slice(i * size, i * size + size));
}

async function sendBundle(bundledTxns: VersionedTransaction[]) {
    if (bundledTxns.length === 0) {
        console.log("❌ No transactions to send");
        return false;
    }

    console.log(`📤 Sending PumpSwap sell bundle with ${bundledTxns.length} transactions to Jito`);
    console.log(`📏 Total bundle size: ${bundledTxns.reduce((sum, tx) => sum + tx.serialize().length, 0).toLocaleString()} bytes`);

    try {
        const bundleId = await searcherClient.sendBundle(new JitoBundle(bundledTxns, bundledTxns.length));
        console.log(`✅ PumpSwap sell bundle sent successfully!`);
        
        let bundleIdStr;
        try {
            bundleIdStr = bundleId?.toString() || 'unknown';
        } catch {
            bundleIdStr = 'unknown';
        }
        console.log(`🆔 Bundle ID: ${bundleIdStr}`);

        console.log("⏳ Waiting for PumpSwap sell bundle result...");
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        console.log("🔍 Checking PumpSwap sell transaction status...");
        const success = await verifySellSuccess(bundledTxns);
        
        if (success) {
            console.log("🎉 PUMPSWAP SELL BUNDLE SUCCESSFUL!");
            return true;
        } else {
            console.log("❌ PumpSwap sell bundle verification failed");
            return false;
        }

    } catch (error) {
        const err = error as any;
        console.error("❌ Jito PumpSwap sell bundle error:", err.message);

        if (err?.message?.includes("Bundle Dropped, no connected leader up soon")) {
            console.error("  → No Jito leader available - try again in a few seconds");
        } else if (err?.message?.includes("Rate limit exceeded")) {
            console.log("⚠️  Jito API rate limit hit - checking on-chain status...");
            await new Promise(resolve => setTimeout(resolve, 5000));
            const success = await verifySellSuccess(bundledTxns);
            return success;
        } else {
            console.error("  → Unexpected error occurred");
        }
        
        return false;
    }
}

async function verifySellSuccess(bundledTxns: VersionedTransaction[]): Promise<boolean> {
    console.log("\n=== VERIFYING PUMPSWAP SELL SUCCESS ===");

    try {
        let successCount = 0;
        let totalChecked = 0;
        
        for (let i = 0; i < Math.min(bundledTxns.length, 5); i++) {
            const tx = bundledTxns[i];
            const signature = bs58.encode(tx.signatures[0]);
            
            try {
                const status = await connection.getSignatureStatus(signature, { 
                    searchTransactionHistory: true 
                });
                
                totalChecked++;
                
                if (status.value?.confirmationStatus) {
                    const isSuccess = !status.value.err;
                    console.log(`${isSuccess ? '✅' : '❌'} TX ${i + 1}: ${status.value.confirmationStatus.toUpperCase()}${status.value.err ? ` (${JSON.stringify(status.value.err)})` : ''}`);
                    
                    if (isSuccess) {
                        successCount++;
                    }
                } else {
                    console.log(`⏳ TX ${i + 1}: Not found yet`);
                }
            } catch (error) {
                console.log(`⚠️  TX ${i + 1}: Status check failed`);
            }
        }
        
        if (successCount > 0) {
            console.log(`\n🎉 PUMPSWAP SELL SUCCESS CONFIRMED!`);
            console.log(`📊 Transaction status: ${successCount}/${totalChecked} confirmed successful`);
            return true;
        } else {
            console.log("❌ No successful PumpSwap sell transactions found");
            return false;
        }
        
    } catch (error) {
        console.error("❌ PumpSwap sell verification failed:", error);
        return false;
    }
}

// Interface for wallets with token balances
interface WalletWithTokens {
    keypair: Keypair;
    tokenBalance: number;
    walletName: string;
}

// Check ALL wallets on-chain for token balances
async function getAllWalletsWithTokens(mintAddress: PublicKey): Promise<WalletWithTokens[]> {
    console.log("\n=== SCANNING ALL WALLETS FOR PUMPSWAP TOKENS ===");
    console.log(`🔍 Checking token: ${mintAddress.toBase58()}`);
    
    const walletsWithTokens: WalletWithTokens[] = [];
    const keypairs = loadKeypairs();
    
    // Check dev wallet first
    console.log("\n👤 Checking DEV WALLET...");
    try {
        const devTokenAccount = spl.getAssociatedTokenAddressSync(mintAddress, wallet.publicKey);
        const devBalance = await connection.getTokenAccountBalance(devTokenAccount);
        const devTokens = Number(devBalance.value.amount);
        
        if (devTokens > 0) {
            console.log(`✅ DEV WALLET: ${(devTokens / 1e6).toFixed(2)}M tokens`);
            walletsWithTokens.push({
                keypair: wallet,
                tokenBalance: devTokens,
                walletName: "DEV WALLET"
            });
        } else {
            console.log(`⚠️  DEV WALLET: No tokens found`);
        }
    } catch (error) {
        console.log(`⚠️  DEV WALLET: No token account found`);
    }

    // Check all 24 keypairs
    console.log("\n👥 Checking ALL 24 WALLETS...");
    for (let i = 0; i < keypairs.length; i++) {
        const keypair = keypairs[i];
        try {
            const tokenAccount = spl.getAssociatedTokenAddressSync(mintAddress, keypair.publicKey);
            const balance = await connection.getTokenAccountBalance(tokenAccount);
            const tokens = Number(balance.value.amount);
            
            if (tokens > 0) {
                console.log(`✅ Wallet ${i + 1}: ${(tokens / 1e6).toFixed(2)}M tokens (${keypair.publicKey.toString().slice(0, 8)}...)`);
                walletsWithTokens.push({
                    keypair: keypair,
                    tokenBalance: tokens,
                    walletName: `Wallet ${i + 1}`
                });
            } else {
                console.log(`⚪ Wallet ${i + 1}: No tokens`);
            }
        } catch (error) {
            console.log(`⚪ Wallet ${i + 1}: No token account`);
        }
    }

    console.log(`\n📊 SCAN COMPLETE:`);
    console.log(`   Total wallets with tokens: ${walletsWithTokens.length}`);
    console.log(`   Total tokens found: ${(walletsWithTokens.reduce((sum, w) => sum + w.tokenBalance, 0) / 1e6).toFixed(2)}M`);

    return walletsWithTokens;
}

// Find PumpSwap pool for a given token
async function findPumpSwapPool(baseMint: PublicKey): Promise<PublicKey | null> {
    console.log(`🔍 Finding PumpSwap pool for token: ${baseMint.toBase58()}`);
    
    try {
        // Method 1: Try to derive canonical pool address
        // PumpSwap pools are created with a specific pattern
        // We need to find the pool that has this base mint and WSOL as quote mint
        
        // Get all PumpSwap program accounts and filter for pools with our base mint
        const accounts = await connection.getProgramAccounts(PUMPSWAP_PROGRAM_ID, {
            filters: [
                {
                    memcmp: {
                        offset: 8 + 1 + 2 + 32, // Skip discriminator + bump + index + creator
                        bytes: baseMint.toBase58(),
                    },
                },
            ],
        });

        for (const account of accounts) {
            // Basic validation - should be a pool account
            if (account.account.data.length >= 300) { // Pool account size
                console.log(`✅ Found PumpSwap pool: ${account.pubkey.toBase58()}`);
                return account.pubkey;
            }
        }

        console.log(`⚠️  No PumpSwap pool found for token ${baseMint.toBase58()}`);
        return null;
        
    } catch (error) {
        console.error("❌ Error finding PumpSwap pool:", error);
        return null;
    }
}

// Get pool accounts for PumpSwap trading
async function getPumpSwapPoolAccounts(pool: PublicKey, baseMint: PublicKey) {
    // Derive pool token accounts using PDA pattern from IDL
    const poolBaseTokenAccount = PublicKey.findProgramAddressSync(
        [
            pool.toBytes(),
            spl.TOKEN_PROGRAM_ID.toBytes(),
            baseMint.toBytes(),
        ],
        spl.ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];

    const poolQuoteTokenAccount = PublicKey.findProgramAddressSync(
        [
            pool.toBytes(),
            spl.TOKEN_PROGRAM_ID.toBytes(),
            WSOL_MINT.toBytes(),
        ],
        spl.ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];

    return {
        poolBaseTokenAccount,
        poolQuoteTokenAccount,
    };
}

// MAIN SELL FUNCTION - Using PumpSwap IDL
export async function sellXPercentagePUMPSWAP() {
    console.log("🔥 PUMPSWAP SELL BUNDLER");
    console.log("========================");

    try {
        // Setup Anchor
        const provider = new anchor.AnchorProvider(
            connection,
            new anchor.Wallet(wallet),
            { commitment: "confirmed" }
        );

        // Create program instance with PumpSwap IDL
        const program = new anchor.Program(PUMPSWAP_IDL as any, provider);

        // Load keyInfo for LUT and mint
        let poolInfo: { [key: string]: any } = {};
        if (fs.existsSync(keyInfoPath)) {
            const data = fs.readFileSync(keyInfoPath, "utf-8");
            poolInfo = JSON.parse(data);
        }

        if (!poolInfo.addressLUT || !poolInfo.mintPk) {
            console.log("❌ ERROR: Missing LUT or mint in keyInfo!");
            return;
        }

        const lut = new PublicKey(poolInfo.addressLUT.toString());
        const lookupTableAccount = (await connection.getAddressLookupTable(lut)).value;

        if (lookupTableAccount == null) {
            console.log("❌ ERROR: Lookup table not found on-chain!");
            return;
        }

        const mintKp = Keypair.fromSecretKey(Uint8Array.from(bs58.decode(poolInfo.mintPk)));
        console.log(`🎯 Token: ${mintKp.publicKey.toBase58()}`);

        // Get sell parameters
        const supplyPercentInput = prompt("Percentage to sell (Ex. 1 for 1%, 100 for 100%): ");
        const supplyPercentNum = parseFloat(supplyPercentInput.replace('%', ''));
        
        if (isNaN(supplyPercentNum) || supplyPercentNum <= 0 || supplyPercentNum > 100) {
            console.log("❌ Invalid percentage! Must be between 0.01 and 100");
            return;
        }
        
        const supplyPercent = supplyPercentNum / 100;
        const jitoTipAmt = +prompt("Jito tip in Sol (Ex. 0.01): ") * LAMPORTS_PER_SOL;

        if (supplyPercent > 0.25) {
            console.log("⚠️  WARNING: Selling more than 25% may cause high price impact!");
            const proceed = prompt("Continue anyway? (y/n): ").toLowerCase();
            if (proceed !== 'y') return;
        }

        console.log(`📊 Selling ${(supplyPercent * 100).toFixed(2)}% of each wallet's tokens`);

        // Get ALL wallets with tokens by checking on-chain
        const walletsWithTokens = await getAllWalletsWithTokens(mintKp.publicKey);
        
        if (walletsWithTokens.length === 0) {
            console.log("❌ No wallets found with tokens!");
            console.log("💡 Make sure this token has migrated to PumpSwap");
            return;
        }

        // Find PumpSwap pool
        const pool = await findPumpSwapPool(mintKp.publicKey);
        if (!pool) {
            console.log("❌ ERROR: PumpSwap pool not found!");
            console.log("💡 Make sure this token has migrated to PumpSwap");
            return;
        }

        console.log(`✅ Found PumpSwap pool: ${pool.toBase58()}`);

        // Get pool accounts
        const { poolBaseTokenAccount, poolQuoteTokenAccount } = await getPumpSwapPoolAccounts(pool, mintKp.publicKey);

        // Build individual sell transactions for each wallet
        console.log("\n=== BUILDING PUMPSWAP SELL TRANSACTIONS ===");
        const bundledTxns: VersionedTransaction[] = [];
        const { blockhash } = await connection.getLatestBlockhash();

        for (let i = 0; i < walletsWithTokens.length; i++) {
            const walletData = walletsWithTokens[i];
            const isLastWallet = i === walletsWithTokens.length - 1;
            
            // Calculate sell amount
            const sellAmount = Math.floor(walletData.tokenBalance * supplyPercent);
            
            if (sellAmount <= 0) {
                console.log(`⏭️  ${walletData.walletName}: Skipping (${sellAmount} tokens)`);
                continue;
            }

            console.log(`🔨 Building PumpSwap sell TX for ${walletData.walletName}: ${(sellAmount / 1e6).toFixed(2)}M tokens`);

            // Build sell instructions
            const sellTxIxs: TransactionInstruction[] = [];
            
            // Compute budget
            sellTxIxs.push(
                ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
                ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000 })
            );

            // Get wallet's token accounts
            const userBaseTokenAccount = spl.getAssociatedTokenAddressSync(mintKp.publicKey, walletData.keypair.publicKey);
            const userQuoteTokenAccount = spl.getAssociatedTokenAddressSync(WSOL_MINT, walletData.keypair.publicKey);

            // Create WSOL account if needed
            const createWSOLIx = spl.createAssociatedTokenAccountIdempotentInstruction(
                walletData.keypair.publicKey,
                userQuoteTokenAccount,
                walletData.keypair.publicKey,
                WSOL_MINT
            );

            // Protocol fee recipient (you may need to find the correct address)
            const protocolFeeRecipient = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");
            const protocolFeeRecipientTokenAccount = spl.getAssociatedTokenAddressSync(WSOL_MINT, protocolFeeRecipient);

            // Creator vault authority (derived from pool data - simplified for now)
            const [coinCreatorVaultAuthority] = PublicKey.findProgramAddressSync(
                [Buffer.from("creator_vault"), wallet.publicKey.toBytes()],
                PUMPSWAP_PROGRAM_ID
            );

            const coinCreatorVaultAta = spl.getAssociatedTokenAddressSync(WSOL_MINT, coinCreatorVaultAuthority);

            // Event authority
            const [eventAuthority] = PublicKey.findProgramAddressSync(
                [Buffer.from("__event_authority")],
                PUMPSWAP_PROGRAM_ID
            );

            // PumpSwap sell instruction using the IDL
            const sellIx = await (program.methods as any)
                .sell(new BN(sellAmount), new BN(0)) // base_amount_in, min_quote_amount_out
                .accounts({
                    pool: pool,
                    user: walletData.keypair.publicKey,
                    globalConfig: PUMPSWAP_GLOBAL_CONFIG,
                    baseMint: mintKp.publicKey,
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

            sellTxIxs.push(createWSOLIx, sellIx);

            // Add Jito tip to the last transaction
            if (isLastWallet) {
                console.log(`  💰 Adding Jito tip: ${jitoTipAmt / LAMPORTS_PER_SOL} SOL`);
                sellTxIxs.push(
                    SystemProgram.transfer({
                        fromPubkey: walletData.keypair.publicKey,
                        toPubkey: getRandomTipAccount(),
                        lamports: BigInt(jitoTipAmt),
                    })
                );
            }

            // Build transaction
            const message = new TransactionMessage({
                payerKey: walletData.keypair.publicKey,
                recentBlockhash: blockhash,
                instructions: sellTxIxs,
            }).compileToV0Message([lookupTableAccount]);

            const versionedTx = new VersionedTransaction(message);

            // Size check
            const txSize = versionedTx.serialize().length;
            console.log(`  📏 Size: ${txSize}/1232 bytes`);
            
            if (txSize > 1232) {
                console.log(`  ❌ Transaction too large, skipping ${walletData.walletName}`);
                continue;
            }

            // Sign transaction
            versionedTx.sign([walletData.keypair]);
            bundledTxns.push(versionedTx);
            
            console.log(`  ✅ ${walletData.walletName} PumpSwap sell TX built`);
        }

        if (bundledTxns.length === 0) {
            console.log("❌ No valid PumpSwap sell transactions were built!");
            return;
        }

        // Show summary and confirm
        console.log(`\n=== PUMPSWAP SELL BUNDLE SUMMARY ===`);
        console.log(`📦 Transactions: ${bundledTxns.length}`);
        console.log(`👥 Wallets selling: ${walletsWithTokens.length}`);
        console.log(`📊 Percentage: ${(supplyPercent * 100).toFixed(2)}% per wallet`);
        console.log(`💰 Jito tip: ${jitoTipAmt / LAMPORTS_PER_SOL} SOL`);
        console.log(`🏊 Pool: ${pool.toBase58()}`);
        
        const confirm = prompt("\n🔥 EXECUTE PUMPSWAP SELL BUNDLE? (y/yes): ").toLowerCase();
        if (confirm !== 'yes' && confirm !== 'y') {
            console.log("PumpSwap sell cancelled.");
            return;
        }

        // Send bundle
        const success = await sendBundle(bundledTxns);

        if (success) {
            console.log("🎉 PumpSwap sell completed successfully!");
            console.log("💡 Check your wallets for received WSOL/SOL");
        } else {
            console.log("❌ PumpSwap sell bundle failed");
        }

    } catch (error) {
        console.error("❌ PumpSwap sell function error:", error);
    }
}