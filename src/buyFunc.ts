// ✅ UNIFIED BUY FUNCTION - Auto-detects Pump.fun vs PumpSwap + Smart SOL Distribution
import { connection, wallet, payer, PUMP_PROGRAM, feeRecipient, eventAuthority, global as globalAccount } from "../config";
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
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// Wallet selection modes
enum WalletSelectionMode {
    ALL_WALLETS = 1,        // Buy with all wallets (creator + bundle wallets)
    BUNDLE_ONLY = 2,        // Buy only with bundle wallets (exclude creator)
    CREATOR_ONLY = 3        // Buy only with creator wallet
}

// Token platform enum
enum TokenPlatform {
    PUMP_FUN = "pump.fun",
    PUMPSWAP = "pumpswap"
}

interface WalletWithSOL {
    keypair: Keypair;
    solBalance: number;
    allocatedSOL: number;
    walletName: string;
}

interface BundleResult {
    bundleId: string | null;
    sent: boolean;
    verified: boolean;
    bundleNumber: number;
}

// ✅ MAIN UNIFIED BUY FUNCTION
export async function unifiedBuyFunction(): Promise<void> {
    console.log("🚀 UNIFIED BUY BUNDLER");
    console.log("=======================");
    console.log("🔍 Auto-detects Pump.fun vs PumpSwap");
    console.log("⚡ Smart SOL Distribution");
    console.log("📦 Randomized Buy Amounts");

    try {
        // Load token info
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
        if (!lookupTableAccount) {
            console.log("❌ ERROR: Lookup table not found!");
            return;
        }

        const mintKp = Keypair.fromSecretKey(Uint8Array.from(bs58.decode(poolInfo.mintPk)));
        console.log(`🎯 Token: ${mintKp.publicKey.toBase58()}`);

        // ✅ STEP 1: Auto-detect platform
        console.log("\n🔍 DETECTING TOKEN PLATFORM...");
        const platform = await detectTokenPlatform(mintKp.publicKey);
        
        if (platform === TokenPlatform.PUMP_FUN) {
            console.log("✅ Platform: Pump.fun (Bonding Curve)");
            console.log("🔗 View: https://pump.fun/" + mintKp.publicKey.toBase58());
        } else if (platform === TokenPlatform.PUMPSWAP) {
            console.log("✅ Platform: PumpSwap (Migrated/AMM)");
            console.log("🔗 View: https://pumpswap.co/" + mintKp.publicKey.toBase58());
        } else {
            console.log("❌ ERROR: Token not found on Pump.fun or PumpSwap!");
            return;
        }

        // ✅ STEP 2: Get user preferences
        console.log(`\n🎯 WALLET SELECTION OPTIONS:`);
        console.log(`1. Buy with ALL wallets (creator + bundle wallets)`);
        console.log(`2. Buy with BUNDLE wallets only (exclude creator)`);
        console.log(`3. Buy with CREATOR wallet only`);
        
        const selectionInput = prompt("Choose wallet selection mode (1/2/3): ");
        const selectionMode = parseInt(selectionInput) as WalletSelectionMode || WalletSelectionMode.ALL_WALLETS;

        const totalSOLInput = prompt("Total SOL amount to spend (Ex. 1.5): ");
        const totalSOL = parseFloat(totalSOLInput || '0');
        if (isNaN(totalSOL) || totalSOL <= 0) {
            console.log("❌ Invalid SOL amount!");
            return;
        }

        const slippageInput = prompt("Slippage tolerance % (default 15): ");
        const slippagePercent = slippageInput ? parseFloat(slippageInput) : 15;

        const jitoTipInput = prompt("Jito tip in Sol (Ex. 0.01): ");
        const jitoTipAmt = parseFloat(jitoTipInput || '0') * LAMPORTS_PER_SOL;
        if (jitoTipAmt <= 0) {
            console.log("❌ Invalid tip amount!");
            return;
        }

        const modeNames = {
            [WalletSelectionMode.ALL_WALLETS]: "ALL WALLETS",
            [WalletSelectionMode.BUNDLE_ONLY]: "BUNDLE WALLETS ONLY", 
            [WalletSelectionMode.CREATOR_ONLY]: "CREATOR WALLET ONLY"
        };

        console.log(`\n📊 BUY CONFIGURATION:`);
        console.log(`   Platform: ${platform}`);
        console.log(`   Mode: ${modeNames[selectionMode]}`);
        console.log(`   Total SOL: ${totalSOL} SOL`);
        console.log(`   Slippage: ${slippagePercent}%`);
        console.log(`   Jito tip: ${jitoTipAmt / LAMPORTS_PER_SOL} SOL`);

        // ✅ STEP 3: Get wallets with SOL and create distribution
        const walletsWithSOL = await getWalletsWithSOLDistribution(selectionMode, totalSOL);
        if (walletsWithSOL.length === 0) {
            console.log("❌ No wallets found with sufficient SOL!");
            return;
        }

        // ✅ STEP 4: Execute appropriate buy function
        if (platform === TokenPlatform.PUMP_FUN) {
            await executePumpFunBuy(
                mintKp.publicKey, 
                walletsWithSOL, 
                slippagePercent, 
                jitoTipAmt, 
                lookupTableAccount
            );
        } else {
            await executePumpSwapBuy(
                mintKp.publicKey, 
                walletsWithSOL, 
                slippagePercent, 
                jitoTipAmt, 
                lookupTableAccount
            );
        }

    } catch (error) {
        console.error("❌ Unified buy error:", error);
    }
}

// ✅ Function to detect which platform the token is on
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

// ✅ Find PumpSwap pool for token
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

interface WalletBalances {
    keypair: Keypair;
    walletName: string;
    nativeSOL: number;
    wrappedSOL: number;
    totalSOL: number;
}

// ✅ SMART SOL DISTRIBUTION WITH wSOL SUPPORT
async function getWalletsWithSOLDistribution(selectionMode: WalletSelectionMode, totalSOL: number): Promise<WalletWithSOL[]> {
    console.log("\n=== SMART SOL + wSOL DISTRIBUTION ===");
    console.log(`🎯 Total SOL to distribute: ${totalSOL} SOL`);
    
    const walletsWithSOL: WalletWithSOL[] = [];
    const keypairs = loadKeypairs();
    
    // ✅ STEP 1: Check both SOL and wSOL balances for all wallets
    const availableWallets: WalletBalances[] = [];
    
    // Check dev wallet (creator) if mode allows
    if (selectionMode === WalletSelectionMode.ALL_WALLETS || selectionMode === WalletSelectionMode.CREATOR_ONLY) {
        try {
            const balances = await getWalletBalances(wallet, "DEV WALLET (CREATOR)");
            if (balances.totalSOL > 0.01) {
                console.log(`✅ DEV WALLET: ${balances.nativeSOL.toFixed(4)} SOL + ${balances.wrappedSOL.toFixed(4)} wSOL = ${balances.totalSOL.toFixed(4)} total`);
                availableWallets.push(balances);
            } else {
                console.log(`⚠️  DEV WALLET: Insufficient funds (${balances.totalSOL.toFixed(4)} total)`);
            }
        } catch (error) {
            console.log(`⚠️  DEV WALLET: Balance check failed`);
        }
    }

    // Check bundle wallets if mode allows  
    if (selectionMode === WalletSelectionMode.ALL_WALLETS || selectionMode === WalletSelectionMode.BUNDLE_ONLY) {
        for (let i = 0; i < keypairs.length; i++) {
            const keypair = keypairs[i];
            try {
                const balances = await getWalletBalances(keypair, `Wallet ${i + 1} (BUNDLE)`);
                
                if (balances.totalSOL > 0.01) {
                    console.log(`✅ Wallet ${i + 1}: ${balances.nativeSOL.toFixed(4)} SOL + ${balances.wrappedSOL.toFixed(4)} wSOL = ${balances.totalSOL.toFixed(4)} total`);
                    availableWallets.push(balances);
                } else {
                    console.log(`⚪ Wallet ${i + 1}: Insufficient funds (${balances.totalSOL.toFixed(4)} total)`);
                }
            } catch (error) {
                console.log(`⚠️  Wallet ${i + 1}: Balance check failed`);
            }
        }
    }

    if (availableWallets.length === 0) {
        console.log("❌ No wallets with sufficient SOL+wSOL found!");
        return [];
    }

    // ✅ STEP 2: Calculate total available SOL+wSOL
    const totalAvailableSOL = availableWallets.reduce((sum, w) => sum + w.totalSOL, 0);
    console.log(`📊 Total available funds: ${totalAvailableSOL.toFixed(4)} SOL+wSOL`);
    console.log(`📊 Available wallets: ${availableWallets.length}`);

    if (totalSOL > totalAvailableSOL * 0.95) { // Leave 5% buffer for fees
        console.log(`❌ ERROR: Not enough SOL+wSOL! Need ${totalSOL} SOL, have ${(totalAvailableSOL * 0.95).toFixed(4)} SOL (with 5% fee buffer)`);
        return [];
    }

    // ✅ STEP 3: Create randomized distribution
    console.log(`\n🎲 CREATING RANDOMIZED DISTRIBUTION:`);
    console.log(`   Base allocation per wallet: ${(totalSOL / availableWallets.length).toFixed(4)} SOL`);
    console.log(`   Randomization: ±30% variance`);
    console.log(`   🔄 Auto wrap/unwrap as needed`);

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
                solBalance: wallet.totalSOL, // Store total for reference
                allocatedSOL: allocatedSOL,
                walletName: wallet.walletName
            });

            // Show breakdown of what will be used
            const needsWrapping = allocatedSOL > wallet.nativeSOL - 0.01;
            const wrappingInfo = needsWrapping ? ` (will use ${wallet.wrappedSOL.toFixed(4)} wSOL)` : ` (native SOL only)`;
            
            console.log(`  💰 ${wallet.walletName}: ${allocatedSOL.toFixed(4)} SOL (${((allocatedSOL / totalSOL) * 100).toFixed(1)}%)${wrappingInfo}`);
            remainingSOL -= allocatedSOL;
        } else {
            console.log(`  ⚠️  ${wallet.walletName}: Skipped (insufficient SOL+wSOL after fees)`);
        }
    }

    const actualTotal = walletsWithSOL.reduce((sum, w) => sum + w.allocatedSOL, 0);
    console.log(`\n📊 DISTRIBUTION SUMMARY:`);
    console.log(`   Requested: ${totalSOL.toFixed(4)} SOL`);
    console.log(`   Allocated: ${actualTotal.toFixed(4)} SOL`);
    console.log(`   Difference: ${(totalSOL - actualTotal).toFixed(4)} SOL`);
    console.log(`   Participating wallets: ${walletsWithSOL.length}/${availableWallets.length}`);

    return walletsWithSOL;
}
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

// ✅ PUMP.FUN BUY EXECUTION
async function executePumpFunBuy(
    mintAddress: PublicKey,
    walletsWithSOL: WalletWithSOL[],
    slippagePercent: number,
    jitoTipAmt: number,
    lookupTableAccount: any
): Promise<void> {
    console.log("\n🔄 EXECUTING PUMP.FUN BUY...");
    
    try {
        // Setup Anchor
        const provider = new anchor.AnchorProvider(
            connection,
            new anchor.Wallet(wallet),
            { commitment: "confirmed" }
        );

        const IDL_PumpFun = JSON.parse(fs.readFileSync("./pumpfun-IDL.json", "utf-8"));
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
        console.log("🔨 Building Pump.fun buy transactions...");
        const bundledTxns: VersionedTransaction[] = [];
        const { blockhash } = await connection.getLatestBlockhash();

        // Group wallets (5 per transaction for Pump.fun)
        const WALLETS_PER_TX = 5;
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
                        global: globalAccount,
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

                console.log(`  🚀 ${walletData.walletName}: ${walletData.allocatedSOL.toFixed(4)} SOL`);
            }

            // Add Jito tip to last transaction
            if (isLastChunk) {
                console.log(`  💰 Adding Jito tip: ${jitoTipAmt / LAMPORTS_PER_SOL} SOL`);
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
            console.log(`  📏 TX ${chunkIndex + 1} size: ${txSize}/1232 bytes`);
            
            if (txSize > 1232) {
                console.log(`  ❌ Transaction ${chunkIndex + 1} too large, skipping`);
                continue;
            }

            versionedTx.sign(signers);
            bundledTxns.push(versionedTx);
        }

        if (bundledTxns.length === 0) {
            console.log("❌ No valid transactions built!");
            return;
        }

        // Send bundle
        await sendBundleAndVerify([bundledTxns], "Pump.fun");

    } catch (error) {
        console.error("❌ Pump.fun buy error:", error);
    }
}

// ✅ PUMPSWAP BUY EXECUTION  
async function executePumpSwapBuy(
    mintAddress: PublicKey,
    walletsWithSOL: WalletWithSOL[],
    slippagePercent: number,
    jitoTipAmt: number,
    lookupTableAccount: any
): Promise<void> {
    console.log("\n🔄 EXECUTING PUMPSWAP BUY...");
    
    try {
        // Load PumpSwap IDL
        const PUMPSWAP_IDL = JSON.parse(fs.readFileSync("./pumpswap-IDL.json", "utf-8"));
        const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), { commitment: "confirmed" });
        const program = new anchor.Program(PUMPSWAP_IDL as any, provider);

        // Find pool
        const poolAddress = await findPumpSwapPool(mintAddress);
        if (!poolAddress) {
            console.log("❌ ERROR: PumpSwap pool not found!");
            return;
        }
        console.log(`✅ Pool: ${poolAddress.toBase58()}`);

        // Create smart bundles (3 wallets per TX for PumpSwap)
        const bundles = createSmartBundles(walletsWithSOL);
        const allBundledTxns: VersionedTransaction[][] = [];

        // Build all bundles
        for (let bundleIndex = 0; bundleIndex < bundles.length; bundleIndex++) {
            const bundleWallets = bundles[bundleIndex];
            const bundleNumber = bundleIndex + 1;
            
            console.log(`\n🔨 BUILDING BUNDLE ${bundleNumber}: ${bundleWallets.length} wallets`);
            
            const bundledTxns: VersionedTransaction[] = [];
            const { blockhash } = await connection.getLatestBlockhash();
            
            // Group wallets into transactions (3 wallets per tx)
            const WALLETS_PER_TX = 3;
            const walletChunks: WalletWithSOL[][] = [];
            for (let i = 0; i < bundleWallets.length; i += WALLETS_PER_TX) {
                walletChunks.push(bundleWallets.slice(i, i + WALLETS_PER_TX));
            }

            // Build each transaction
            for (let txIndex = 0; txIndex < walletChunks.length; txIndex++) {
                const walletChunk = walletChunks[txIndex];
                const isLastTxInBundle = txIndex === walletChunks.length - 1;
                
                console.log(`  📝 TX ${txIndex + 1}: ${walletChunk.length} wallets${isLastTxInBundle ? ' + TIP' : ''}`);
                
                const buyData = await buildPumpSwapBuyInstructions(
                    program,
                    walletChunk,
                    mintAddress,
                    poolAddress,
                    slippagePercent
                );
                
                if (!buyData) {
                    console.log(`    ❌ Failed to build TX ${txIndex + 1}`);
                    continue;
                }

                const txInstructions = [
                    ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 + (walletChunk.length * 150000) }),
                    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }),
                    ...buyData.instructions
                ];

                // Add Jito tip to last TX of each bundle
                if (isLastTxInBundle) {
                    console.log(`    💰 Adding Jito tip: ${jitoTipAmt / LAMPORTS_PER_SOL} SOL`);
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
                
                console.log(`    📏 Size: ${txSize}/1232 bytes`);
                
                if (txSize > 1232) {
                    console.log(`    ❌ TX too large, skipping`);
                    continue;
                }

                try {
                    versionedTx.sign(buyData.signers);
                    
                    // Simulate transaction
                    const simResult = await connection.simulateTransaction(versionedTx, {
                        commitment: "processed",
                        sigVerify: false,
                        replaceRecentBlockhash: true
                    });

                    if (simResult.value.err) {
                        console.log(`    ❌ Simulation failed:`, simResult.value.err);
                        continue;
                    }

                    console.log(`    ✅ Simulation SUCCESS! CU: ${simResult.value.unitsConsumed?.toLocaleString()}`);
                    bundledTxns.push(versionedTx);
                    
                } catch (error) {
                    console.log(`    ❌ TX build error:`, error);
                    continue;
                }
            }

            if (bundledTxns.length > 0) {
                allBundledTxns.push(bundledTxns);
            }
        }

        if (allBundledTxns.length === 0) {
            console.log("❌ No valid bundles were built!");
            return;
        }

        // Send bundles
        await sendBundleAndVerify(allBundledTxns, "PumpSwap");

    } catch (error) {
        console.error("❌ PumpSwap buy error:", error);
    }
}

// ✅ Helper function to create smart bundles for PumpSwap
function createSmartBundles(walletsWithSOL: WalletWithSOL[]): WalletWithSOL[][] {
    const WALLETS_PER_TX = 3;
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

// ✅ Helper function to build PumpSwap buy instructions
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
            
            // ✅ NEW: Get wallet's current balances to determine wrap/unwrap strategy
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

            // ✅ SMART WRAPPING STRATEGY
            if (availableWrappedSOL >= neededSOL) {
                // Case 1: Enough wSOL already - use it directly
                console.log(`      💫 ${walletData.walletName}: Using existing ${neededSOL.toFixed(4)} wSOL`);
            } else if (availableNativeSOL >= neededSOL) {
                // Case 2: Enough native SOL - wrap what we need
                console.log(`      🔄 ${walletData.walletName}: Wrapping ${neededSOL.toFixed(4)} SOL → wSOL`);
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
                console.log(`      🔄 ${walletData.walletName}: Using ${availableWrappedSOL.toFixed(4)} wSOL + wrapping ${additionalWrapNeeded.toFixed(4)} SOL`);
                
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
                    console.log(`      ⚠️  ${walletData.walletName}: Insufficient combined funds, skipping`);
                    continue;
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
        console.error("❌ Error building PumpSwap buy instructions:", error);
        return null;
    }
}

// ✅ Helper functions

// Estimate tokens out for Pump.fun
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

// Get expected tokens out for PumpSwap
async function getExpectedTokensOut(poolAddress: PublicKey, solAmount: BN, baseMint: PublicKey): Promise<BN> {
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

// ✅ Send bundle and verify results
async function sendBundleAndVerify(bundlesList: VersionedTransaction[][], platform: string): Promise<void> {
    console.log(`\n🚀 SENDING ${bundlesList.length} BUNDLE(S) TO JITO`);
    
    try {
        if (bundlesList.length === 1) {
            // Single bundle
            const bundledTxns = bundlesList[0];
            console.log(`📤 Sending ${platform} bundle: ${bundledTxns.length} transactions`);
            
            const bundleId = await searcherClient.sendBundle(new JitoBundle(bundledTxns, bundledTxns.length));
            console.log(`✅ Bundle sent! ID: ${bundleId}`);
            
            // Show transaction signatures
            console.log(`📋 Transaction signatures:`);
            for (let i = 0; i < bundledTxns.length; i++) {
                const signature = bs58.encode(bundledTxns[i].signatures[0]);
                console.log(`   TX ${i + 1}: https://solscan.io/tx/${signature}`);
            }
            
            // Wait and verify
            console.log("⏳ Waiting 10 seconds for bundle processing...");
            await new Promise(resolve => setTimeout(resolve, 10000));
            
            const success = await verifyBundleManually(bundledTxns, 1);
            console.log(`\n🎉 ${platform} BUY ${success ? 'SUCCESSFUL' : 'FAILED'}!`);
            
        } else {
            // Multiple bundles - send simultaneously
            const bundlePromises = bundlesList.map(async (bundledTxns, index) => {
                const bundleNumber = index + 1;
                console.log(`📤 Queueing Bundle ${bundleNumber}: ${bundledTxns.length} transactions`);
                
                try {
                    const bundleId = await searcherClient.sendBundle(new JitoBundle(bundledTxns, bundledTxns.length));
                    console.log(`✅ Bundle ${bundleNumber} sent! ID: ${bundleId}`);
                    return { bundleNumber, success: true, bundledTxns };
                } catch (error) {
                    console.error(`❌ Bundle ${bundleNumber} failed:`, error);
                    return { bundleNumber, success: false, bundledTxns };
                }
            });
            
            const results = await Promise.allSettled(bundlePromises);
            
            // Wait and verify all bundles
            console.log("⏳ Waiting 10 seconds for bundle processing...");
            await new Promise(resolve => setTimeout(resolve, 10000));
            
            let successCount = 0;
            for (const result of results) {
                if (result.status === 'fulfilled' && result.value.success) {
                    const verified = await verifyBundleManually(result.value.bundledTxns, result.value.bundleNumber);
                    if (verified) successCount++;
                }
            }
            
            console.log(`\n🎉 ${platform} BUY RESULTS: ${successCount}/${bundlesList.length} bundles successful!`);
        }
        
    } catch (error) {
        console.error(`❌ ${platform} bundle error:`, error);
    }
}

// ✅ Verify bundle manually via signature checks
async function verifyBundleManually(bundledTxns: VersionedTransaction[], bundleNumber: number): Promise<boolean> {
    try {
        console.log(`🔍 Verifying Bundle ${bundleNumber}...`);
        
        let successCount = 0;
        
        for (let i = 0; i < bundledTxns.length; i++) {
            const signature = bs58.encode(bundledTxns[i].signatures[0]);
            
            try {
                const status = await connection.getSignatureStatus(signature, { 
                    searchTransactionHistory: true 
                });
                
                if (status.value?.confirmationStatus && !status.value.err) {
                    console.log(`✅ Bundle ${bundleNumber} TX ${i + 1}: CONFIRMED`);
                    console.log(`    🔗 https://solscan.io/tx/${signature}`);
                    successCount++;
                } else if (status.value?.err) {
                    console.log(`❌ Bundle ${bundleNumber} TX ${i + 1}: FAILED`);
                } else {
                    console.log(`⏳ Bundle ${bundleNumber} TX ${i + 1}: PENDING`);
                }
            } catch (error) {
                console.log(`⚠️  Bundle ${bundleNumber} TX ${i + 1}: Status check failed`);
            }
        }
        
        return successCount > 0;
        
    } catch (error) {
        console.error(`❌ Bundle ${bundleNumber} verification error:`, error);
        return false;
    }
}