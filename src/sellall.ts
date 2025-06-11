import { connection, wallet, payer, PUMP_PROGRAM, feeRecipient, eventAuthority, global as globalAccount } from "../config";
import { PublicKey, Transaction, SystemProgram, Keypair, LAMPORTS_PER_SOL, ComputeBudgetProgram, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { loadKeypairs } from "./createKeys";
const promptSync = require("prompt-sync");
import * as spl from "@solana/spl-token";
import path from "path";
import bs58 from "bs58";
import fs from "fs";
import BN from "bn.js";
import * as anchor from "@coral-xyz/anchor";

const prompt = promptSync();
const keyInfoPath = path.join(__dirname, "keyInfo.json");

interface TokenAccount {
	mint: string;
	balance: number;
	decimals: number;
	rawBalance: string;
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

		if (devTokens.length > 0 || devSolBalance > 0.01 * LAMPORTS_PER_SOL) {
			walletsData.push({
				keypair: wallet,
				walletName: "DEV WALLET",
				tokenAccounts: devTokens,
				solBalance: devSolBalance
			});
		}
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
			
			const hasTokensOrSol = tokenAccounts.length > 0 || solBalance > 0.005 * LAMPORTS_PER_SOL; // More than 0.005 SOL
			
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
				console.log(`⚪ Wallet ${i + 1}: Empty (${(solBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
			}
		} catch (error) {
			console.log(`⚠️  Wallet ${i + 1}: Error checking balance`);
		}
	}

	return walletsData;
}

// ✅ Check if a token is on Pump.fun (has bonding curve)
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

// ✅ Get the actual token creator from bonding curve
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

		// ✅ FIX: Parse bonding curve data correctly
		// Bonding curve layout: discriminator(8) + virtual_token_reserves(8) + virtual_sol_reserves(8) + 
		// real_token_reserves(8) + real_sol_reserves(8) + token_total_supply(8) + complete(1) + creator(32)
		const creatorOffset = 8 + 8 + 8 + 8 + 8 + 8 + 1; // = 49 bytes
		const creatorBytes = bondingCurveInfo.data.slice(creatorOffset, creatorOffset + 32);
		const creator = new PublicKey(creatorBytes);
		
		console.log(`    🔍 Token creator found: ${creator.toString()}`);
		return creator;
	} catch (error) {
		console.log(`    ⚠️  Could not get token creator: ${error}`);
		return null;
	}
}

// ✅ Create Pump.fun sell instruction
async function createPumpFunSellInstruction(
	wallet: Keypair,
	mintAddress: PublicKey,
	tokenAmount: string
): Promise<TransactionInstruction | null> {
	try {
		// Setup Anchor
		const provider = new anchor.AnchorProvider(
			connection,
			new anchor.Wallet(wallet),
			{ commitment: "confirmed" }
		);

		const IDL_PumpFun = JSON.parse(fs.readFileSync("./pumpfun-IDL.json", "utf-8"));
		const program = new anchor.Program(IDL_PumpFun, provider);

		// ✅ FIX: Get the actual token creator from bonding curve
		const tokenCreator = await getTokenCreator(mintAddress);
		if (!tokenCreator) {
			console.log(`    ❌ Could not determine token creator`);
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
		// ✅ FIX: Use actual token creator, not the selling wallet
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
				global: globalAccount,
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
		console.error(`Failed to create sell instruction for ${mintAddress.toString()}:`, error);
		return null;
	}
}

// ✅ Process a single wallet - sell all tokens and transfer SOL (except dev wallet)
async function processWallet(walletData: WalletTokens): Promise<boolean> {
	console.log(`\n🔄 Processing ${walletData.walletName}...`);
	
	let success = true;
	const isDevWallet = walletData.walletName === "DEV WALLET";

	// ✅ Check if token amount is worth selling (considering gas costs)
	const estimatedGasCost = 0.0015 * LAMPORTS_PER_SOL; // ~0.0015 SOL per transaction
	const minTokenValue = 0.002 * LAMPORTS_PER_SOL; // Only sell if likely to get >0.002 SOL

	// Step 1: Sell all tokens (but skip tiny amounts)
	for (const tokenAccount of walletData.tokenAccounts) {
		try {
			// ✅ Handle tokens with very small amounts (burn them first, then close ATA)
			if (tokenAccount.balance <= 0.001) {
				console.log(`  🔥 Burning ${tokenAccount.balance.toFixed(6)} tokens of ${tokenAccount.mint.slice(0, 8)}... (too small to sell)`);
				
				try {
					const mintAddress = new PublicKey(tokenAccount.mint);
					const tokenAccountAddress = spl.getAssociatedTokenAddressSync(mintAddress, walletData.keypair.publicKey);
					
					// Get actual balance from chain
					const tokenAccountInfo = await connection.getTokenAccountBalance(tokenAccountAddress);
					const actualBalance = BigInt(tokenAccountInfo.value.amount);
					
					if (actualBalance > BigInt(0)) {
						console.log(`    🔥 Burning ${tokenAccountInfo.value.uiAmountString} tokens...`);
						
						// Create burn transaction
						const burnTransaction = new Transaction();
						burnTransaction.add(
							ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }),
							ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 })
						);

						// Burn all tokens (transfer to burn address)
						const burnAddress = new PublicKey("11111111111111111111111111111111"); // System program = burn address
						
						// Actually, let's use the proper burn instruction instead of transfer to burn address
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
						
						console.log(`    ✅ Burned tokens successfully`);
						console.log(`    🔗 https://solscan.io/tx/${burnSignature}`);
						
						// Wait for burn to settle
						await new Promise(resolve => setTimeout(resolve, 2000));
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
					
					const closeSignature = await sendAndConfirmTransaction(
						connection,
						closeTransaction,
						[walletData.keypair],
						{ commitment: "confirmed", maxRetries: 3 }
					);
					
					console.log(`    ✅ Closed token account (reclaimed ~0.002 SOL rent)`);
					console.log(`    🔗 https://solscan.io/tx/${closeSignature}`);
					
				} catch (error) {
					console.log(`    ⚠️  Failed to burn/close token account: ${error}`);
				}
				
				continue; // Skip to next token
			}

			console.log(`  🔄 Selling ${tokenAccount.balance.toFixed(2)} tokens of ${tokenAccount.mint.slice(0, 8)}...`);
			
			const mintAddress = new PublicKey(tokenAccount.mint);
			
			// Check if it's a Pump.fun token
			const isPumpToken = await isPumpFunToken(mintAddress);
			
			if (isPumpToken) {
				console.log(`    💊 Pump.fun token detected, using Pump.fun sell`);
				
				// Create sell transaction
				const transaction = new Transaction();
				
				// ✅ UPDATED: More reasonable gas fees for cleanup (not high priority)
				transaction.add(
					ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
					ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }) // Lower priority for cleanup
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
						const signature = await sendAndConfirmTransaction(
							connection,
							transaction,
							[walletData.keypair],
							{
								commitment: "confirmed",
								maxRetries: 3
							}
						);

						console.log(`    ✅ Sold tokens successfully!`);
						console.log(`    🔗 https://solscan.io/tx/${signature}`);
					} catch (error) {
						console.log(`    ❌ Failed to sell tokens: ${error}`);
						success = false;
					}
				} else {
					console.log(`    ❌ Failed to create sell instruction`);
					success = false;
				}
			} else {
				console.log(`    ⚠️  Not a Pump.fun token, skipping (could be Raydium or other DEX)`);
				// For non-Pump.fun tokens, we could add Jupiter swap integration here
				// For now, we just close the token account to reclaim rent
				try {
					const transaction = new Transaction();
					transaction.add(
						ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }),
						ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 })
					);

					const tokenAccountAddress = spl.getAssociatedTokenAddressSync(mintAddress, walletData.keypair.publicKey);
					const closeAccountIx = spl.createCloseAccountInstruction(
						tokenAccountAddress,
						walletData.keypair.publicKey, // Rent goes back to wallet
						walletData.keypair.publicKey
					);
					
					transaction.add(closeAccountIx);
					
					const signature = await sendAndConfirmTransaction(
						connection,
						transaction,
						[walletData.keypair],
						{ commitment: "confirmed", maxRetries: 3 }
					);
					
					console.log(`    ✅ Closed token account (reclaimed rent)`);
					console.log(`    🔗 https://solscan.io/tx/${signature}`);
				} catch (error) {
					console.log(`    ⚠️  Failed to close token account: ${error}`);
				}
			}

			// Wait between token sales to avoid rate limiting
			await new Promise(resolve => setTimeout(resolve, 1000));

		} catch (error) {
			console.log(`    ❌ Error processing token ${tokenAccount.mint.slice(0, 8)}: ${error}`);
			success = false;
		}
	}

	// Step 2: Transfer SOL to payer (SKIP for dev wallet)
	if (isDevWallet) {
		console.log(`  👤 DEV WALLET: Keeping SOL in dev wallet (no transfer)`);
		
		// Still show the balance for reference
		try {
			const currentBalance = await connection.getBalance(walletData.keypair.publicKey);
			console.log(`  💰 Dev wallet SOL balance: ${(currentBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL (kept in dev wallet)`);
		} catch (error) {
			console.log(`  ⚠️  Could not check dev wallet balance`);
		}
	} else {
		// Transfer SOL for non-dev wallets
		try {
			console.log(`  💰 Transferring remaining SOL to payer...`);
			
			// Get current balance (may have changed after token sales)
			const currentBalance = await connection.getBalance(walletData.keypair.publicKey);
			const fee = 0.001 * LAMPORTS_PER_SOL; // Reserve for transaction fee
			const transferAmount = currentBalance - fee;

				// ✅ UPDATED: More reasonable gas fees for SOL transfer
			if (transferAmount > 0) {
				const transaction = new Transaction();
				transaction.add(
					ComputeBudgetProgram.setComputeUnitLimit({ units: 50000 }),
					ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 25000 }) // Low priority for cleanup
				);

				transaction.add(
					SystemProgram.transfer({
						fromPubkey: walletData.keypair.publicKey,
						toPubkey: payer.publicKey,
						lamports: Math.floor(transferAmount),
					})
				);

				const signature = await sendAndConfirmTransaction(
					connection,
					transaction,
					[walletData.keypair],
					{
						commitment: "confirmed",
						maxRetries: 3
					}
				);

				console.log(`  ✅ Transferred ${(transferAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL to payer`);
				console.log(`  🔗 https://solscan.io/tx/${signature}`);
			} else {
				console.log(`  ℹ️  No SOL to transfer (balance too low after fees)`);
			}

		} catch (error) {
			console.log(`  ❌ Failed to transfer SOL: ${error}`);
			success = false;
		}
	}

	return success;
}

// ✅ MAIN CLEANUP FUNCTION
export async function sellAllTokensAndCleanup() {
	console.log("🧹 SIMPLIFIED WALLET CLEANUP");
	console.log("=============================");
	console.log("This will:");
	console.log("• Sell ALL Pump.fun tokens to SOL");
	console.log("• Close non-Pump.fun token accounts");
	console.log("• Transfer SOL from generated wallets to payer");
	console.log("• Keep SOL in dev wallet (no transfer)");
	console.log("• Process each wallet individually (no Jito bundles)");

	const proceed = prompt("\n⚠️  PROCEED WITH SIMPLIFIED CLEANUP? (y/yes): ").toLowerCase();
	if (proceed !== 'yes' && proceed !== 'y') {
		console.log("Cleanup cancelled.");
		return;
	}

	try {
		// ✅ Scan all wallets
		const walletsData = await scanAllWallets();
		
		if (walletsData.length === 0) {
			console.log("✅ All wallets are already clean!");
			return;
		}

		console.log(`\n📊 CLEANUP SUMMARY:`);
		console.log(`   Wallets to clean: ${walletsData.length}`);
		console.log(`   Total token types found: ${walletsData.reduce((sum, w) => sum + w.tokenAccounts.length, 0)}`);
		
		// ✅ FIX: Exclude dev wallet SOL from recovery calculation
		const solToRecover = walletsData
			.filter(w => w.walletName !== "DEV WALLET")
			.reduce((sum, w) => sum + w.solBalance, 0);
		console.log(`   Total SOL to recover: ${(solToRecover / LAMPORTS_PER_SOL).toFixed(4)} SOL (excluding dev wallet)`);

		const finalConfirm = prompt("\n🧹 EXECUTE SIMPLIFIED CLEANUP? (yes to confirm): ").toLowerCase();
		if (finalConfirm !== 'yes') {
			console.log("Cleanup cancelled.");
			return;
		}

		// ✅ Process each wallet individually
		console.log("\n🚀 Starting cleanup process...");
		let successCount = 0;
		let failedCount = 0;

		for (let i = 0; i < walletsData.length; i++) {
			const walletData = walletsData[i];
			
			console.log(`\n📍 Progress: ${i + 1}/${walletsData.length}`);
			const walletSuccess = await processWallet(walletData);
			
			if (walletSuccess) {
				console.log(`✅ ${walletData.walletName} completed successfully`);
				successCount++;
			} else {
				console.log(`❌ ${walletData.walletName} had some failures`);
				failedCount++;
			}

			// Wait between wallets to be nice to the RPC
			if (i < walletsData.length - 1) {
				console.log("⏳ Waiting 2 seconds before next wallet...");
				await new Promise(resolve => setTimeout(resolve, 2000));
			}
		}

		// ✅ Final results
		console.log("\n🎉 CLEANUP COMPLETED!");
		console.log(`📊 Results:`);
		console.log(`   ✅ Successful wallets: ${successCount}`);
		console.log(`   ❌ Failed wallets: ${failedCount}`);
		console.log(`   📍 Total processed: ${walletsData.length}`);

		// Show payer balance after cleanup
		setTimeout(async () => {
			try {
				const payerBalance = await connection.getBalance(payer.publicKey);
				console.log(`\n💰 Final payer balance: ${(payerBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
			} catch (error) {
				console.log("Could not check final payer balance");
			}
		}, 3000);

		if (successCount > 0) {
			console.log("\n✅ At least some wallets were cleaned successfully!");
			console.log("💡 Check individual transaction results above");
		}

		if (failedCount > 0) {
			console.log("\n⚠️  Some wallets had failures - you may need to manually check them");
		}

	} catch (error) {
		console.error("❌ Cleanup error:", error);
	}
}