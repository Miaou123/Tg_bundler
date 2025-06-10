import { connection, wallet, payer } from "../config";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { loadKeypairs } from "./createKeys";
const promptSync = require("prompt-sync");
import bs58 from "bs58";
import fs from "fs";
import path from "path";

const prompt = promptSync();

export async function exportAllWallets() {
	console.log("📋 EXPORT ALL WALLET KEYS");
	console.log("=========================");
	console.log("This will display ALL wallet public and private keys");
	console.log("⚠️  Keep this information secure!");

	const proceed = prompt("\n📋 EXPORT WALLET KEYS? (yes to confirm): ").toLowerCase();
	if (proceed !== 'yes') {
		console.log("Export cancelled.");
		return;
	}

	try {
		console.log("\n" + "=".repeat(80));
		console.log("🔑 ALL WALLET KEYS EXPORT");
		console.log("=".repeat(80));

		// ✅ Export DEV WALLET
		console.log("\n👤 DEV WALLET:");
		console.log("-".repeat(50));
		console.log(`Public Key:  ${wallet.publicKey.toString()}`);
		console.log(`Private Key: ${bs58.encode(wallet.secretKey)}`);
		
		// Check balance
		try {
			const balance = await connection.getBalance(wallet.publicKey);
			console.log(`Balance:     ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
		} catch (error) {
			console.log(`Balance:     Error checking balance`);
		}

		// ✅ Export PAYER WALLET
		console.log("\n💳 PAYER WALLET:");
		console.log("-".repeat(50));
		console.log(`Public Key:  ${payer.publicKey.toString()}`);
		console.log(`Private Key: ${bs58.encode(payer.secretKey)}`);
		
		// Check balance
		try {
			const balance = await connection.getBalance(payer.publicKey);
			console.log(`Balance:     ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
		} catch (error) {
			console.log(`Balance:     Error checking balance`);
		}

		// ✅ Export ALL 24 KEYPAIRS
		console.log("\n👥 ALL 24 GENERATED WALLETS:");
		console.log("-".repeat(50));

		const keypairs = loadKeypairs();
		
		for (let i = 0; i < keypairs.length; i++) {
			const keypair = keypairs[i];
			
			console.log(`\n🏪 WALLET ${i + 1}:`);
			console.log(`Public Key:  ${keypair.publicKey.toString()}`);
			console.log(`Private Key: ${bs58.encode(keypair.secretKey)}`);
			
			// Check balance
			try {
				const balance = await connection.getBalance(keypair.publicKey);
				console.log(`Balance:     ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
			} catch (error) {
				console.log(`Balance:     Error checking balance`);
			}
		}

		// ✅ Export to file option
		console.log("\n" + "=".repeat(80));
		console.log("💾 SAVE TO FILE OPTION");
		console.log("=".repeat(80));

		const saveToFile = prompt("\n💾 Save wallet keys to file? (y/yes): ").toLowerCase();
		if (saveToFile === 'yes' || saveToFile === 'y') {
			await saveWalletsToFile(keypairs);
		}

		// ✅ Import instructions
		console.log("\n" + "=".repeat(80));
		console.log("📝 HOW TO IMPORT INTO WALLETS");
		console.log("=".repeat(80));
		console.log("\n🔸 PHANTOM WALLET:");
		console.log("  1. Open Phantom wallet");
		console.log("  2. Click Settings → Add/Connect Wallet");
		console.log("  3. Select 'Import Private Key'");
		console.log("  4. Paste the private key (bs58 format above)");
		console.log("  5. Give it a name (e.g., 'Bundler Wallet 1')");

		console.log("\n🔸 SOLFLARE WALLET:");
		console.log("  1. Open Solflare");
		console.log("  2. Click '+' → Import Wallet");
		console.log("  3. Select 'Private Key'");
		console.log("  4. Paste the private key");

		console.log("\n🔸 OTHER WALLETS:");
		console.log("  - Most Solana wallets support importing via private key");
		console.log("  - Use the 'Private Key' format shown above (bs58 encoded)");
		console.log("  - The public key is for verification/reference only");

		console.log("\n⚠️  SECURITY REMINDER:");
		console.log("  - Never share private keys with anyone");
		console.log("  - Store them securely (password manager, encrypted file)");
		console.log("  - Consider this information highly sensitive");

	} catch (error) {
		console.error("❌ Export error:", error);
	}
}

async function saveWalletsToFile(keypairs: any[]) {
	const exportData = {
		timestamp: new Date().toISOString(),
		note: "Solana wallet export - KEEP SECURE!",
		devWallet: {
			name: "DEV WALLET",
			publicKey: wallet.publicKey.toString(),
			privateKey: bs58.encode(wallet.secretKey)
		},
		payerWallet: {
			name: "PAYER WALLET", 
			publicKey: payer.publicKey.toString(),
			privateKey: bs58.encode(payer.secretKey)
		},
		generatedWallets: keypairs.map((keypair, index) => ({
			name: `Wallet ${index + 1}`,
			index: index + 1,
			publicKey: keypair.publicKey.toString(),
			privateKey: bs58.encode(keypair.secretKey)
		}))
	};

	const filename = `wallet_export_${Date.now()}.json`;
	const filepath = path.join(__dirname, filename);

	try {
		fs.writeFileSync(filepath, JSON.stringify(exportData, null, 2));
		console.log(`✅ Wallet keys saved to: ${filepath}`);
		console.log(`📁 File contains ${keypairs.length + 2} wallets (dev + payer + generated)`);
		console.log(`⚠️  IMPORTANT: Keep this file secure and delete it after importing!`);
	} catch (error) {
		console.error("❌ Failed to save file:", error);
	}
}

// ✅ Quick balance checker for all wallets
export async function checkAllWalletBalances() {
	console.log("💰 QUICK BALANCE CHECK");
	console.log("======================");

	try {
		// Check dev wallet
		const devBalance = await connection.getBalance(wallet.publicKey);
		console.log(`👤 DEV WALLET: ${(devBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

		// Check payer wallet  
		const payerBalance = await connection.getBalance(payer.publicKey);
		console.log(`💳 PAYER WALLET: ${(payerBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

		// Check all generated wallets
		const keypairs = loadKeypairs();
		let totalSOL = devBalance + payerBalance;

		console.log(`\n👥 GENERATED WALLETS:`);
		for (let i = 0; i < keypairs.length; i++) {
			const balance = await connection.getBalance(keypairs[i].publicKey);
			totalSOL += balance;
			
			if (balance > 0.001 * LAMPORTS_PER_SOL) { // Only show wallets with meaningful balances
				console.log(`  Wallet ${i + 1}: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
			}
		}

		console.log(`\n📊 TOTAL SOL ACROSS ALL WALLETS: ${(totalSOL / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

	} catch (error) {
		console.error("❌ Balance check error:", error);
	}
}