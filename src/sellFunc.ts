// ✅ UNIFIED SELL FUNCTION - Auto-detects Pump.fun vs PumpSwap
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
    ALL_WALLETS = 1,        // Sell from all wallets (creator + bundle wallets)
    BUNDLE_ONLY = 2,        // Sell only from bundle wallets (exclude creator)
    CREATOR_ONLY = 3        // Sell only from creator wallet
}

// Token platform enum
enum TokenPlatform {
    PUMP_FUN = "pump.fun",
    PUMPSWAP = "pumpswap"
}

interface WalletWithTokens {
    keypair: Keypair;
    tokenBalance: number;
    walletName: string;
}

interface BundleResult {
    bundleId: string | null;
    sent: boolean;
    verified: boolean;
    bundleNumber: number;
}

// ✅ MAIN UNIFIED SELL FUNCTION
export async function unifiedSellFunction(): Promise<void> {
    console.log("🎯 UNIFIED SELL BUNDLER");
    console.log("========================");
    console.log("🔍 Auto-detects Pump.fun vs PumpSwap");
    console.log("⚡ Smart Wallet Selection");
    console.log("📦 Optimized Bundling Strategy");

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
        console.log(`1. Sell from ALL wallets (creator + bundle wallets)`);
        console.log(`2. Sell from BUNDLE wallets only (exclude creator)`);
        console.log(`3. Sell from CREATOR wallet only`);
        
        const selectionInput = prompt("Choose wallet selection mode (1/2/3): ");
        const selectionMode = parseInt(selectionInput) as WalletSelectionMode || WalletSelectionMode.ALL_WALLETS;

        const supplyPercentInput = prompt("Percentage to sell (Ex. 1 for 1%, 100 for 100%): ");
        const supplyPercentNum = parseFloat(supplyPercentInput?.replace('%', '') || '0');
        if (isNaN(supplyPercentNum) || supplyPercentNum <= 0 || supplyPercentNum > 100) {
            console.log("❌ Invalid percentage!");
            return;
        }
        const supplyPercent = supplyPercentNum / 100;

        const slippageInput = prompt("Slippage tolerance % (default 10): ");
        const slippagePercent = slippageInput ? parseFloat(slippageInput) : 10;

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

        console.log(`\n📊 SELL CONFIGURATION:`);
        console.log(`   Platform: ${platform}`);
        console.log(`   Mode: ${modeNames[selectionMode]}`);
        console.log(`   Percentage: ${(supplyPercent * 100).toFixed(2)}%`);
        console.log(`   Slippage: ${slippagePercent}%`);
        console.log(`   Jito tip: ${jitoTipAmt / LAMPORTS_PER_SOL} SOL`);

        // ✅ STEP 3: Execute appropriate sell function
        if (platform === TokenPlatform.PUMP_FUN) {
            await executePumpFunSell(
                mintKp.publicKey, 
                selectionMode, 
                supplyPercent, 
                slippagePercent, 
                jitoTipAmt, 
                lookupTableAccount
            );
        } else {
            await executePumpSwapSell(
                mintKp.publicKey, 
                selectionMode, 
                supplyPercent, 
                slippagePercent, 
                jitoTipAmt, 
                lookupTableAccount
            );
        }

    } catch (error) {
        console.error("❌ Unified sell error:", error);
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

// ✅ Get wallets with tokens based on selection mode
async function getAllWalletsWithTokens(mintAddress: PublicKey, selectionMode: WalletSelectionMode): Promise<WalletWithTokens[]> {
    console.log("\n=== SCANNING WALLETS FOR TOKENS ===");
    
    const walletsWithTokens: WalletWithTokens[] = [];
    const keypairs = loadKeypairs();
    
    // Check dev wallet (creator) if mode allows
    if (selectionMode === WalletSelectionMode.ALL_WALLETS || selectionMode === WalletSelectionMode.CREATOR_ONLY) {
        try {
            const devTokenAccount = spl.getAssociatedTokenAddressSync(mintAddress, wallet.publicKey);
            const devBalance = await connection.getTokenAccountBalance(devTokenAccount);
            const devTokens = Number(devBalance.value.amount);
            
            if (devTokens > 0) {
                console.log(`✅ DEV WALLET (CREATOR): ${(devTokens / 1e6).toFixed(2)}M tokens`);
                walletsWithTokens.push({
                    keypair: wallet,
                    tokenBalance: devTokens,
                    walletName: "DEV WALLET (CREATOR)"
                });
            }
        } catch (error) {
            console.log(`⚠️  DEV WALLET: No token account found`);
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
                
                if (tokens > 1000000) { // More than 1 token (6 decimals)
                    console.log(`✅ Wallet ${i + 1} (BUNDLE): ${(tokens / 1e6).toFixed(2)}M tokens`);
                    walletsWithTokens.push({
                        keypair: keypair,
                        tokenBalance: tokens,
                        walletName: `Wallet ${i + 1} (BUNDLE)`
                    });
                }
            } catch (error) {
                // Silent - no token account
            }
        }
    }

    console.log(`📊 Found ${walletsWithTokens.length} wallets with tokens`);
    return walletsWithTokens;
}

// ✅ PUMP.FUN SELL EXECUTION
async function executePumpFunSell(
    mintAddress: PublicKey,
    selectionMode: WalletSelectionMode,
    supplyPercent: number,
    slippagePercent: number,
    jitoTipAmt: number,
    lookupTableAccount: any
): Promise<void> {
    console.log("\n🔄 EXECUTING PUMP.FUN SELL...");
    
    try {
        // Setup Anchor
        const provider = new anchor.AnchorProvider(
            connection,
            new anchor.Wallet(wallet),
            { commitment: "confirmed" }
        );

        const IDL_PumpFun = JSON.parse(fs.readFileSync("./pumpfun-IDL.json", "utf-8"));
        const program = new anchor.Program(IDL_PumpFun, provider);

        // Get wallets with tokens
        const walletsWithTokens = await getAllWalletsWithTokens(mintAddress, selectionMode);
        if (walletsWithTokens.length === 0) {
            console.log("❌ No wallets found with tokens!");
            return;
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
        console.log("🔨 Building Pump.fun sell transactions...");
        const bundledTxns: VersionedTransaction[] = [];
        const { blockhash } = await connection.getLatestBlockhash();

        // Group wallets (5 per transaction for Pump.fun)
        const WALLETS_PER_TX = 5;
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
                    .sell(new BN(sellAmount), new BN(0)) // min SOL out = 0 (accept slippage)
                    .accounts({
                        global: globalAccount,
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

                console.log(`  📤 ${walletData.walletName}: ${(sellAmount / 1e6).toFixed(2)}M tokens`);
            }

            // Add Jito tip to last transaction
            if (isLastChunk) {
                console.log(`  💰 Adding Jito tip: ${jitoTipAmt / LAMPORTS_PER_SOL} SOL`);
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
        console.error("❌ Pump.fun sell error:", error);
    }
}

// ✅ PUMPSWAP SELL EXECUTION  
async function executePumpSwapSell(
    mintAddress: PublicKey,
    selectionMode: WalletSelectionMode,
    supplyPercent: number,
    slippagePercent: number,
    jitoTipAmt: number,
    lookupTableAccount: any
): Promise<void> {
    console.log("\n🔄 EXECUTING PUMPSWAP SELL...");
    
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

        // Get wallets with tokens
        const walletsWithTokens = await getAllWalletsWithTokens(mintAddress, selectionMode);
        if (walletsWithTokens.length === 0) {
            console.log("❌ No wallets found with tokens!");
            return;
        }

        // Create smart bundles (3 wallets per TX for PumpSwap)
        const bundles = createSmartBundles(walletsWithTokens);
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
            const walletChunks: WalletWithTokens[][] = [];
            for (let i = 0; i < bundleWallets.length; i += WALLETS_PER_TX) {
                walletChunks.push(bundleWallets.slice(i, i + WALLETS_PER_TX));
            }

            // Build each transaction
            for (let txIndex = 0; txIndex < walletChunks.length; txIndex++) {
                const walletChunk = walletChunks[txIndex];
                const isLastTxInBundle = txIndex === walletChunks.length - 1;
                
                console.log(`  📝 TX ${txIndex + 1}: ${walletChunk.length} wallets${isLastTxInBundle ? ' + TIP' : ''}`);
                
                const sellData = await buildPumpSwapSellInstructions(
                    program,
                    walletChunk,
                    mintAddress,
                    poolAddress,
                    supplyPercent,
                    slippagePercent
                );
                
                if (!sellData) {
                    console.log(`    ❌ Failed to build TX ${txIndex + 1}`);
                    continue;
                }

                const txInstructions = [
                    ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 + (walletChunk.length * 150000) }),
                    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }),
                    ...sellData.instructions
                ];

                // Add Jito tip to last TX of each bundle
                if (isLastTxInBundle) {
                    console.log(`    💰 Adding Jito tip: ${jitoTipAmt / LAMPORTS_PER_SOL} SOL`);
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
                
                console.log(`    📏 Size: ${txSize}/1232 bytes`);
                
                if (txSize > 1232) {
                    console.log(`    ❌ TX too large, skipping`);
                    continue;
                }

                try {
                    versionedTx.sign(sellData.signers);
                    
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
        console.error("❌ PumpSwap sell error:", error);
    }
}

// ✅ Helper function to create smart bundles for PumpSwap
function createSmartBundles(walletsWithTokens: WalletWithTokens[]): WalletWithTokens[][] {
    const WALLETS_PER_TX = 3;
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

// ✅ Helper function to build PumpSwap sell instructions
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

            console.log(`      📤 ${walletData.walletName}: ${(sellAmount / 1e6).toFixed(2)}M tokens`);
        }

        signers.unshift(payerWallet);
        
        return { instructions, payer: payerWallet.publicKey, signers };

    } catch (error) {
        console.error("❌ Error building PumpSwap sell instructions:", error);
        return null;
    }
}

// ✅ Helper functions for PumpSwap
async function getExpectedSolOutput(poolAddress: PublicKey, sellTokenAmount: BN, baseMint: PublicKey): Promise<BN> {
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

        const k = baseReserve.mul(quoteReserve);
        const newBaseReserve = baseReserve.add(sellTokenAmount);
        const newQuoteReserve = k.div(newBaseReserve);
        const expectedSolOutput = quoteReserve.sub(newQuoteReserve);
        
        return expectedSolOutput;
        
    } catch (error) {
        return new BN(Math.floor(sellTokenAmount.toNumber() * 0.000001)); 
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
            console.log(`\n🎉 ${platform} SELL ${success ? 'SUCCESSFUL' : 'FAILED'}!`);
            
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
            
            console.log(`\n🎉 ${platform} SELL RESULTS: ${successCount}/${bundlesList.length} bundles successful!`);
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