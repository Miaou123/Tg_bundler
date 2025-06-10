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
		
		let bundleIdStr;
		try {
			bundleIdStr = bundleId?.toString() || 'unknown';
		} catch {
			bundleIdStr = 'unknown';
		}
		console.log(`🆔 Bundle ID: ${bundleIdStr}`);

		console.log("⏳ Waiting for sell bundle result...");
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

// ✅ NEW: Interface for wallets with token balances
interface WalletWithTokens {
	keypair: Keypair;
	tokenBalance: number;
	walletName: string;
}

// ✅ NEW: Check ALL wallets on-chain for token balances
async function getAllWalletsWithTokens(mintAddress: PublicKey): Promise<WalletWithTokens[]> {
	console.log("\n=== SCANNING ALL WALLETS FOR TOKENS ===");
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

// ✅ MAIN SELL FUNCTION - Using Pump.Fun IDL like buy transactions
export async function sellXPercentagePF() {
	console.log("🔥 PUMP.FUN SELL BUNDLER");
	console.log("========================");

	try {
		// Setup Anchor like jitoPool.ts
		const provider = new anchor.AnchorProvider(
			connection,
			new anchor.Wallet(wallet),
			{ commitment: "confirmed" }
		);

		const IDL_PumpFun = JSON.parse(fs.readFileSync("./pumpfun-IDL.json", "utf-8"));
		const program = new anchor.Program(IDL_PumpFun, provider);

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

		// ✅ Get ALL wallets with tokens by checking on-chain
		const walletsWithTokens = await getAllWalletsWithTokens(mintKp.publicKey);
		
		if (walletsWithTokens.length === 0) {
			console.log("❌ No wallets found with tokens!");
			console.log("💡 Make sure this is the correct token address");
			return;
		}

		// ✅ Pre-calculate PDAs (same as jitoPool.ts)
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

		// ✅ Build individual sell transactions for each wallet
		console.log("\n=== BUILDING SELL TRANSACTIONS ===");
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

			console.log(`🔨 Building sell TX for ${walletData.walletName}: ${(sellAmount / 1e6).toFixed(2)}M tokens`);

			// Build sell instructions
			const sellTxIxs: TransactionInstruction[] = [];
			
			// Compute budget
			sellTxIxs.push(
				ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
				ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150000 })
			);

			// Get wallet's token account
			const walletTokenATA = spl.getAssociatedTokenAddressSync(mintKp.publicKey, walletData.keypair.publicKey);

			// ✅ Use Pump.Fun sell instruction (same pattern as buy in jitoPool.ts)
			const sellIx = await (program.methods as any)
				.sell(new BN(sellAmount), new BN(0)) // sell amount, min SOL out (0 = no slippage protection)
				.accounts({
					global: globalAccount,
					feeRecipient: feeRecipient,
					mint: mintKp.publicKey,
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
			
			console.log(`  ✅ ${walletData.walletName} sell TX built`);
		}

		if (bundledTxns.length === 0) {
			console.log("❌ No valid sell transactions were built!");
			return;
		}

		// ✅ Show summary and confirm
		console.log(`\n=== SELL BUNDLE SUMMARY ===`);
		console.log(`📦 Transactions: ${bundledTxns.length}`);
		console.log(`👥 Wallets selling: ${walletsWithTokens.length}`);
		console.log(`📊 Percentage: ${(supplyPercent * 100).toFixed(2)}% per wallet`);
		console.log(`💰 Jito tip: ${jitoTipAmt / LAMPORTS_PER_SOL} SOL`);
		
		const confirm = prompt("\n🔥 EXECUTE SELL BUNDLE? (y/yes): ").toLowerCase();
		if (confirm !== 'yes' && confirm !== 'y') {
			console.log("Sell cancelled.");
			return;
		}

		// ✅ Send bundle
		const success = await sendBundle(bundledTxns);

		if (success) {
			console.log("🎉 Sell completed successfully!");
			console.log("💡 Check your wallets for received SOL");
		} else {
			console.log("❌ Sell bundle failed");
		}

	} catch (error) {
		console.error("❌ Sell function error:", error);
	}
}