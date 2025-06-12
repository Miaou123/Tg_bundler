import { createKeypairs } from "./src/createKeys";
import { buyBundle } from "./src/jitoPool";
import { sender } from "./src/senderUI";
import { unifiedSellFunction } from "./src/sellFunc";
import { sellAllTokensAndCleanup } from "./src/sellall";
import { exportAllWallets, checkAllWalletBalances } from "./src/exportWallets";
import { unifiedBuyFunction } from "./src/buyFunc";
import { generateVanityAddress, generateMultipleVanityAddresses, calculateVanityDifficulty } from "./src/vanity";
const promptSync = require("prompt-sync");

const prompt = promptSync();

async function main() {
	let running = true;

	while (running) {
		console.log("\nMenu:");
		console.log("1. Create Keypairs");
		console.log("2. Pre Launch Checklist");
		console.log("3. Create Pool Bundle");
		console.log("4. Sell % of Supply on Pump.Fun or PumpSwap");
		console.log("5. Buy % of Supply on Pump.Fun or PumpSwap");
		console.log("6. 🧹 CLEANUP - Sell ALL tokens & return SOL");
		console.log("7. 📋 EXPORT - All wallet keys for manual access");
		console.log("8. 💰 CHECK - Quick balance check all wallets");
		console.log("9. 🎯 VANITY - Generate custom address");
		console.log("10. 🎯 BATCH VANITY - Generate multiple custom addresses");
		console.log("11. 📊 VANITY DIFFICULTY - Check how hard a prefix is");
		console.log("Type 'exit' to quit.");

		const answer = prompt("Choose an option or 'exit': "); // Use prompt-sync for user input

		switch (answer) {
			case "1":
				await createKeypairs();
				break;
			case "2":
				await sender();
				break;
			case "3":
				await buyBundle();
				break;
			case "4":
				await unifiedSellFunction();
				break;
			case "5": 
				await unifiedBuyFunction();
				break;
			case "6":
				await sellAllTokensAndCleanup();
				break;
			case "7":
				await exportAllWallets();
				break;
			case "8":
				await checkAllWalletBalances();
				break;
			case "9":
				await generateVanityAddress();
				break;
			case "10":
				await generateMultipleVanityAddresses();
				break;
			case "11":
				await calculateVanityDifficulty();
				break;
			case "exit":
				running = false;
				break;
			default:
				console.log("Invalid option, please choose again.");
		}
	}

	console.log("Exiting...");
	process.exit(0);
}

main().catch((err) => {
	console.error("Error:", err);
});