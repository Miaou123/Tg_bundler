// ✅ ENHANCED PUMPSWAP BUNDLER - Wallet Selection + Simultaneous Bundles + Manual Bundle Status Check
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
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// Load PumpSwap IDL 
const PUMPSWAP_IDL = JSON.parse(fs.readFileSync("./pumpswap-IDL.json", "utf-8"));

// Global config PDA
const [GLOBAL_CONFIG] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    PUMPSWAP_PROGRAM_ID
);

interface WalletWithTokens {
    keypair: Keypair;
    tokenBalance: number;
    walletName: string;
}

// ✅ Bundle result tracking interface
interface BundleResult {
    bundleId: string | null;
    sent: boolean;
    verified: boolean;
    bundleNumber: number;
}

// ✅ NEW: Wallet selection modes
enum WalletSelectionMode {
    ALL_WALLETS = 1,        // Sell from all wallets (creator + bundle wallets)
    BUNDLE_ONLY = 2,        // Sell only from bundle wallets (exclude creator)
    CREATOR_ONLY = 3        // Sell only from creator wallet
}

// ✅ Function to get expected SOL output using AMM math
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

        const k = baseReserve.mul(quoteReserve);
        const newBaseReserve = baseReserve.add(sellTokenAmount);
        const newQuoteReserve = k.div(newBaseReserve);
        const expectedSolOutput = quoteReserve.sub(newQuoteReserve);
        
        return expectedSolOutput;
        
    } catch (error) {
        console.error("❌ Error calculating expected SOL output:", error);
        return new BN(Math.floor(sellTokenAmount.toNumber() * 0.000001)); 
    }
}

// ✅ Function to get protocol fee recipients
async function getProtocolFeeRecipients(): Promise<PublicKey[]> {
    try {
        const globalConfigInfo = await connection.getAccountInfo(GLOBAL_CONFIG);
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
        console.error("❌ Error fetching protocol fee recipients:", error);
        return [];
    }
}

// ✅ Function to find pool for token
async function findPoolForToken(mintAddress: PublicKey): Promise<PublicKey | null> {
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
        console.error("❌ Error finding pool:", error);
        return null;
    }
}

// ✅ Function to get pool coin creator
async function getPoolCoinCreator(poolAddress: PublicKey): Promise<PublicKey | null> {
    try {
        const poolAccountInfo = await connection.getAccountInfo(poolAddress);
        if (!poolAccountInfo) return null;

        const coinCreatorOffset = 8 + 1 + 2 + 32 + 32 + 32 + 32 + 32 + 32 + 8;
        const coinCreatorBytes = poolAccountInfo.data.slice(coinCreatorOffset, coinCreatorOffset + 32);
        
        return new PublicKey(coinCreatorBytes);
    } catch (error) {
        console.error("Error getting pool coin creator:", error);
        return null;
    }
}

// ✅ Build multiple sell instructions for one transaction
async function buildMultipleSellInstructions(
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
        
        // Get shared accounts once
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
                    globalConfig: GLOBAL_CONFIG,
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
        console.error("❌ Error building multiple sell instructions:", error);
        return null;
    }
}

// ✅ NEW: Function to scan wallets with selection mode
async function getAllWalletsWithTokens(mintAddress: PublicKey, selectionMode: WalletSelectionMode): Promise<WalletWithTokens[]> {
    console.log("\n=== SCANNING WALLETS FOR PUMPSWAP TOKENS ===");
    
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

    const modeNames = {
        [WalletSelectionMode.ALL_WALLETS]: "ALL WALLETS",
        [WalletSelectionMode.BUNDLE_ONLY]: "BUNDLE WALLETS ONLY", 
        [WalletSelectionMode.CREATOR_ONLY]: "CREATOR WALLET ONLY"
    };

    console.log(`📊 Mode: ${modeNames[selectionMode]}`);
    console.log(`📊 Found ${walletsWithTokens.length} wallets with tokens`);
    return walletsWithTokens;
}

// ✅ NEW: Smart bundling with wallet selection awareness
function createSmartBundles(walletsWithTokens: WalletWithTokens[]): WalletWithTokens[][] {
    const WALLETS_PER_TX = 3;
    const MAX_SELLS_PER_BUNDLE = 15;
    
    const chunks: WalletWithTokens[][] = [];
    
    for (let i = 0; i < walletsWithTokens.length; i += WALLETS_PER_TX) {
        const chunk = walletsWithTokens.slice(i, i + WALLETS_PER_TX);
        chunks.push(chunk);
    }
    
    console.log(`📦 SMART BUNDLING STRATEGY:`);
    console.log(`   Total wallets: ${walletsWithTokens.length}`);
    console.log(`   Transactions needed: ${chunks.length} (${WALLETS_PER_TX} wallets per TX)`);
    
    if (walletsWithTokens.length > MAX_SELLS_PER_BUNDLE) {
        const txsPerBundle = Math.ceil(chunks.length / 2);
        console.log(`   ⚠️  More than ${MAX_SELLS_PER_BUNDLE} sells - splitting into 2 bundles`);
        console.log(`   Bundle 1: ${txsPerBundle} transactions`);
        console.log(`   Bundle 2: ${chunks.length - txsPerBundle} transactions`);
        
        return [
            chunks.slice(0, txsPerBundle).flat(),
            chunks.slice(txsPerBundle).flat()
        ];
    } else {
        console.log(`   ✅ Single bundle: ${chunks.length} transactions`);
        return [walletsWithTokens];
    }
}

// ✅ FIXED: Manual bundle verification via on-chain signature checks
async function verifyBundleManually(bundledTxns: VersionedTransaction[], bundleNumber: number): Promise<boolean> {
    try {
        console.log(`🔍 Checking Bundle ${bundleNumber} status via signature verification...`);
        
        let successCount = 0;
        let failCount = 0;
        let notFoundCount = 0;
        
        for (let i = 0; i < bundledTxns.length; i++) {
            const tx = bundledTxns[i];
            const signature = bs58.encode(tx.signatures[0]);
            
            try {
                const status = await connection.getSignatureStatus(signature, { 
                    searchTransactionHistory: true 
                });
                
                if (status.value?.confirmationStatus) {
                    const isSuccess = !status.value.err;
                    console.log(`${isSuccess ? '✅' : '❌'} Bundle ${bundleNumber} TX ${i + 1}: ${status.value.confirmationStatus.toUpperCase()}${status.value.err ? ` (Error)` : ''}`);
                    
                    if (isSuccess) {
                        successCount++;
                        console.log(`    🔗 https://solscan.io/tx/${signature}`);
                    } else {
                        failCount++;
                    }
                } else {
                    console.log(`⏳ Bundle ${bundleNumber} TX ${i + 1}: Not found on-chain yet`);
                    notFoundCount++;
                }
            } catch (error) {
                console.log(`⚠️  Bundle ${bundleNumber} TX ${i + 1}: Status check failed`);
                notFoundCount++;
            }
        }
        
        console.log(`📊 Bundle ${bundleNumber} results: ${successCount} success, ${failCount} failed, ${notFoundCount} not found`);
        return successCount > 0;
        
    } catch (error) {
        console.error(`❌ Error checking Bundle ${bundleNumber} status:`, error);
        return false;
    }
}

// ✅ FIXED: Simultaneous bundle sending with proper Result handling
async function sendBundlesSimultaneously(
    bundledTxnsList: VersionedTransaction[][],
    jitoTipAmt: number
): Promise<BundleResult[]> {
    console.log(`\n🚀 SENDING ${bundledTxnsList.length} BUNDLES SIMULTANEOUSLY`);
    
    const bundlePromises: Promise<any>[] = [];
    const bundleResults: BundleResult[] = [];
    
    try {
        // Send all bundles at the same time
        for (let i = 0; i < bundledTxnsList.length; i++) {
            const bundledTxns = bundledTxnsList[i];
            const bundleNumber = i + 1;
            
            console.log(`📤 Queueing Bundle ${bundleNumber}: ${bundledTxns.length} transactions`);
            
            // ✅ FIX: Handle the Result type from sendBundle
            const bundlePromise = searcherClient.sendBundle(new JitoBundle(bundledTxns, bundledTxns.length))
                .then(result => ({ bundleNumber, result, bundledTxns }));
            bundlePromises.push(bundlePromise);
        }
        
        // Wait for all bundles to be sent
        console.log(`⚡ Sending all ${bundledTxnsList.length} bundles simultaneously...`);
        const results = await Promise.allSettled(bundlePromises);
        
        // Process results
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const bundleNumber = i + 1;
            
            if (result.status === 'fulfilled') {
                const { result: bundleResult, bundledTxns } = result.value;
                
                // ✅ FIX: Handle the Result type properly
                if (bundleResult.ok) {
                    const bundleId = bundleResult.value;
                    bundleResults.push({
                        bundleId: bundleId,
                        sent: true,
                        verified: false,
                        bundleNumber: bundleNumber
                    });
                    
                    console.log(`✅ Bundle ${bundleNumber} sent! ID: ${bundleId}`);
                    
                    // Show transaction signatures
                    console.log(`📋 Bundle ${bundleNumber} signatures:`);
                    for (let j = 0; j < bundledTxns.length; j++) {
                        const tx = bundledTxns[j];
                        const signature = bs58.encode(tx.signatures[0]);
                        console.log(`   TX ${j + 1}: https://solscan.io/tx/${signature}`);
                    }
                } else {
                    console.error(`❌ Bundle ${bundleNumber} send failed:`, bundleResult.error);
                    bundleResults.push({
                        bundleId: null,
                        sent: false,
                        verified: false,
                        bundleNumber: bundleNumber
                    });
                }
            } else {
                console.error(`❌ Bundle ${bundleNumber} promise failed:`, result.reason);
                bundleResults.push({
                    bundleId: null,
                    sent: false,
                    verified: false,
                    bundleNumber: bundleNumber
                });
            }
        }
        
        return bundleResults;
        
    } catch (error) {
        console.error("❌ Error sending bundles simultaneously:", error);
        return [];
    }
}

// ✅ FIXED: Enhanced verification using manual signature checks
async function verifyAllBundles(bundleResults: BundleResult[], allBundledTxns: VersionedTransaction[][]): Promise<boolean[]> {
    console.log(`\n🔍 VERIFYING ${bundleResults.length} BUNDLES VIA SIGNATURE CHECKS`);
    
    const results: boolean[] = [];
    
    // Wait a bit for bundles to be processed
    console.log("⏳ Waiting 10 seconds for bundle processing...");
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Check each bundle status
    for (let i = 0; i < bundleResults.length; i++) {
        const bundleResult = bundleResults[i];
        const bundleNumber = bundleResult.bundleNumber;
        
        if (!bundleResult.sent || !bundleResult.bundleId) {
            console.log(`❌ Bundle ${bundleNumber}: Send failed, skipping verification`);
            results.push(false);
            continue;
        }
        
        const bundledTxns = allBundledTxns[i];
        const success = await verifyBundleManually(bundledTxns, bundleNumber);
        results.push(success);
    }
    
    return results;
}

// ✅ MAIN FUNCTION - Enhanced with wallet selection and simultaneous bundles
export async function sellXPercentagePUMPSWAP(): Promise<void> {
    console.log("🚀 ENHANCED PUMPSWAP BUNDLER");
    console.log("==============================");
    console.log("⚡ 3 Sell Instructions per Transaction");
    console.log("📦 Smart Bundling + Simultaneous Sending");
    console.log("🔍 Manual Signature Verification");

    try {
        // Setup
        const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), { commitment: "confirmed" });
        const program = new anchor.Program(PUMPSWAP_IDL as any, provider);

        // Load keyInfo
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

        // Find pool
        const poolAddress = await findPoolForToken(mintKp.publicKey);
        if (!poolAddress) {
            console.log("❌ ERROR: PumpSwap pool not found!");
            return;
        }
        console.log(`✅ Pool: ${poolAddress.toBase58()}`);

        // ✅ NEW: Wallet selection mode
        console.log(`\n🎯 WALLET SELECTION OPTIONS:`);
        console.log(`1. Sell from ALL wallets (creator + bundle wallets)`);
        console.log(`2. Sell from BUNDLE wallets only (exclude creator)`);
        console.log(`3. Sell from CREATOR wallet only`);
        
        const selectionInput = prompt("Choose wallet selection mode (1/2/3): ");
        const selectionMode = parseInt(selectionInput) as WalletSelectionMode;
        
        if (![1, 2, 3].includes(selectionMode)) {
            console.log("❌ Invalid selection! Using mode 1 (ALL wallets)");
        }

        // Get other inputs
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

        console.log(`\n📊 CONFIGURATION:`);
        console.log(`   Mode: ${modeNames[selectionMode] || 'ALL WALLETS'}`);
        console.log(`   Percentage: ${(supplyPercent * 100).toFixed(2)}%`);
        console.log(`   Slippage: ${slippagePercent}%`);
        console.log(`   Jito tip: ${jitoTipAmt / LAMPORTS_PER_SOL} SOL`);

        // ✅ Get wallets based on selection mode
        const walletsWithTokens = await getAllWalletsWithTokens(mintKp.publicKey, selectionMode || WalletSelectionMode.ALL_WALLETS);
        if (walletsWithTokens.length === 0) {
            console.log("❌ No wallets found with tokens!");
            return;
        }

        // Create smart bundles
        const bundles = createSmartBundles(walletsWithTokens);
        
        console.log(`\n=== BUILDING OPTIMIZED TRANSACTIONS ===`);
        
        const allBundledTxns: VersionedTransaction[][] = [];

        // Build all bundles
        for (let bundleIndex = 0; bundleIndex < bundles.length; bundleIndex++) {
            const bundleWallets = bundles[bundleIndex];
            const bundleNumber = bundleIndex + 1;
            
            console.log(`\n🔨 BUILDING BUNDLE ${bundleNumber}:`);
            console.log(`   Wallets in bundle: ${bundleWallets.length}`);
            
            const bundledTxns: VersionedTransaction[] = [];
            const { blockhash } = await connection.getLatestBlockhash();
            
            // Group wallets into transactions (3 wallets per tx)
            const WALLETS_PER_TX = 3;
            const walletChunks: WalletWithTokens[][] = [];
            for (let i = 0; i < bundleWallets.length; i += WALLETS_PER_TX) {
                walletChunks.push(bundleWallets.slice(i, i + WALLETS_PER_TX));
            }
            
            console.log(`   Transactions in bundle: ${walletChunks.length}`);

            // Build each transaction
            for (let txIndex = 0; txIndex < walletChunks.length; txIndex++) {
                const walletChunk = walletChunks[txIndex];
                const isLastTxInBundle = txIndex === walletChunks.length - 1;
                const shouldAddTip = isLastTxInBundle;
                
                console.log(`\n  📝 TX ${txIndex + 1}: ${walletChunk.length} wallets${shouldAddTip ? ' + TIP' : ''}`);
                
                const sellData = await buildMultipleSellInstructions(
                    program,
                    walletChunk,
                    mintKp.publicKey,
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
                if (shouldAddTip) {
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

        // ✅ FIXED: Send all bundles simultaneously with proper Result handling
        const bundleResults = await sendBundlesSimultaneously(allBundledTxns, jitoTipAmt);
        
        if (bundleResults.length === 0) {
            console.log("❌ Failed to send any bundles!");
            return;
        }

        // ✅ FIXED: Verify all bundles using manual signature checks
        const bundleVerificationResults = await verifyAllBundles(bundleResults, allBundledTxns);
        
        // Final results
        const successfulBundles = bundleVerificationResults.filter(Boolean).length;
        const sentBundles = bundleResults.filter(result => result.sent).length;
        
        console.log(`\n🎉 FINAL RESULTS:`);
        console.log(`   Bundles built: ${allBundledTxns.length}`);
        console.log(`   Bundles sent: ${sentBundles}`);
        console.log(`   Successful bundles: ${successfulBundles}`);
        console.log(`   Overall success: ${successfulBundles > 0 ? '✅' : '❌'}`);
        console.log(`   Wallet mode: ${modeNames[selectionMode || WalletSelectionMode.ALL_WALLETS]}`);

        // Show bundle details
        console.log(`\n📋 BUNDLE DETAILS:`);
        for (let i = 0; i < bundleResults.length; i++) {
            const result = bundleResults[i];
            const verified = bundleVerificationResults[i];
            console.log(`   Bundle ${result.bundleNumber}: ${result.sent ? '📤 SENT' : '❌ FAILED'} | ${verified ? '✅ VERIFIED' : '⏳ PENDING'}`);
            if (result.bundleId) {
                console.log(`     ID: ${result.bundleId}`);
            }
        }

    } catch (error) {
        console.error("❌ Enhanced PumpSwap sell error:", error);
    }
}