import { connection, wallet, PUMP_PROGRAM, feeRecipient, eventAuthority, global as globalAccount, MPL_TOKEN_METADATA_PROGRAM_ID, mintAuthority, rpc, payer } from "../config";
import {
	PublicKey,
	VersionedTransaction,
	TransactionInstruction,
	SYSVAR_RENT_PUBKEY,
	TransactionMessage,
	SystemProgram,
	Keypair,
	LAMPORTS_PER_SOL,
	AddressLookupTableAccount,
	ComputeBudgetProgram,
} from "@solana/web3.js";
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
import axios from "axios";
import * as anchor from "@coral-xyz/anchor";

const prompt = promptSync();
const keyInfoPath = path.join(__dirname, "keyInfo.json");

interface ValidWallet {
    keypair: Keypair;
    amount: BN;
    solAmount: BN;
    index: number;
}

function chunkArray<T>(array: T[], size: number): T[][] {
	return Array.from({ length: Math.ceil(array.length / size) }, (v, i) => array.slice(i * size, i * size + size));
}

// ✅ MAIN BUNDLE FUNCTION - Multi-Transaction Bundle
export async function buyBundle() {
    console.log("🚀 PROFESSIONAL PUMP.FUN BUNDLER");
    console.log("=================================");
    console.log("📦 Multi-Transaction Bundle Strategy");
    console.log("⚡ Optimized for Maximum Wallets");
    
    const provider = new anchor.AnchorProvider(
        connection,
        new anchor.Wallet(wallet),
        { commitment: "confirmed" }
    );

    const IDL_PumpFun = JSON.parse(fs.readFileSync("./pumpfun-IDL.json", "utf-8"));
    const program = new anchor.Program(IDL_PumpFun, provider);

    let keyInfo: { [key: string]: any } = {};
    if (fs.existsSync(keyInfoPath)) {
        const existingData = fs.readFileSync(keyInfoPath, "utf-8");
        keyInfo = JSON.parse(existingData);
    }

    console.log("\n=== SYSTEM CHECK ===");
    console.log(`Dev Wallet: ${wallet.publicKey.toString()}`);
    console.log(`Payer: ${payer.publicKey.toString()}`);

    // ✅ STEP 1: Verify LUT exists
    if (!keyInfo.addressLUT) {
        console.log("❌ ERROR: No LUT found!");
        console.log("Please run the following steps first:");
        console.log("1. Pre Launch Checklist → Create LUT");
        console.log("2. Pre Launch Checklist → Extend LUT Bundle");
        console.log("3. Pre Launch Checklist → Simulate Buys");
        console.log("4. Pre Launch Checklist → Send Simulation SOL Bundle");
        return;
    }

    const lut = new PublicKey(keyInfo.addressLUT.toString());
    console.log(`✅ LUT: ${lut.toString()}`);

    const lookupTableAccount = (await connection.getAddressLookupTable(lut)).value;
    if (lookupTableAccount == null) {
        console.log("❌ ERROR: LUT not found on-chain!");
        return;
    }

    console.log(`✅ LUT loaded with ${lookupTableAccount.state.addresses.length} addresses`);

    // ✅ STEP 2: Collect token metadata
    console.log("\n=== TOKEN METADATA ===");
    const name = prompt("Token name: ");
    const symbol = prompt("Token symbol: ");
    const description = prompt("Token description: ");
    const twitter = prompt("Twitter (optional): ");
    const telegram = prompt("Telegram (optional): ");
    const website = prompt("Website (optional): ");
    const tipAmt = +prompt("Jito tip in SOL (e.g., 0.01): ") * LAMPORTS_PER_SOL;

    // ✅ STEP 3: Upload metadata to IPFS
    console.log("\n=== UPLOADING TO IPFS ===");
    const metadata_uri = await uploadMetadata(name, symbol, description, twitter, telegram, website);
    if (!metadata_uri) return;

    // ✅ STEP 4: Get mint from keyInfo
    console.log("\n=== LOADING MINT ===");
    if (!keyInfo.mintPk) {
        console.log("❌ ERROR: No mint found in keyInfo!");
        return;
    }
    
    const mintKp = Keypair.fromSecretKey(Uint8Array.from(bs58.decode(keyInfo.mintPk)));
    console.log(`✅ Mint: ${mintKp.publicKey.toBase58()}`);

    // ✅ STEP 5: Validate wallets
    console.log("\n=== VALIDATING WALLETS ===");
    const validWallets = await validateWallets(keyInfo);
    
    if (validWallets.length === 0) {
        console.log("❌ ERROR: No valid wallets found!");
        return;
    }

    // ✅ STEP 6: Plan bundle strategy
    console.log("\n=== BUNDLE STRATEGY ===");
    const walletsPerTx = 4; // 4 wallets per transaction (safe for compute budget)
    const walletChunks = chunkArray(validWallets, walletsPerTx);
    
    // Check if dev wallet has buy configured
    const devInfo = keyInfo[wallet.publicKey.toString()];
    const devHasBuy = devInfo && devInfo.solAmount && parseFloat(devInfo.solAmount) > 0;
    
    const totalTxs = (devHasBuy ? 2 : 1) + walletChunks.length; // CREATE + DEV BUY (if configured) + wallet chunks
    
    console.log(`📊 Bundle Plan:`);
    console.log(`  • TX 1: CREATE TOKEN`);
    if (devHasBuy) {
        console.log(`  • TX 2: DEV BUY`);
    }
    for (let i = 0; i < walletChunks.length; i++) {
        const isLast = i === walletChunks.length - 1;
        const tipNote = isLast ? " + JITO TIP" : "";
        const txNum = (devHasBuy ? 3 : 2) + i;
        console.log(`  • TX ${txNum}: Wallets ${i * walletsPerTx + 1}-${Math.min((i + 1) * walletsPerTx, validWallets.length)}${tipNote}`);
    }
    console.log(`  • Total: ${totalTxs} transactions`);
    console.log(`  • Wallets: ${validWallets.length} buying simultaneously`);

    if (totalTxs > 5) {
        console.log(`⚠️  WARNING: ${totalTxs} transactions in bundle (max recommended: 5)`);
        const proceed = prompt("Continue anyway? (y/n): ").toLowerCase();
        if (proceed !== 'y') return;
    }

    // ✅ STEP 7: Build all transactions
    console.log("\n=== BUILDING TRANSACTIONS ===");
    const allTxs = await buildMultiTransactionBundle(
        program, mintKp, validWallets, keyInfo,
        name, symbol, metadata_uri, tipAmt, lookupTableAccount
    );

    if (allTxs.length === 0) {
        console.log("❌ Failed to build transactions");
        return;
    }

    // ✅ STEP 8: Final confirmation
    console.log("\n=== LAUNCH CONFIRMATION ===");
    console.log(`🎯 Token: ${name} (${symbol})`);
    console.log(`📦 Bundle: ${allTxs.length} transactions`);
    console.log(`👥 Wallets: ${validWallets.length} simultaneous buyers`);
    console.log(`💰 Jito tip: ${tipAmt / LAMPORTS_PER_SOL} SOL`);
    console.log(`📏 Total size: ${allTxs.reduce((sum, tx) => sum + tx.serialize().length, 0).toLocaleString()} bytes`);
    
    const confirm = prompt("\n🚀 LAUNCH BUNDLE NOW? (yes/no): ").toLowerCase();
    if (confirm !== 'yes') {
        console.log("Launch cancelled.");
        return;
    }

    // ✅ STEP 9: Send to Jito
    console.log("\n=== LAUNCHING TO JITO ===");
    await sendBundle(allTxs);
}

// ✅ Build multi-transaction bundle
async function buildMultiTransactionBundle(
    program: anchor.Program,
    mintKp: Keypair,
    validWallets: ValidWallet[],
    keyInfo: any,
    name: string,
    symbol: string,
    metadata_uri: string,
    tipAmt: number,
    lookupTableAccount: AddressLookupTableAccount
): Promise<VersionedTransaction[]> {
    
    const { blockhash } = await connection.getLatestBlockhash();
    const allTxs: VersionedTransaction[] = [];

    // Pre-calculate PDAs
    const [bondingCurve] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding-curve"), mintKp.publicKey.toBytes()], 
        PUMP_PROGRAM
    );
    const [metadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), MPL_TOKEN_METADATA_PROGRAM_ID.toBytes(), mintKp.publicKey.toBytes()], 
        MPL_TOKEN_METADATA_PROGRAM_ID
    );
    const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
        [bondingCurve.toBytes(), spl.TOKEN_PROGRAM_ID.toBytes(), mintKp.publicKey.toBytes()], 
        spl.ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const [creatorVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("creator-vault"), wallet.publicKey.toBytes()], 
        PUMP_PROGRAM
    );

    // Check if dev wallet has buy configured
    const devInfo = keyInfo[wallet.publicKey.toString()];
    const devHasBuy = devInfo && devInfo.solAmount && parseFloat(devInfo.solAmount) > 0;

    console.log("🔨 Building TX 1: CREATE TOKEN");
    
    // ✅ TRANSACTION 1: CREATE ONLY (no dev buy)
    const createTxIxs: TransactionInstruction[] = [];
    
    // Compute budget for CREATE transaction - increased for safety
    createTxIxs.push(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 }), // Increased from 400k
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000 }) // Higher priority
    );

    // Create instruction only
    const createIx = await (program.methods as any)
        .create(name, symbol, metadata_uri, wallet.publicKey)
        .accounts({
            mint: mintKp.publicKey,
            mintAuthority: mintAuthority,
            bondingCurve: bondingCurve,
            associatedBondingCurve: associatedBondingCurve,
            global: globalAccount,
            mplTokenMetadata: MPL_TOKEN_METADATA_PROGRAM_ID,
            metadata: metadata,
            user: wallet.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: spl.TOKEN_PROGRAM_ID,
            associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            eventAuthority: eventAuthority,
            program: PUMP_PROGRAM,
        })
        .instruction();

    createTxIxs.push(createIx);

    // Build CREATE transaction
    const createMessage = new TransactionMessage({
        payerKey: wallet.publicKey,
        instructions: createTxIxs,
        recentBlockhash: blockhash,
    }).compileToV0Message([lookupTableAccount]);

    const createTx = new VersionedTransaction(createMessage);
    
    // Size and simulation check
    const createSize = createTx.serialize().length;
    console.log(`  📏 Size: ${createSize}/1232 bytes`);
    
    if (createSize > 1232) {
        console.log(`  ❌ CREATE transaction too large: ${createSize} bytes`);
        return [];
    }

    createTx.sign([wallet, mintKp]);

    // Simulate CREATE transaction
    console.log(`  🧪 Simulating CREATE transaction...`);
    try {
        const result = await connection.simulateTransaction(createTx, { 
            commitment: "processed",
            sigVerify: false,
            replaceRecentBlockhash: true
        });

        if (result.value.err) {
            console.error(`  ❌ CREATE simulation failed:`, result.value.err);
            return [];
        }

        console.log(`  ✅ CREATE simulation success! CU: ${result.value.unitsConsumed?.toLocaleString()}`);
    } catch (error) {
        console.error(`  ❌ CREATE simulation error:`, error);
        return [];
    }

    allTxs.push(createTx);

    // ✅ TRANSACTION 2: DEV BUY (if configured)
    if (devHasBuy) {
        console.log("🔨 Building TX 2: DEV BUY");
        
        const devBuyTxIxs: TransactionInstruction[] = [];
        
        // Compute budget for DEV BUY
        devBuyTxIxs.push(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150000 })
        );

        console.log(`  💰 Dev buy: ${devInfo.solAmount} SOL`);
        
        const devAta = spl.getAssociatedTokenAddressSync(mintKp.publicKey, wallet.publicKey);
        
        const devAtaIx = spl.createAssociatedTokenAccountIdempotentInstruction(
            wallet.publicKey, devAta, wallet.publicKey, mintKp.publicKey
        );
        
        // Calculate reasonable minimum tokens (about 90% of expected amount)
        const expectedTokens = new BN(devInfo.tokenAmount);
        const minTokens = expectedTokens.muln(90).divn(100); // 90% of expected
        const devSolAmount = new BN(Math.floor(parseFloat(devInfo.solAmount) * LAMPORTS_PER_SOL));
        
        console.log(`  Expected: ${expectedTokens.toNumber() / 1e6}M tokens, Min: ${minTokens.toNumber() / 1e6}M tokens`);
        
        const devBuyIx = await (program.methods as any)
            .buy(minTokens, devSolAmount)
            .accounts({
                global: globalAccount,
                feeRecipient: feeRecipient,
                mint: mintKp.publicKey,
                bondingCurve: bondingCurve,
                associatedBondingCurve: associatedBondingCurve,
                associatedUser: devAta,
                user: wallet.publicKey,
                systemProgram: SystemProgram.programId,
                tokenProgram: spl.TOKEN_PROGRAM_ID,
                creatorVault: creatorVault,
                eventAuthority: eventAuthority,
                program: PUMP_PROGRAM,
            })
            .instruction();

        devBuyTxIxs.push(devAtaIx, devBuyIx);

        // Build DEV BUY transaction
        const devBuyMessage = new TransactionMessage({
            payerKey: wallet.publicKey,
            instructions: devBuyTxIxs,
            recentBlockhash: blockhash,
        }).compileToV0Message([lookupTableAccount]);

        const devBuyTx = new VersionedTransaction(devBuyMessage);
        
        // Size check
        const devBuySize = devBuyTx.serialize().length;
        console.log(`  📏 Size: ${devBuySize}/1232 bytes`);
        
        if (devBuySize > 1232) {
            console.log(`  ❌ DEV BUY transaction too large: ${devBuySize} bytes`);
            return [];
        }

        devBuyTx.sign([wallet]);

        // Skip simulation for DEV BUY (depends on CREATE)
        console.log(`  ✅ DEV BUY transaction built (skipping simulation - depends on CREATE)`);

        allTxs.push(devBuyTx);
    } else {
        console.log("  ℹ️  No dev buy configured, skipping DEV BUY transaction");
    }

    // ✅ WALLET BUY TRANSACTIONS
    const walletsPerTx = 4;
    const walletChunks = chunkArray(validWallets, walletsPerTx);

    for (let chunkIndex = 0; chunkIndex < walletChunks.length; chunkIndex++) {
        const chunk = walletChunks[chunkIndex];
        const isLastChunk = chunkIndex === walletChunks.length - 1;
        const txNumber = (devHasBuy ? 3 : 2) + chunkIndex;
        
        console.log(`🔨 Building TX ${txNumber}: Wallets ${chunk[0].index}-${chunk[chunk.length - 1].index}${isLastChunk ? ' + TIP' : ''}`);

        const walletTxIxs: TransactionInstruction[] = [];
        
        // Compute budget for wallet transaction
        const walletCU = 100000 + (chunk.length * 80000); // Base + per wallet
        walletTxIxs.push(
            ComputeBudgetProgram.setComputeUnitLimit({ units: walletCU }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 })
        );

        // Add buy instructions for each wallet in chunk
        for (const { keypair, amount, solAmount, index } of chunk) {
            console.log(`    👤 Wallet ${index}: ${solAmount.toNumber() / LAMPORTS_PER_SOL} SOL`);
            
            const ata = spl.getAssociatedTokenAddressSync(mintKp.publicKey, keypair.publicKey);
            
            // ATA creation (idempotent)
            const ataIx = spl.createAssociatedTokenAccountIdempotentInstruction(
                keypair.publicKey, ata, keypair.publicKey, mintKp.publicKey
            );
            
            // Calculate reasonable minimum tokens (about 90% of expected amount)
            const keypairInfo = keyInfo[keypair.publicKey.toString()];
            if (!keypairInfo) {
                console.log(`    ⚠️  No key info for wallet ${index}`);
                continue;
            }

            const expectedTokens = new BN(keypairInfo.tokenAmount);
            const minTokens = expectedTokens.muln(90).divn(100); // 90% of expected
            
            // Buy instruction
            const buyIx = await (program.methods as any)
                .buy(minTokens, solAmount)
                .accounts({
                    global: globalAccount,
                    feeRecipient: feeRecipient,
                    mint: mintKp.publicKey,
                    bondingCurve: bondingCurve,
                    associatedBondingCurve: associatedBondingCurve,
                    associatedUser: ata,
                    user: keypair.publicKey,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: spl.TOKEN_PROGRAM_ID,
                    creatorVault: creatorVault,
                    eventAuthority: eventAuthority,
                    program: PUMP_PROGRAM,
                })
                .instruction();
            
            walletTxIxs.push(ataIx, buyIx);
        }

        // Add Jito tip to last transaction
        if (isLastChunk) {
            console.log(`    💰 Adding Jito tip: ${tipAmt / LAMPORTS_PER_SOL} SOL`);
            walletTxIxs.push(
                SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: getRandomTipAccount(),
                    lamports: BigInt(tipAmt),
                })
            );
        }

        // Build wallet transaction
        const walletMessage = new TransactionMessage({
            payerKey: payer.publicKey,
            instructions: walletTxIxs,
            recentBlockhash: blockhash,
        }).compileToV0Message([lookupTableAccount]);

        const walletTx = new VersionedTransaction(walletMessage);
        
        // Size check
        const walletSize = walletTx.serialize().length;
        console.log(`    📏 Size: ${walletSize}/1232 bytes`);
        
        if (walletSize > 1232) {
            console.log(`    ❌ Wallet TX ${txNumber} too large: ${walletSize} bytes`);
            return [];
        }

        // Sign with payer and all wallet keypairs
        const signers = [payer, ...chunk.map(w => w.keypair)];
        walletTx.sign(signers);

        // Skip simulation for wallet transactions (they depend on CREATE being successful)
        console.log(`    ✅ Wallet TX ${txNumber} built and signed (${chunk.length} wallets)`);

        allTxs.push(walletTx);
    }

    console.log(`\n🎉 Bundle complete: ${allTxs.length} transactions ready`);
    return allTxs;
}

// ✅ Upload metadata to IPFS
async function uploadMetadata(
    name: string, symbol: string, description: string, 
    twitter: string, telegram: string, website: string
): Promise<string | null> {
    
    const files = await fs.promises.readdir("./img");
    if (files.length === 0) {
        console.log("❌ No image found in ./img folder");
        return null;
    }
    if (files.length > 1) {
        console.log("❌ Multiple images found - please keep only one image in ./img folder");
        return null;
    }

    const data: Buffer = fs.readFileSync(`./img/${files[0]}`);
    const formData = new FormData();
    
    formData.append("file", new Blob([data], { type: "image/jpeg" }));
    formData.append("name", name);
    formData.append("symbol", symbol);
    formData.append("description", description);
    formData.append("twitter", twitter);
    formData.append("telegram", telegram);
    formData.append("website", website);
    formData.append("showName", "true");

    try {
        const response = await axios.post("https://pump.fun/api/ipfs", formData, {
            headers: { "Content-Type": "multipart/form-data" },
        });
        
        console.log("✅ Metadata uploaded to IPFS");
        console.log(`📎 URI: ${response.data.metadataUri}`);
        return response.data.metadataUri;
        
    } catch (error) {
        console.error("❌ IPFS upload failed:", error);
        return null;
    }
}

// ✅ Validate wallets for transaction
async function validateWallets(keyInfo: any): Promise<ValidWallet[]> {
    const keypairs = loadKeypairs();
    const validWallets: ValidWallet[] = [];
    
    console.log(`Checking ${keypairs.length} wallets + dev wallet...`);
    
    // Check dev wallet
    const devWalletKey = wallet.publicKey.toString();
    const devInfo = keyInfo[devWalletKey];
    
    if (devInfo && devInfo.solAmount && parseFloat(devInfo.solAmount) > 0) {
        try {
            const balance = await connection.getBalance(wallet.publicKey);
            const balanceSOL = balance / LAMPORTS_PER_SOL;
            const requiredSOL = parseFloat(devInfo.solAmount) + 0.05;
            
            if (balanceSOL >= requiredSOL) {
                console.log(`✅ DEV WALLET: ${devInfo.solAmount} SOL configured, ${balanceSOL.toFixed(4)} SOL available → ${(parseFloat(devInfo.tokenAmount) / 1e6).toFixed(2)}M tokens`);
            } else {
                console.log(`⚠️  DEV WALLET: Insufficient balance! Need ${requiredSOL.toFixed(4)} SOL, have ${balanceSOL.toFixed(4)} SOL`);
            }
        } catch (error) {
            console.log(`⚠️  DEV WALLET: Balance check failed`);
        }
    } else {
        console.log(`ℹ️  DEV WALLET: No buy configured (will only create token)`);
    }
    
    // Check regular wallets
    for (let i = 0; i < keypairs.length; i++) {
        const keypair = keypairs[i];
        const keypairInfo = keyInfo[keypair.publicKey.toString()];
        
        if (!keypairInfo || !keypairInfo.solAmount || !keypairInfo.tokenAmount) {
            console.log(`⚠️  Wallet ${i + 1}: No simulation data`);
            continue;
        }
        
        const solAmount = parseFloat(keypairInfo.solAmount.toString());
        if (solAmount <= 0) {
            console.log(`⚠️  Wallet ${i + 1}: Invalid SOL amount`);
            continue;
        }

        try {
            const balance = await connection.getBalance(keypair.publicKey);
            const balanceSOL = balance / LAMPORTS_PER_SOL;
            const requiredSOL = solAmount + 0.01;
            
            if (balanceSOL < requiredSOL) {
                console.log(`⚠️  Wallet ${i + 1}: Insufficient balance (${balanceSOL.toFixed(4)} < ${requiredSOL.toFixed(4)} SOL)`);
                continue;
            }
            
            const amount = new BN(keypairInfo.tokenAmount);
            const solAmountBN = new BN(Math.floor(solAmount * LAMPORTS_PER_SOL));
            
            validWallets.push({ 
                keypair, 
                amount, 
                solAmount: solAmountBN, 
                index: i + 1 
            });
            
            console.log(`✅ Wallet ${i + 1}: ${solAmount} SOL → ${(amount.toNumber() / 1e6).toFixed(2)}M tokens`);
            
        } catch (error) {
            console.log(`⚠️  Wallet ${i + 1}: Balance check failed`);
            continue;
        }
    }
    
    return validWallets;
}

// ✅ Send bundle to Jito
export async function sendBundle(bundledTxns: VersionedTransaction[]) {
	if (bundledTxns.length === 0) {
		console.log("❌ No transactions to send");
		return;
	}

	console.log(`📤 Sending bundle with ${bundledTxns.length} transactions to Jito`);
    console.log(`📏 Total bundle size: ${bundledTxns.reduce((sum, tx) => sum + tx.serialize().length, 0).toLocaleString()} bytes`);

	try {
		const bundleId = await searcherClient.sendBundle(new JitoBundle(bundledTxns, bundledTxns.length));
		console.log(`✅ Bundle sent successfully!`);
        
        // ✅ FIX: Properly convert bundle ID to string
        const bundleIdStr = bundleId.toString();
        console.log(`🆔 Bundle ID: ${bundleIdStr}`);

		console.log("⏳ Waiting for bundle result...");
		
		// ✅ FIX: Wait 10 seconds then check on-chain directly (more reliable)
		await new Promise(resolve => setTimeout(resolve, 10000));
		
		console.log("🔍 Checking on-chain status...");
		const success = await verifyBundleSuccess(bundledTxns);
		
		if (success) {
			console.log("🎉 BUNDLE SUCCESSFUL - Token created and wallets funded!");
			await verifyTokenCreation(); // Show token details
			return true;
		} else {
			console.log("❌ Bundle verification failed - no successful transactions found");
			return false;
		}

	} catch (error) {
		const err = error as any;
		console.error("❌ Jito bundle error:", err.message);

		if (err?.message?.includes("Bundle Dropped, no connected leader up soon")) {
			console.error("  → No Jito leader available - try again in a few seconds");
		} else if (err?.message?.includes("exceeded maximum number of transactions")) {
			console.error("  → Bundle too large - reduce number of wallets");
		} else if (err?.message?.includes("Rate limit exceeded")) {
			console.log("⚠️  Jito API rate limit hit - checking on-chain status...");
			await new Promise(resolve => setTimeout(resolve, 5000));
			const success = await verifyBundleSuccess(bundledTxns);
			return success;
		} else {
			console.error("  → Unexpected error occurred");
		}
		
		return false;
	}
}

async function verifyBundleSuccess(bundledTxns: VersionedTransaction[]): Promise<boolean> {
	console.log("\n=== VERIFYING BUNDLE SUCCESS ===");
	
	try {
		// First check if token was created (most important indicator)
		const tokenCreated = await verifyTokenCreation();
		
		if (tokenCreated) {
			console.log("✅ TOKEN CREATION CONFIRMED!");
			
			// Also check individual transactions
			let successCount = 0;
			let totalChecked = 0;
			
			for (let i = 0; i < Math.min(bundledTxns.length, 5); i++) { // Check first 5 TXs
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
			
			console.log(`\n🎉 BUNDLE SUCCESS CONFIRMED!`);
			console.log(`📊 Transaction status: ${successCount}/${totalChecked} confirmed successful`);
			
			// Show wallet results
			await showWalletResults();
			
			return true;
		} else {
			console.log("❌ Token creation not detected - bundle likely failed");
			return false;
		}
		
	} catch (error) {
		console.error("❌ Verification failed:", error);
		return false;
	}
}

// ✅ Check if token was successfully created and get details
async function verifyTokenCreation(): Promise<boolean> {
	try {
		const keyInfoPath = path.join(__dirname, "keyInfo.json");
		if (!fs.existsSync(keyInfoPath)) {
			return false;
		}

		const keyInfo = JSON.parse(fs.readFileSync(keyInfoPath, "utf-8"));
		if (!keyInfo.mintPk) {
			return false;
		}

		const mintKp = Keypair.fromSecretKey(Uint8Array.from(bs58.decode(keyInfo.mintPk)));
		const mintAddress = mintKp.publicKey;

		// Check if mint account exists
		const mintInfo = await connection.getAccountInfo(mintAddress);
		if (mintInfo) {
			console.log(`\n🎯 TOKEN CONTRACT: ${mintAddress.toBase58()}`);
			console.log(`🔗 View on Pump.fun: https://pump.fun/${mintAddress.toBase58()}`);
			
			// Also check bonding curve
			const [bondingCurve] = PublicKey.findProgramAddressSync(
				[Buffer.from("bonding-curve"), mintAddress.toBytes()], 
				PUMP_PROGRAM
			);

			const bondingCurveInfo = await connection.getAccountInfo(bondingCurve);
			if (bondingCurveInfo) {
				console.log("✅ Bonding curve created successfully");
			}
			
			return true;
		}
		
		return false;
	} catch (error) {
		return false;
	}
}

// ✅ Show wallet results after successful launch
async function showWalletResults() {
	try {
		const keyInfoPath = path.join(__dirname, "keyInfo.json");
		const keyInfo = JSON.parse(fs.readFileSync(keyInfoPath, "utf-8"));
		
		if (!keyInfo.mintPk) return;
		
		const mintKp = Keypair.fromSecretKey(Uint8Array.from(bs58.decode(keyInfo.mintPk)));
		const mintAddress = mintKp.publicKey;

		console.log("\n💰 WALLET RESULTS:");
		
		// Check dev wallet
		const devWalletKey = wallet.publicKey.toString();
		const devInfo = keyInfo[devWalletKey];
		if (devInfo && devInfo.solAmount) {
			await checkWalletResults(mintAddress, wallet.publicKey, "DEV WALLET", keyInfo);
		}

		// Check other wallets
		const validWallets = Object.keys(keyInfo).filter(key => 
			key !== devWalletKey && 
			keyInfo[key].solAmount && 
			!['addressLUT', 'mint', 'mintPk', 'numOfWallets'].includes(key)
		);

		for (let i = 0; i < validWallets.length; i++) {
			const walletKey = validWallets[i];
			await checkWalletResults(mintAddress, new PublicKey(walletKey), `WALLET ${i + 1}`, keyInfo);
		}

		console.log("\n🎉 LAUNCH COMPLETE!");
		
	} catch (error) {
		console.log("⚠️  Could not verify wallet results");
	}
}

// ✅ Keep your existing checkWalletResults function
async function checkWalletResults(mintAddress: PublicKey, walletPubkey: PublicKey, walletName: string, keyInfo: any) {
	try {
		const walletKey = walletPubkey.toBase58();
		const configuredSol = keyInfo[walletKey]?.solAmount || "0";
		
		// Check token balance
		const tokenAccount = await spl.getAssociatedTokenAddress(mintAddress, walletPubkey);
		
		try {
			const tokenBalance = await connection.getTokenAccountBalance(tokenAccount);
			const tokensReceived = parseFloat(tokenBalance.value.amount) / 1e6; // Assuming 6 decimals
			
			console.log(`  ${walletName}: Spent ~${configuredSol} SOL → Received ${tokensReceived.toFixed(2)}M tokens ✅`);
		} catch (error) {
			console.log(`  ${walletName}: Configured ${configuredSol} SOL → No tokens received ❌`);
		}
	} catch (error) {
		console.log(`  ${walletName}: Status check failed ⚠️`);
	}
}