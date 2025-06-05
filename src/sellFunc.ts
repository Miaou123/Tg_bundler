import { connection, rpc, wallet, global as globalAccount, feeRecipient, PUMP_PROGRAM, payer, eventAuthority } from "../config";
import { PublicKey, VersionedTransaction, SYSVAR_RENT_PUBKEY, TransactionMessage, SystemProgram, Keypair, LAMPORTS_PER_SOL, ComputeBudgetProgram, TransactionInstruction } from "@solana/web3.js";
import { loadKeypairs } from "./createKeys";
import { searcherClient } from "./clients/jito";
import { Bundle as JitoBundle } from "jito-ts/dist/sdk/block-engine/types.js";
const promptSync = require("prompt-sync");
import * as spl from "@solana/spl-token";
import bs58 from "bs58";
import path from "path";
import fs from "fs";
import * as anchor from "@coral-xyz/anchor";
import { randomInt } from "crypto";
import { getRandomTipAccount } from "./clients/config";
import BN from "bn.js";

const prompt = promptSync();
const keyInfoPath = path.join(__dirname, "keyInfo.json");

function chunkArray<T>(array: T[], size: number): T[][] {
	return Array.from({ length: Math.ceil(array.length / size) }, (v, i) => array.slice(i * size, i * size + size));
}

// ✅ FIXED: Use the same sendBundle pattern from jitoPool.ts
async function sendBundle(bundledTxns: VersionedTransaction[]) {
	if (bundledTxns.length === 0) {
		console.log("❌ No transactions to send");
		return false;
	}

	console.log(`📤 Sending sell bundle with ${bundledTxns.length} transactions to Jito`);
	console.log(`📏 Total bundle size: ${bundledTxns.reduce((sum, tx) => sum + tx.serialize().length, 0).toLocaleString()} bytes`);

	try {
		const bundleId = await searcherClient.sendBundle(new JitoBundle(bundledTxns, bundledTxns.length));
		console.log(`✅ Sell bundle sent successfully!`);
		
		const bundleIdStr = bundleId.toString();
		console.log(`🆔 Bundle ID: ${bundleIdStr}`);

		console.log("⏳ Waiting for sell bundle result...");
		
		// Wait 10 seconds then check on-chain directly
		await new Promise(resolve => setTimeout(resolve, 10000));
		
		console.log("🔍 Checking sell transaction status...");
		const success = await verifySellSuccess(bundledTxns);
		
		if (success) {
			console.log("🎉 SELL BUNDLE SUCCESSFUL!");
			return true;
		} else {
			console.log("❌ Sell bundle verification failed");
			return false;
		}

	} catch (error) {
		const err = error as any;
		console.error("❌ Jito sell bundle error:", err.message);

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

// ✅ FIXED: Proper sell verification
async function verifySellSuccess(bundledTxns: VersionedTransaction[]): Promise<boolean> {
	console.log("\n=== VERIFYING SELL SUCCESS ===");
	
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
			console.log(`\n🎉 SELL SUCCESS CONFIRMED!`);
			console.log(`📊 Transaction status: ${successCount}/${totalChecked} confirmed successful`);
			return true;
		} else {
			console.log("❌ No successful sell transactions found");
			return false;
		}
		
	} catch (error) {
		console.error("❌ Sell verification failed:", error);
		return false;
	}
}

// ✅ MAIN SELL FUNCTION - Fixed with proper Anchor setup and bundle strategy
export async function sellXPercentagePF() {
	console.log("🔥 PUMP.FUN SELL BUNDLER");
	console.log("========================");
	
	// ✅ FIX: Use same Anchor setup pattern as jitoPool.ts
	const provider = new anchor.AnchorProvider(
		connection,
		new anchor.Wallet(wallet),
		{ commitment: "confirmed" }
	);

	const IDL_PumpFun = JSON.parse(fs.readFileSync("./pumpfun-IDL.json", "utf-8"));
	const program = new anchor.Program(IDL_PumpFun, provider);

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

	if (lookupTableAccount == null) {
		console.log("❌ ERROR: Lookup table not found on-chain!");
		return;
	}

	const mintKp = Keypair.fromSecretKey(Uint8Array.from(bs58.decode(poolInfo.mintPk)));
	console.log(`🎯 Token: ${mintKp.publicKey.toBase58()}`);

	// Get sell parameters
	const supplyPercent = +prompt("Percentage to sell (Ex. 1 for 1%): ") / 100;
	const jitoTipAmt = +prompt("Jito tip in Sol (Ex. 0.01): ") * LAMPORTS_PER_SOL;

	if (supplyPercent <= 0 || supplyPercent > 0.25) {
		console.log("❌ Invalid percentage! Must be between 0.01% and 25%");
		return;
	}

	console.log(`📊 Selling ${(supplyPercent * 100).toFixed(2)}% of each wallet's tokens`);

	// ✅ FIX: Pre-calculate PDAs (same pattern as jitoPool.ts)
	const [bondingCurve] = PublicKey.findProgramAddressSync(
		[Buffer.from("bonding-curve"), mintKp.publicKey.toBytes()], 
		PUMP_PROGRAM
	);
	const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
		[bondingCurve.toBytes(), spl.TOKEN_PROGRAM_ID.toBytes(), mintKp.publicKey.toBytes()],
		spl.ASSOCIATED_TOKEN_PROGRAM_ID
	);
	const [creatorVault] = PublicKey.findProgramAddressSync(
		[Buffer.from("creator-vault"), wallet.publicKey.toBytes()], 
		PUMP_PROGRAM
	);

	// Check current supply and calculate total sell amount
	const mintInfo = await connection.getTokenSupply(mintKp.publicKey);
	let sellTotalAmount = 0;

	const keypairs = loadKeypairs();
	const chunkedKeypairs = chunkArray(keypairs, 6); // 6 wallets per transfer transaction
	const bundledTxns: VersionedTransaction[] = [];

	const PayerTokenATA = await spl.getAssociatedTokenAddress(mintKp.publicKey, payer.publicKey);
	const { blockhash } = await connection.getLatestBlockhash();

	console.log("\n=== BUILDING TRANSFER TRANSACTIONS ===");

	// ✅ Step 1: Transfer tokens from all wallets to payer (multiple TXs)
	for (let chunkIndex = 0; chunkIndex < chunkedKeypairs.length; chunkIndex++) {
		const chunk = chunkedKeypairs[chunkIndex];
		const instructionsForChunk: TransactionInstruction[] = [];
		const isFirstChunk = chunkIndex === 0;

		console.log(`🔨 Building Transfer TX ${chunkIndex + 1}: ${chunk.length} wallets`);

		// ✅ FIX: Add compute budget
		instructionsForChunk.push(
			ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 + (chunk.length * 50000) }),
			ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 })
		);

		// Handle dev wallet in first chunk
		if (isFirstChunk) {
			const transferAmount = await getSellBalance(wallet, mintKp.publicKey, supplyPercent);
			if (transferAmount > 0) {
				sellTotalAmount += transferAmount;
				console.log(`  💰 Dev wallet: ${transferAmount / 1e6}M tokens`);

				// Create payer ATA if needed
				const ataIx = spl.createAssociatedTokenAccountIdempotentInstruction(
					payer.publicKey, 
					PayerTokenATA, 
					payer.publicKey, 
					mintKp.publicKey
				);

				const devTokenATA = await spl.getAssociatedTokenAddress(mintKp.publicKey, wallet.publicKey);
				const transferIx = spl.createTransferInstruction(
					devTokenATA, 
					PayerTokenATA, 
					wallet.publicKey, 
					transferAmount
				);

				instructionsForChunk.push(ataIx, transferIx);
			}
		}

		// Handle chunk wallets
		for (let keypair of chunk) {
			const transferAmount = await getSellBalance(keypair, mintKp.publicKey, supplyPercent);
			if (transferAmount > 0) {
				sellTotalAmount += transferAmount;
				console.log(`  💰 ${keypair.publicKey.toString().slice(0, 8)}...: ${transferAmount / 1e6}M tokens`);

				const TokenATA = await spl.getAssociatedTokenAddress(mintKp.publicKey, keypair.publicKey);
				const transferIx = spl.createTransferInstruction(
					TokenATA, 
					PayerTokenATA, 
					keypair.publicKey, 
					transferAmount
				);
				instructionsForChunk.push(transferIx);
			}
		}

		if (instructionsForChunk.length > 2) { // More than just compute budget
			const message = new TransactionMessage({
				payerKey: payer.publicKey,
				recentBlockhash: blockhash,
				instructions: instructionsForChunk,
			}).compileToV0Message([lookupTableAccount]);

			const versionedTx = new VersionedTransaction(message);

			// Size check
			const serializedMsg = versionedTx.serialize();
			console.log(`  📏 Size: ${serializedMsg.length}/1232 bytes`);
			if (serializedMsg.length > 1232) {
				console.log("  ❌ Transaction too big");
				continue;
			}

			// ✅ FIX: Sign with payer first, then wallets
			versionedTx.sign([payer]);

			if (isFirstChunk) {
				versionedTx.sign([wallet]); // Dev wallet
			}

			for (let keypair of chunk) {
				versionedTx.sign([keypair]);
			}

			bundledTxns.push(versionedTx);
			console.log(`  ✅ Transfer TX ${chunkIndex + 1} built`);
		}
	}

	console.log(`\n📊 TOTAL TOKENS TO SELL: ${sellTotalAmount / 1e6}M tokens`);

	// ✅ Safety check
	if (+mintInfo.value.amount * 0.25 <= sellTotalAmount) {
		console.log("❌ Price impact too high!");
		console.log("Cannot sell more than 25% of supply at a time.");
		return;
	}

	// ✅ Step 2: Create sell transaction (final TX in bundle)
	console.log("\n=== BUILDING SELL TRANSACTION ===");
	
	const payerNum = randomInt(0, Math.min(keypairs.length - 1, 23));
	const payerKey = keypairs[payerNum];

	const sellPayerIxs: TransactionInstruction[] = [];

	// ✅ FIX: Add compute budget for sell
	sellPayerIxs.push(
		ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
		ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000 })
	);

	// ✅ FIX: Use proper Anchor instruction with correct accounts
	const sellIx = await (program.methods as any)
		.sell(new BN(sellTotalAmount), new BN(0)) // minSolOutput = 0 (no slippage protection)
		.accounts({
			global: globalAccount,
			feeRecipient: feeRecipient,
			mint: mintKp.publicKey,
			bondingCurve: bondingCurve,
			associatedBondingCurve: associatedBondingCurve,
			associatedUser: PayerTokenATA,
			user: payer.publicKey,
			systemProgram: SystemProgram.programId,
			creatorVault: creatorVault,
			tokenProgram: spl.TOKEN_PROGRAM_ID,
			eventAuthority: eventAuthority,
			program: PUMP_PROGRAM,
		})
		.instruction();

	sellPayerIxs.push(
		sellIx,
		SystemProgram.transfer({
			fromPubkey: payer.publicKey,
			toPubkey: getRandomTipAccount(),
			lamports: BigInt(jitoTipAmt),
		})
	);

	const sellMessage = new TransactionMessage({
		payerKey: payerKey.publicKey,
		recentBlockhash: blockhash,
		instructions: sellPayerIxs,
	}).compileToV0Message([lookupTableAccount]);

	const sellTx = new VersionedTransaction(sellMessage);

	// Size check
	const sellSize = sellTx.serialize().length;
	console.log(`📏 Sell TX size: ${sellSize}/1232 bytes`);
	if (sellSize > 1232) {
		console.log("❌ Sell transaction too big");
		return;
	}

	sellTx.sign([payer, payerKey]);
	bundledTxns.push(sellTx);

	console.log(`✅ Sell TX built with ${sellTotalAmount / 1e6}M tokens`);

	// ✅ Step 3: Send bundle
	console.log(`\n=== LAUNCHING SELL BUNDLE ===`);
	console.log(`📦 Bundle: ${bundledTxns.length} transactions`);
	console.log(`💰 Jito tip: ${jitoTipAmt / LAMPORTS_PER_SOL} SOL`);
	
	const confirm = prompt("\n🔥 EXECUTE SELL BUNDLE? (yes/no): ").toLowerCase();
	if (confirm !== 'yes') {
		console.log("Sell cancelled.");
		return;
	}

	const success = await sendBundle(bundledTxns);
	
	if (success) {
		console.log("🎉 Sell completed successfully!");
	} else {
		console.log("❌ Sell bundle failed");
	}
}

// ✅ Helper function to get sell balance
async function getSellBalance(keypair: Keypair, mint: PublicKey, supplyPercent: number): Promise<number> {
	try {
		const tokenAccountPubKey = spl.getAssociatedTokenAddressSync(mint, keypair.publicKey);
		const balance = await connection.getTokenAccountBalance(tokenAccountPubKey);
		const amount = Math.floor(Number(balance.value.amount) * supplyPercent);
		return amount;
	} catch (e) {
		return 0;
	}
}