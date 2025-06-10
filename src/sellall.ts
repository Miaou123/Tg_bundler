import { connection, wallet, payer } from "../config";
import { PublicKey, VersionedTransaction, TransactionMessage, SystemProgram, Keypair, LAMPORTS_PER_SOL, ComputeBudgetProgram, TransactionInstruction, ParsedAccountData } from "@solana/web3.js";
import { loadKeypairs } from "./createKeys";
import { searcherClient } from "./clients/jito";
import { Bundle as JitoBundle } from "jito-ts/dist/sdk/block-engine/types.js";
const promptSync = require("prompt-sync");
import * as spl from "@solana/spl-token";
import path from "path";
import bs58 from "bs58";
import fs from "fs";
import { getRandomTipAccount } from "./clients/config";

const prompt = promptSync();
const keyInfoPath = path.join(__dirname, "keyInfo.json");

function chunkArray<T>(array: T[], size: number): T[][] {
	return Array.from({ length: Math.ceil(array.length / size) }, (v, i) => array.slice(i * size, i * size + size));
}

async function sendBundle(bundledTxns: VersionedTransaction[], bundleName: string = "cleanup") {
	if (bundledTxns.length === 0) {
		console.log("❌ No transactions to send");
		return false;
	}

	console.log(`📤 Sending ${bundleName} bundle with ${bundledTxns.length} transactions to Jito`);

	// ✅ LOG ALL TRANSACTION SIGNATURES
	console.log(`📋 Transaction signatures for ${bundleName}:`);
	for (let i = 0; i < bundledTxns.length; i++) {
		try {
			const signature = bs58.encode(bundledTxns[i].signatures[0]);
			console.log(`   TX ${i + 1}: ${signature}`);
			console.log(`        🔗 https://solscan.io/tx/${signature}`);
		} catch (error) {
			console.log(`   TX ${i + 1}: ❌ Could not get signature`);
		}
	}

	try {
		const bundleId = await searcherClient.sendBundle(new JitoBundle(bundledTxns, bundledTxns.length));
		console.log(`✅ ${bundleName} bundle sent successfully!`);
		
		let bundleIdStr;
		try {
			bundleIdStr = bundleId?.toString() || 'unknown';
		} catch {
			bundleIdStr = 'unknown';
		}
		console.log(`🆔 Bundle ID: ${bundleIdStr}`);

		console.log(`⏳ Waiting for ${bundleName} results...`);
		await new Promise(resolve => setTimeout(resolve, 15000)); // Wait longer for cleanup
		
		console.log(`🔍 Checking ${bundleName} transaction status...`);
		const success = await verifyBundleSuccess(bundledTxns, bundleName);
		
		return success;

	} catch (error) {
		const err = error as any;
		console.error(`❌ Jito ${bundleName} bundle error:`, err.message);
		
		// ✅ LOG ERROR DETAILS
		if (err.response) {
			console.log(`📋 Error response:`, err.response.data || err.response);
		}
		if (err.code) {
			console.log(`📋 Error code:`, err.code);
		}
		
		return false;
	}
}

// ✅ NEW: Proper verification that actually checks transaction status
async function verifyBundleSuccess(bundledTxns: VersionedTransaction[], bundleName: string): Promise<boolean> {
	console.log(`\n=== VERIFYING ${bundleName.toUpperCase()} SUCCESS ===`);

	try {
		let successCount = 0;
		let failedCount = 0;
		let pendingCount = 0;
		
		for (let i = 0; i < bundledTxns.length; i++) {
			const tx = bundledTxns[i];
			
			// Get the transaction signature
			let signature: string;
			try {
				signature = bs58.encode(tx.signatures[0]);
			} catch (error) {
				console.log(`⚠️  TX ${i + 1}: Could not get signature`);
				failedCount++;
				continue;
			}
			
			try {
				// ✅ Try multiple ways to check transaction status
				console.log(`🔍 Checking TX ${i + 1}: ${signature}`);
				
				// Method 1: getSignatureStatus
				const status = await connection.getSignatureStatus(signature, { 
					searchTransactionHistory: true 
				});
				
				if (status.value?.confirmationStatus) {
					const isSuccess = !status.value.err;
					if (isSuccess) {
						console.log(`✅ TX ${i + 1}: ${status.value.confirmationStatus.toUpperCase()} - SUCCESS`);
						console.log(`   🔗 https://solscan.io/tx/${signature}`);
						successCount++;
					} else {
						console.log(`❌ TX ${i + 1}: ${status.value.confirmationStatus.toUpperCase()} - FAILED`);
						console.log(`   🔗 https://solscan.io/tx/${signature}`);
						console.log(`   📋 Error: ${JSON.stringify(status.value.err)}`);
						failedCount++;
					}
				} else {
					// Method 2: Try to get transaction details
					try {
						const txDetails = await connection.getTransaction(signature, {
							commitment: 'confirmed',
							maxSupportedTransactionVersion: 0
						});
						
						if (txDetails) {
							if (txDetails.meta?.err) {
								console.log(`❌ TX ${i + 1}: Found but FAILED`);
								console.log(`   🔗 https://solscan.io/tx/${signature}`);
								console.log(`   📋 Error: ${JSON.stringify(txDetails.meta.err)}`);
								failedCount++;
							} else {
								console.log(`✅ TX ${i + 1}: Found and SUCCESS`);
								console.log(`   🔗 https://solscan.io/tx/${signature}`);
								successCount++;
							}
						} else {
							console.log(`⏳ TX ${i + 1}: Not found on-chain yet`);
							console.log(`   🔗 https://solscan.io/tx/${signature} (may show later)`);
							pendingCount++;
						}
					} catch (getTransactionError) {
						console.log(`⏳ TX ${i + 1}: Not found on-chain yet (getTransaction failed)`);
						console.log(`   🔗 https://solscan.io/tx/${signature} (may show later)`);
						pendingCount++;
					}
				}
			} catch (error) {
				console.log(`⚠️  TX ${i + 1}: Status check failed - ${error}`);
				console.log(`   🔗 https://solscan.io/tx/${signature} (manual check)`);
				failedCount++;
			}
		}
		
		console.log(`\n📊 ${bundleName.toUpperCase()} RESULTS:`);
		console.log(`   ✅ Successful: ${successCount}`);
		console.log(`   ❌ Failed: ${failedCount}`);
		console.log(`   ⏳ Pending: ${pendingCount}`);
		
		// ✅ More detailed result analysis
		if (successCount > 0) {
			console.log(`🎉 ${bundleName.toUpperCase()} PARTIALLY OR FULLY SUCCESSFUL!`);
			return true;
		} else if (pendingCount > 0) {
			console.log(`⏳ ${bundleName.toUpperCase()} still processing - check Solscan links above in a few minutes`);
			return false;
		} else {
			console.log(`❌ ${bundleName.toUpperCase()} completely failed - check Solscan links above for details`);
			return false;
		}
		
	} catch (error) {
		console.error(`❌ ${bundleName} verification failed:`, error);
		return false;
	}
}

// ✅ NEW: Split transactions into multiple bundles (max 5 per bundle)
async function sendMultipleBundles(allTxns: VersionedTransaction[]): Promise<boolean> {
	if (allTxns.length === 0) {
		console.log("❌ No transactions to send");
		return false;
	}

	console.log(`\n🚀 PREPARING TO SEND ${allTxns.length} TRANSACTIONS`);
	
	// Split into bundles of max 5 transactions each
	const bundleChunks = chunkArray(allTxns, 5);
	console.log(`📦 Will send ${bundleChunks.length} bundles (max 5 TX each)`);
	
	let totalSuccess = 0;
	let totalFailed = 0;

	for (let i = 0; i < bundleChunks.length; i++) {
		const chunk = bundleChunks[i];
		const bundleName = `Bundle ${i + 1}/${bundleChunks.length}`;
		
		console.log(`\n${bundleName}: ${chunk.length} transactions`);
		
		const success = await sendBundle(chunk, bundleName);
		
		if (success) {
			totalSuccess++;
		} else {
			totalFailed++;
		}
		
		// Wait between bundles to avoid rate limiting
		if (i < bundleChunks.length - 1) {
			console.log("⏳ Waiting 5 seconds before next bundle...");
			await new Promise(resolve => setTimeout(resolve, 5000));
		}
	}

	console.log(`\n🏁 FINAL CLEANUP RESULTS:`);
	console.log(`   ✅ Successful bundles: ${totalSuccess}/${bundleChunks.length}`);
	console.log(`   ❌ Failed bundles: ${totalFailed}/${bundleChunks.length}`);
	
	return totalSuccess > 0;
}

interface TokenAccount {
	mint: string;
	balance: number;
	decimals: number;
}

interface WalletTokens {
	keypair: Keypair;
	walletName: string;
	tokenAccounts: TokenAccount[];
	solBalance: number;
}

// ✅ Get ALL token accounts for a wallet
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
			
			// Only include accounts with actual token balance
			if (balance && balance > 0) {
				tokens.push({
					mint: parsedInfo.mint,
					balance: balance,
					decimals: parsedInfo.tokenAmount.decimals
				});
			}
		}

		return tokens;
	} catch (error) {
		console.log(`⚠️  Error getting token accounts for ${walletPubkey.toString().slice(0, 8)}...`);
		return [];
	}
}

// ✅ Scan ALL wallets for tokens and SOL
async function scanAllWallets(): Promise<WalletTokens[]> {
	console.log("\n🔍 SCANNING ALL WALLETS FOR TOKENS AND SOL...");
	
	const walletsData: WalletTokens[] = [];
	const keypairs = loadKeypairs();

	// Check dev wallet
	console.log("\n👤 Checking DEV WALLET...");
	try {
		const devSolBalance = await connection.getBalance(wallet.publicKey);
		const devTokens = await getWalletTokenAccounts(wallet.publicKey);
		
		console.log(`  💰 SOL: ${(devSolBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
		console.log(`  🪙 Tokens: ${devTokens.length} different tokens`);
		
		if (devTokens.length > 0) {
			devTokens.forEach(token => {
				console.log(`    • ${token.balance.toFixed(2)} tokens (${token.mint.slice(0, 8)}...)`);
			});
		}

		walletsData.push({
			keypair: wallet,
			walletName: "DEV WALLET",
			tokenAccounts: devTokens,
			solBalance: devSolBalance
		});
	} catch (error) {
		console.log(`⚠️  DEV WALLET: Error checking balance`);
	}

	// Check all 24 keypairs
	console.log("\n👥 Checking ALL 24 WALLETS...");
	for (let i = 0; i < keypairs.length; i++) {
		const keypair = keypairs[i];
		
		try {
			const solBalance = await connection.getBalance(keypair.publicKey);
			const tokenAccounts = await getWalletTokenAccounts(keypair.publicKey);
			
			const hasTokensOrSol = tokenAccounts.length > 0 || solBalance > 0.001 * LAMPORTS_PER_SOL; // More than 0.001 SOL
			
			if (hasTokensOrSol) {
				console.log(`✅ Wallet ${i + 1} (${keypair.publicKey.toString().slice(0, 8)}...):`);
				console.log(`   💰 SOL: ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
				console.log(`   🪙 Tokens: ${tokenAccounts.length} different tokens`);
				
				if (tokenAccounts.length > 0) {
					tokenAccounts.forEach(token => {
						console.log(`     • ${token.balance.toFixed(2)} tokens (${token.mint.slice(0, 8)}...)`);
					});
				}

				walletsData.push({
					keypair: keypair,
					walletName: `Wallet ${i + 1}`,
					tokenAccounts: tokenAccounts,
					solBalance: solBalance
				});
			} else {
				console.log(`⚪ Wallet ${i + 1}: Empty`);
			}
		} catch (error) {
			console.log(`⚠️  Wallet ${i + 1}: Error checking balance`);
		}
	}

	return walletsData;
}

// ✅ MAIN CLEANUP FUNCTION
export async function sellAllTokensAndCleanup() {
	console.log("🧹 COMPLETE WALLET CLEANUP");
	console.log("==========================");
	console.log("This will:");
	console.log("• Close ALL token accounts in ALL wallets");
	console.log("• Send ALL remaining SOL back to payer wallet");
	console.log("• Clean up everything from previous launches");

	const proceed = prompt("\n⚠️  PROCEED WITH COMPLETE CLEANUP? (y/yes): ").toLowerCase();
	if (proceed !== 'yes' && proceed !== 'y') {
		console.log("Cleanup cancelled.");
		return;
	}

	try {
		// Load LUT for transaction optimization
		let poolInfo: { [key: string]: any } = {};
		if (fs.existsSync(keyInfoPath)) {
			const data = fs.readFileSync(keyInfoPath, "utf-8");
			poolInfo = JSON.parse(data);
		}

		let lookupTableAccount = null;
		if (poolInfo.addressLUT) {
			const lut = new PublicKey(poolInfo.addressLUT.toString());
			lookupTableAccount = (await connection.getAddressLookupTable(lut)).value;
		}

		const jitoTipAmt = +prompt("Jito tip in Sol (Ex. 0.01): ") * LAMPORTS_PER_SOL;

		// ✅ Scan all wallets
		const walletsData = await scanAllWallets();
		
		if (walletsData.length === 0) {
			console.log("✅ All wallets are already clean!");
			return;
		}

		console.log(`\n📊 CLEANUP SUMMARY:`);
		console.log(`   Wallets to clean: ${walletsData.length}`);
		console.log(`   Total token types found: ${walletsData.reduce((sum, w) => sum + w.tokenAccounts.length, 0)}`);
		console.log(`   Total SOL to recover: ${(walletsData.reduce((sum, w) => sum + w.solBalance, 0) / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

		// ✅ Build cleanup transactions with smarter chunking
		console.log("\n=== BUILDING CLEANUP TRANSACTIONS ===");
		const bundledTxns: VersionedTransaction[] = [];
		const { blockhash } = await connection.getLatestBlockhash();

		// Handle wallets with many tokens separately (one wallet per transaction)
		const largeWallets = walletsData.filter(w => w.tokenAccounts.length > 5);
		const smallWallets = walletsData.filter(w => w.tokenAccounts.length <= 5);

		console.log(`📊 Processing strategy:`);
		console.log(`   Large wallets (>5 tokens): ${largeWallets.length} - one per transaction`);
		console.log(`   Small wallets (≤5 tokens): ${smallWallets.length} - chunked together`);

		// ✅ Handle large wallets (one wallet per transaction)
		for (let i = 0; i < largeWallets.length; i++) {
			const walletData = largeWallets[i];
			
			console.log(`🔨 Building large wallet TX ${i + 1}: ${walletData.walletName} (${walletData.tokenAccounts.length} tokens)`);

			const cleanupInstructions: TransactionInstruction[] = [];

			// Compute budget for large wallet
			cleanupInstructions.push(
				ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 + (walletData.tokenAccounts.length * 30000) }),
				ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000 })
			);

			// Close all token accounts for this large wallet
			for (const tokenAccount of walletData.tokenAccounts) {
				try {
					const tokenAccountAddress = spl.getAssociatedTokenAddressSync(
						new PublicKey(tokenAccount.mint), 
						walletData.keypair.publicKey
					);

					const closeAccountIx = spl.createCloseAccountInstruction(
						tokenAccountAddress,
						payer.publicKey,
						walletData.keypair.publicKey
					);

					cleanupInstructions.push(closeAccountIx);
					console.log(`  🗑️  ${walletData.walletName}: Closing ${tokenAccount.mint.slice(0, 8)}...`);
				} catch (error) {
					console.log(`  ⚠️  ${walletData.walletName}: Error closing ${tokenAccount.mint.slice(0, 8)}...`);
				}
			}

			// Send remaining SOL to payer
			const solToSend = walletData.solBalance - 0.002 * LAMPORTS_PER_SOL; // Leave more SOL for fees
			if (solToSend > 0) {
				const solTransferIx = SystemProgram.transfer({
					fromPubkey: walletData.keypair.publicKey,
					toPubkey: payer.publicKey,
					lamports: Math.floor(solToSend),
				});

				cleanupInstructions.push(solTransferIx);
				console.log(`  💰 ${walletData.walletName}: Sending ${(solToSend / LAMPORTS_PER_SOL).toFixed(4)} SOL to payer`);
			}

			// Build and add transaction
			if (cleanupInstructions.length > 2) {
				const message = new TransactionMessage({
					payerKey: payer.publicKey,
					recentBlockhash: blockhash,
					instructions: cleanupInstructions,
				}).compileToV0Message(lookupTableAccount ? [lookupTableAccount] : []);

				const versionedTx = new VersionedTransaction(message);

				// Size check
				const txSize = versionedTx.serialize().length;
				console.log(`  📏 Large wallet TX size: ${txSize}/1232 bytes`);
				
				if (txSize > 1232) {
					console.log(`  ⚠️  Large wallet TX too big, splitting into smaller chunks needed`);
					
					// Split this large wallet into multiple transactions
					const tokenChunks = chunkArray(walletData.tokenAccounts, 8); // 8 tokens per TX
					
					for (let chunkIdx = 0; chunkIdx < tokenChunks.length; chunkIdx++) {
						const tokenChunk = tokenChunks[chunkIdx];
						const isLastTokenChunk = chunkIdx === tokenChunks.length - 1;
						
						const chunkInstructions: TransactionInstruction[] = [];
						
						// Compute budget
						chunkInstructions.push(
							ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
							ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150000 })
						);

						// Close tokens in this chunk
						for (const tokenAccount of tokenChunk) {
							try {
								const tokenAccountAddress = spl.getAssociatedTokenAddressSync(
									new PublicKey(tokenAccount.mint), 
									walletData.keypair.publicKey
								);

								const closeAccountIx = spl.createCloseAccountInstruction(
									tokenAccountAddress,
									payer.publicKey,
									walletData.keypair.publicKey
								);

								chunkInstructions.push(closeAccountIx);
							} catch (error) {
								console.log(`    ⚠️  Error closing token ${tokenAccount.mint.slice(0, 8)}...`);
							}
						}

						// Send SOL only in the last chunk
						if (isLastTokenChunk && solToSend > 0) {
							const solTransferIx = SystemProgram.transfer({
								fromPubkey: walletData.keypair.publicKey,
								toPubkey: payer.publicKey,
								lamports: Math.floor(solToSend),
							});
							chunkInstructions.push(solTransferIx);
						}

						// Build chunk transaction
						const chunkMessage = new TransactionMessage({
							payerKey: payer.publicKey,
							recentBlockhash: blockhash,
							instructions: chunkInstructions,
						}).compileToV0Message(lookupTableAccount ? [lookupTableAccount] : []);

						const chunkTx = new VersionedTransaction(chunkMessage);
						const chunkSize = chunkTx.serialize().length;
						console.log(`    📏 Chunk ${chunkIdx + 1} size: ${chunkSize}/1232 bytes`);

						chunkTx.sign([payer, walletData.keypair]);
						bundledTxns.push(chunkTx);
						console.log(`    ✅ ${walletData.walletName} chunk ${chunkIdx + 1}/${tokenChunks.length} built`);
					}
				} else {
					// Single transaction fits
					versionedTx.sign([payer, walletData.keypair]);
					bundledTxns.push(versionedTx);
					console.log(`  ✅ ${walletData.walletName} TX built`);
				}
			}
		}

		// ✅ Handle small wallets (chunk together)
		if (smallWallets.length > 0) {
			const smallWalletChunks = chunkArray(smallWallets, 2); // Only 2 small wallets per transaction

			for (let chunkIndex = 0; chunkIndex < smallWalletChunks.length; chunkIndex++) {
				const chunk = smallWalletChunks[chunkIndex];
				const isLastChunk = chunkIndex === smallWalletChunks.length - 1 && largeWallets.length === 0;
				
				console.log(`🔨 Building small wallets TX ${chunkIndex + 1}: ${chunk.length} wallets`);

				const cleanupInstructions: TransactionInstruction[] = [];
				const chunkSigners: Keypair[] = [payer];

				// Compute budget
				const totalTokens = chunk.reduce((sum, w) => sum + w.tokenAccounts.length, 0);
				cleanupInstructions.push(
					ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 + (totalTokens * 25000) }),
					ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150000 })
				);

				for (const walletData of chunk) {
					// Close token accounts
					for (const tokenAccount of walletData.tokenAccounts) {
						try {
							const tokenAccountAddress = spl.getAssociatedTokenAddressSync(
								new PublicKey(tokenAccount.mint), 
								walletData.keypair.publicKey
							);

							const closeAccountIx = spl.createCloseAccountInstruction(
								tokenAccountAddress,
								payer.publicKey,
								walletData.keypair.publicKey
							);

							cleanupInstructions.push(closeAccountIx);
							console.log(`  🗑️  ${walletData.walletName}: Closing ${tokenAccount.mint.slice(0, 8)}...`);
						} catch (error) {
							console.log(`  ⚠️  ${walletData.walletName}: Error closing token account`);
						}
					}

					// Send SOL
					const solToSend = walletData.solBalance - 0.001 * LAMPORTS_PER_SOL;
					if (solToSend > 0) {
						const solTransferIx = SystemProgram.transfer({
							fromPubkey: walletData.keypair.publicKey,
							toPubkey: payer.publicKey,
							lamports: Math.floor(solToSend),
						});

						cleanupInstructions.push(solTransferIx);
						console.log(`  💰 ${walletData.walletName}: Sending ${(solToSend / LAMPORTS_PER_SOL).toFixed(4)} SOL to payer`);
					}

					chunkSigners.push(walletData.keypair);
				}

				// Add Jito tip to last transaction
				if (isLastChunk) {
					console.log(`  💰 Adding Jito tip: ${jitoTipAmt / LAMPORTS_PER_SOL} SOL`);
					cleanupInstructions.push(
						SystemProgram.transfer({
							fromPubkey: payer.publicKey,
							toPubkey: getRandomTipAccount(),
							lamports: BigInt(jitoTipAmt),
						})
					);
				}

				if (cleanupInstructions.length > 2) {
					const message = new TransactionMessage({
						payerKey: payer.publicKey,
						recentBlockhash: blockhash,
						instructions: cleanupInstructions,
					}).compileToV0Message(lookupTableAccount ? [lookupTableAccount] : []);

					const versionedTx = new VersionedTransaction(message);

					const txSize = versionedTx.serialize().length;
					console.log(`  📏 Small wallets TX size: ${txSize}/1232 bytes`);
					
					if (txSize <= 1232) {
						versionedTx.sign(chunkSigners);
						bundledTxns.push(versionedTx);
						console.log(`  ✅ Small wallets TX ${chunkIndex + 1} built with ${chunkSigners.length} signers`);
					} else {
						console.log(`  ⚠️  Small wallets TX too large, skipping`);
					}
				}
			}
		}

		// Add Jito tip as separate transaction if needed
		if (largeWallets.length > 0) {
			console.log(`💰 Adding separate Jito tip transaction`);
			const tipInstructions = [
				ComputeBudgetProgram.setComputeUnitLimit({ units: 50000 }),
				SystemProgram.transfer({
					fromPubkey: payer.publicKey,
					toPubkey: getRandomTipAccount(),
					lamports: BigInt(jitoTipAmt),
				})
			];

			const tipMessage = new TransactionMessage({
				payerKey: payer.publicKey,
				recentBlockhash: blockhash,
				instructions: tipInstructions,
			}).compileToV0Message([]);

			const tipTx = new VersionedTransaction(tipMessage);
			tipTx.sign([payer]);
			bundledTxns.push(tipTx);
		}

		if (bundledTxns.length === 0) {
			console.log("❌ No cleanup transactions were built!");
			return;
		}

		// ✅ Final confirmation and send
		console.log(`\n=== FINAL CLEANUP CONFIRMATION ===`);
		console.log(`📦 Transactions: ${bundledTxns.length}`);
		console.log(`🗑️  Will close ALL token accounts`);
		console.log(`💰 Will send ALL SOL to payer: ${payer.publicKey.toString()}`);
		console.log(`💸 Jito tip: ${jitoTipAmt / LAMPORTS_PER_SOL} SOL`);
		
		const finalConfirm = prompt("\n🧹 EXECUTE COMPLETE CLEANUP? (yes to confirm): ").toLowerCase();
		if (finalConfirm !== 'yes') {
			console.log("Cleanup cancelled.");
			return;
		}

		// Send bundles with proper verification
		console.log("\n🚀 Executing cleanup...");
		const success = await sendMultipleBundles(bundledTxns);

		if (success) {
			console.log("\n🎉 CLEANUP COMPLETED!");
			console.log("✅ At least some transactions succeeded");
			console.log("💡 Check individual transaction results above");
			console.log("✅ Wallets should now be cleaner");
			
			// Show payer balance after cleanup
			setTimeout(async () => {
				try {
					const payerBalance = await connection.getBalance(payer.publicKey);
					console.log(`💰 Payer balance after cleanup: ${(payerBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
				} catch (error) {
					console.log("Could not check final payer balance");
				}
			}, 5000);
		} else {
			console.log("\n❌ CLEANUP FAILED");
			console.log("💡 All bundles failed - check network conditions and try again");
		}

	} catch (error) {
		console.error("❌ Cleanup error:", error);
	}
}