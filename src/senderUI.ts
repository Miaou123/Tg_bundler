import { Keypair, PublicKey, SystemProgram, TransactionInstruction, VersionedTransaction, LAMPORTS_PER_SOL, TransactionMessage, Blockhash } from "@solana/web3.js";
import { loadKeypairs } from "./createKeys";
import { wallet, connection, payer, PUMP_PROGRAM } from "../config";
import * as spl from "@solana/spl-token";
import { searcherClient } from "./clients/jito";
import { Bundle as JitoBundle } from "jito-ts/dist/sdk/block-engine/types.js";
const promptSync = require("prompt-sync");
import { createLUT, extendLUT } from "./createLUT";
import fs from "fs";
import path from "path";
import { getRandomTipAccount } from "./clients/config";
import BN from "bn.js";
import * as anchor from "@coral-xyz/anchor";

const prompt = promptSync();
const keyInfoPath = path.join(__dirname, "keyInfo.json");

// Global account address (fixed)
const GLOBAL_ACCOUNT = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");

let poolInfo: { [key: string]: any } = {};
if (fs.existsSync(keyInfoPath)) {
	const data = fs.readFileSync(keyInfoPath, "utf-8");
	poolInfo = JSON.parse(data);
}

interface Buy {
	pubkey: PublicKey;
	solAmount: Number;
	tokenAmount: BN;
	percentSupply: number;
}

// ✅ NEW: Fetch current global parameters from Pump.fun
async function fetchCurrentGlobalParams() {
    try {
        console.log("🔍 Fetching current Pump.fun parameters...");
        
        // Fetch raw account data directly
        const globalAccountInfo = await connection.getAccountInfo(GLOBAL_ACCOUNT);
        
        if (!globalAccountInfo) {
            throw new Error("Global account not found");
        }

        // Parse the global account data manually
        // Global account structure (based on Pump.fun IDL):
        // 8 bytes: discriminator
        // 1 byte: initialized (bool)
        // 32 bytes: authority (pubkey)
        // 32 bytes: fee_recipient (pubkey)
        // 8 bytes: initial_virtual_token_reserves (u64)
        // 8 bytes: initial_virtual_sol_reserves (u64)
        // 8 bytes: initial_real_token_reserves (u64)
        // 8 bytes: token_total_supply (u64)
        // 8 bytes: fee_basis_points (u64)
        // ... and more fields

        const data = globalAccountInfo.data;
        
        // Skip discriminator (8 bytes) + initialized (1 byte) + authority (32 bytes) + fee_recipient (32 bytes) = 73 bytes
        let offset = 73;
        
        // Read u64 values (8 bytes each, little endian)
        const initialVirtualTokenReserves = new BN(data.subarray(offset, offset + 8), 'le');
        offset += 8;
        
        const initialVirtualSolReserves = new BN(data.subarray(offset, offset + 8), 'le');
        offset += 8;
        
        const initialRealTokenReserves = new BN(data.subarray(offset, offset + 8), 'le');
        offset += 8;
        
        const tokenTotalSupply = new BN(data.subarray(offset, offset + 8), 'le');
        offset += 8;
        
        const feeBasisPoints = new BN(data.subarray(offset, offset + 8), 'le');
        
        console.log("📊 CURRENT PUMP.FUN PARAMETERS:");
        console.log(`  Virtual Token Reserves: ${initialVirtualTokenReserves.toString()}`);
        console.log(`  Virtual SOL Reserves: ${initialVirtualSolReserves.toString()}`);
        console.log(`  Real Token Reserves: ${initialRealTokenReserves.toString()}`);
        console.log(`  Token Total Supply: ${tokenTotalSupply.toString()}`);
        console.log(`  Fee Basis Points: ${feeBasisPoints.toString()}`);

        // Verify the relationship is correct
        const isValid = initialVirtualTokenReserves.gt(initialRealTokenReserves);
        
        console.log(`  Virtual > Real? ${isValid ? '✅ VALID' : '❌ INVALID'}`);
        
        if (!isValid) {
            console.log("⚠️  WARNING: Global parameters may be incorrect!");
        }

        return {
            initialVirtualTokenReserves,
            initialVirtualSolReserves,
            initialRealTokenReserves,
            tokenTotalSupply,
            feeBasisPoints,
        };
    } catch (error) {
        console.error("❌ Failed to fetch global params:", error);
        console.log("🔄 Using fallback parameters...");
        
        // Fallback to known working values if fetch fails
        return {
            initialVirtualTokenReserves: new BN("1073000000000000"), // 1.073B tokens with 6 decimals
            initialVirtualSolReserves: new BN("30000000000"), // 30 SOL with 9 decimals  
            initialRealTokenReserves: new BN("793100000000000"), // 793.1M tokens with 6 decimals
            tokenTotalSupply: new BN("1000000000000000"), // 1B tokens with 6 decimals
            feeBasisPoints: new BN("100"), // 1%
        };
    }
}

async function generateSOLTransferForKeypairs(tipAmt: number, steps: number = 24): Promise<TransactionInstruction[]> {
	const keypairs: Keypair[] = loadKeypairs();
	const ixs: TransactionInstruction[] = [];

	let existingData: any = {};
	if (fs.existsSync(keyInfoPath)) {
		existingData = JSON.parse(fs.readFileSync(keyInfoPath, "utf-8"));
	}

	// ❌ REMOVED: Dev wallet funding (manually funded)
	// Dev wallet is expected to be manually funded

	// Loop through the keypairs and process each one
	for (let i = 0; i < Math.min(steps, keypairs.length); i++) {
		const keypair = keypairs[i];
		const keypairPubkeyStr = keypair.publicKey.toString();

		if (!existingData[keypairPubkeyStr] || !existingData[keypairPubkeyStr].solAmount) {
			console.log(`Missing solAmount for wallet ${i + 1}, skipping.`);
			continue;
		}

		const solAmount = parseFloat(existingData[keypairPubkeyStr].solAmount);

		try {
			// ✅ FIXED: Send solAmount * 1.015 + 0.01 to meet threshold
			ixs.push(
				SystemProgram.transfer({
					fromPubkey: payer.publicKey,
					toPubkey: keypair.publicKey,
					lamports: Math.floor((solAmount * 1.015 + 0.01) * LAMPORTS_PER_SOL),
				})
			);
			console.log(`Sent ${(solAmount * 1.015 + 0.01).toFixed(4)} SOL to Wallet ${i + 1} (${keypair.publicKey.toString()})`);
		} catch (error) {
			console.error(`Error creating transfer instruction for wallet ${i + 1}:`, error);
			continue;
		}
	}

	ixs.push(
		SystemProgram.transfer({
			fromPubkey: payer.publicKey,
			toPubkey: getRandomTipAccount(),
			lamports: BigInt(tipAmt),
		})
	);

	return ixs;
}

function chunkArray<T>(array: T[], chunkSize: number): T[][] {
	const chunks = [];
	for (let i = 0; i < array.length; i += chunkSize) {
		chunks.push(array.slice(i, i + chunkSize));
	}
	return chunks;
}

async function createAndSignVersionedTxWithKeypairs(instructionsChunk: TransactionInstruction[], blockhash: Blockhash | string): Promise<VersionedTransaction> {
	let poolInfo: { [key: string]: any } = {};
	if (fs.existsSync(keyInfoPath)) {
		const data = fs.readFileSync(keyInfoPath, "utf-8");
		poolInfo = JSON.parse(data);
	}

	const lut = new PublicKey(poolInfo.addressLUT.toString());

	const lookupTableAccount = (await connection.getAddressLookupTable(lut)).value;

	if (lookupTableAccount == null) {
		console.log("Lookup table account not found!");
		process.exit(0);
	}

	const addressesMain: PublicKey[] = [];
	instructionsChunk.forEach((ixn) => {
		ixn.keys.forEach((key) => {
			addressesMain.push(key.pubkey);
		});
	});

	const message = new TransactionMessage({
		payerKey: payer.publicKey,
		recentBlockhash: blockhash,
		instructions: instructionsChunk,
	}).compileToV0Message([lookupTableAccount]);

	const versionedTx = new VersionedTransaction(message);

	versionedTx.sign([payer]);

	return versionedTx;
}

async function processInstructionsSOL(ixs: TransactionInstruction[], blockhash: string | Blockhash): Promise<VersionedTransaction[]> {
	const txns: VersionedTransaction[] = [];
	const instructionChunks = chunkArray(ixs, 45);

	for (let i = 0; i < instructionChunks.length; i++) {
		const versionedTx = await createAndSignVersionedTxWithKeypairs(instructionChunks[i], blockhash);
		txns.push(versionedTx);
	}

	return txns;
}

async function sendBundle(txns: VersionedTransaction[]) {
	try {
		const bundleId = await searcherClient.sendBundle(new JitoBundle(txns, txns.length));
		console.log(`Bundle ${bundleId} sent.`);
	} catch (error) {
		const err = error as any;
		console.error("Error sending bundle:", err.message);

		if (err?.message?.includes("Bundle Dropped, no connected leader up soon")) {
			console.error("Error sending bundle: Bundle Dropped, no connected leader up soon.");
		} else {
			console.error("An unexpected error occurred:", err.message);
		}
	}
}

async function generateATAandSOL() {
	const jitoTipAmt = +prompt("Jito tip in Sol (Ex. 0.01): ") * LAMPORTS_PER_SOL;

	const { blockhash } = await connection.getLatestBlockhash();
	const sendTxns: VersionedTransaction[] = [];

	const solIxs = await generateSOLTransferForKeypairs(jitoTipAmt);

	const solTxns = await processInstructionsSOL(solIxs, blockhash);
	sendTxns.push(...solTxns);

	await sendBundle(sendTxns);
}

async function createReturns() {
	const txsSigned: VersionedTransaction[] = [];
	const keypairs = loadKeypairs();
	const chunkedKeypairs = chunkArray(keypairs, 7); // EDIT CHUNKS?

	const jitoTipIn = prompt("Jito tip in Sol (Ex. 0.01): ");
	const TipAmt = parseFloat(jitoTipIn) * LAMPORTS_PER_SOL;

	const { blockhash } = await connection.getLatestBlockhash();

	// Iterate over each chunk of keypairs
	for (let chunkIndex = 0; chunkIndex < chunkedKeypairs.length; chunkIndex++) {
		const chunk = chunkedKeypairs[chunkIndex];
		const instructionsForChunk: TransactionInstruction[] = [];

		// Iterate over each keypair in the chunk to create swap instructions
		for (let i = 0; i < chunk.length; i++) {
			const keypair = chunk[i];
			console.log(`Processing keypair ${i + 1}/${chunk.length}:`, keypair.publicKey.toString());

			const balance = await connection.getBalance(keypair.publicKey);

			const sendSOLixs = SystemProgram.transfer({
				fromPubkey: keypair.publicKey,
				toPubkey: payer.publicKey,
				lamports: balance,
			});

			instructionsForChunk.push(sendSOLixs);
		}

		if (chunkIndex === chunkedKeypairs.length - 1) {
			const tipSwapIxn = SystemProgram.transfer({
				fromPubkey: payer.publicKey,
				toPubkey: getRandomTipAccount(),
				lamports: BigInt(TipAmt),
			});
			instructionsForChunk.push(tipSwapIxn);
			console.log("Jito tip added :).");
		}

		const lut = new PublicKey(poolInfo.addressLUT.toString());

		const message = new TransactionMessage({
			payerKey: payer.publicKey,
			recentBlockhash: blockhash,
			instructions: instructionsForChunk,
		}).compileToV0Message([poolInfo.addressLUT]);

		const versionedTx = new VersionedTransaction(message);

		const serializedMsg = versionedTx.serialize();
		console.log("Txn size:", serializedMsg.length);
		if (serializedMsg.length > 1232) {
			console.log("tx too big");
		}

		console.log(
			"Signing transaction with chunk signers",
			chunk.map((kp) => kp.publicKey.toString())
		);

		versionedTx.sign([payer]);

		for (const keypair of chunk) {
			versionedTx.sign([keypair]);
		}

		txsSigned.push(versionedTx);
	}

	await sendBundle(txsSigned);
}

// ✅ UPDATED: Use live global parameters in simulation
async function simulateAndWriteBuys() {
	console.log("\n🎯 BONDING CURVE SIMULATION");
	console.log("============================");
	
	// ✅ FETCH CURRENT PARAMETERS INSTEAD OF HARDCODING
	const globalParams = await fetchCurrentGlobalParams();
	
	const keypairs = loadKeypairs();
	const tokenDecimals = 10 ** 6;
	
	// ✅ USE LIVE PARAMETERS
	let initialRealSolReserves = 0;
	let initialVirtualTokenReserves = globalParams.initialVirtualTokenReserves.toNumber();
	let initialRealTokenReserves = globalParams.initialRealTokenReserves.toNumber();
	const tokenTotalSupply = globalParams.tokenTotalSupply.toNumber();
	let totalTokensBought = 0;
	
	console.log("\n📊 Using LIVE Pump.fun parameters:");
	console.log(`  Virtual Token Reserves: ${(initialVirtualTokenReserves / tokenDecimals).toFixed(2)}M tokens`);
	console.log(`  Real Token Reserves: ${(initialRealTokenReserves / tokenDecimals).toFixed(2)}M tokens`);
	console.log(`  Virtual SOL Reserves: ${globalParams.initialVirtualSolReserves.toNumber() / LAMPORTS_PER_SOL} SOL`);
	console.log(`  Token Total Supply: ${(tokenTotalSupply / tokenDecimals).toFixed(2)}M tokens`);
	console.log(`  Virtual > Real? ${initialVirtualTokenReserves > initialRealTokenReserves ? '✅ VALID' : '❌ INVALID'}`);

	const buys: { pubkey: PublicKey; solAmount: Number; tokenAmount: BN; percentSupply: number }[] = [];

	console.log("\nThis simulation accounts for slippage between purchases.");
	console.log("Each buy affects the price for the next buy.\n");

	for (let it = 0; it <= 24; it++) {
		let keypair;
		let solInput;
		
		if (it === 0) {
			solInput = prompt(`Enter SOL amount for DEV wallet (0 to skip): `);
			keypair = wallet;
		} else {
			solInput = prompt(`Enter SOL amount for wallet ${it} (0 or empty to skip): `);
			keypair = keypairs[it - 1];
		}

		// ✅ FIX: Better input validation
		const solInputNumber = parseFloat(solInput);
		
		// Skip if input is empty, invalid, or zero
		if (!solInput || solInput.trim() === '' || isNaN(solInputNumber) || solInputNumber <= 0) {
			console.log(`  ℹ️  Wallet ${it === 0 ? 'DEV' : it} skipped (no buy configured)\n`);
			continue;
		}

		// ✅ FIX: Use actual input amount (no multipliers)
		const actualSolInput = solInputNumber;
		const solAmount = actualSolInput * LAMPORTS_PER_SOL;

		// ✅ FIX: Updated bonding curve calculation with proper reserves
		const solAmountBN = new BN(solAmount);
		const currentVirtualSolReserves = globalParams.initialVirtualSolReserves.toNumber() + initialRealSolReserves;
		
		// Bonding curve: k = virtualSol * virtualTokens
		const k = new BN(currentVirtualSolReserves).mul(new BN(initialVirtualTokenReserves));
		const newVirtualSolReserves = new BN(currentVirtualSolReserves).add(solAmountBN);
		const newVirtualTokenReserves = k.div(newVirtualSolReserves);
		
		let tokensToBuy = new BN(initialVirtualTokenReserves).sub(newVirtualTokenReserves);
		
		// ✅ FIX: Cap tokens to available real reserves
		const maxTokensAvailable = new BN(initialRealTokenReserves);
		tokensToBuy = BN.min(tokensToBuy, maxTokensAvailable);
		
		const tokensBought = tokensToBuy.toNumber();
		const percentSupply = (tokensBought / tokenTotalSupply) * 100;

		// ✅ FIX: Better display formatting
		console.log(`  💰 ${it === 0 ? 'DEV WALLET' : `WALLET ${it}`}:`);
		console.log(`     Input: ${actualSolInput} SOL`);
		console.log(`     Output: ${(tokensBought / tokenDecimals).toFixed(2)}M tokens`);
		console.log(`     Supply: ${percentSupply.toFixed(4)}%`);
		console.log(`     Price impact: ${((tokensBought / initialVirtualTokenReserves) * 100).toFixed(4)}%\n`);

		// ✅ CRITICAL: Check for dangerous price impact
		if (tokensBought / initialVirtualTokenReserves > 0.1) { // More than 10% of virtual supply
			console.log(`     ⚠️  WARNING: High price impact (${((tokensBought / initialVirtualTokenReserves) * 100).toFixed(2)}%)`);
			console.log(`     This could cause slippage failures in actual transactions.\n`);
		}

		// Add to buys array
		buys.push({ 
			pubkey: keypair.publicKey, 
			solAmount: Number(actualSolInput), 
			tokenAmount: tokensToBuy, 
			percentSupply 
		});

		// ✅ FIX: Update reserves for next calculation (this is crucial!)
		initialRealSolReserves += solAmountBN.toNumber();
		initialRealTokenReserves -= tokensBought;
		initialVirtualTokenReserves -= tokensBought;
		totalTokensBought += tokensBought;
	}

	// ✅ FIX: Better summary with slippage warnings
	console.log("\n📊 SIMULATION SUMMARY");
	console.log("====================");
	console.log(`Final real SOL reserves: ${(initialRealSolReserves / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
	console.log(`Final real token reserves: ${(initialRealTokenReserves / tokenDecimals).toFixed(2)}M tokens`);
	console.log(`Final virtual token reserves: ${(initialVirtualTokenReserves / tokenDecimals).toFixed(2)}M tokens`);
	console.log(`Total tokens bought: ${(totalTokensBought / tokenDecimals).toFixed(2)}M tokens`);
	console.log(`Total % of supply bought: ${((totalTokensBought / tokenTotalSupply) * 100).toFixed(4)}%`);
	
	// ✅ FIX: Slippage warning
	const totalPriceImpact = (totalTokensBought / globalParams.initialVirtualTokenReserves.toNumber()) * 100;
	if (totalPriceImpact > 15) {
		console.log(`\n⚠️  HIGH SLIPPAGE WARNING!`);
		console.log(`Total price impact: ${totalPriceImpact.toFixed(2)}%`);
		console.log(`This could cause transaction failures. Consider:`);
		console.log(`- Reducing buy amounts`);
		console.log(`- Spacing out purchases over time`);
		console.log(`- Using more forgiving slippage tolerances\n`);
	}

	// ✅ CRITICAL: Check if reserves relationship will be maintained
	const finalVirtualTokenReserves = globalParams.initialVirtualTokenReserves.toNumber() - totalTokensBought;
	const finalRealTokenReserves = globalParams.initialRealTokenReserves.toNumber() - totalTokensBought;
	
	console.log(`\n🔍 FINAL RESERVE CHECK:`);
	console.log(`  Final Virtual Token Reserves: ${(finalVirtualTokenReserves / tokenDecimals).toFixed(2)}M`);
	console.log(`  Final Real Token Reserves: ${(finalRealTokenReserves / tokenDecimals).toFixed(2)}M`);
	console.log(`  Virtual > Real? ${finalVirtualTokenReserves > finalRealTokenReserves ? '✅ VALID' : '❌ INVALID - WILL FAIL!'}`);
	
	if (finalVirtualTokenReserves <= finalRealTokenReserves) {
		console.log(`\n🚨 CRITICAL ERROR: Your simulation violates Pump.fun constraints!`);
		console.log(`You're buying too many tokens. The CREATE transaction will fail.`);
		console.log(`Please reduce your buy amounts and try again.\n`);
		return; // Don't save invalid simulation
	}

	const confirm = prompt("Do you want to use these buys? (yes/no): ").toLowerCase();
	if (confirm === "yes") {
		writeBuysToFile(buys);
	} else {
		console.log("Simulation aborted. Restarting...");
		simulateAndWriteBuys();
	}
}

// ✅ FIX: Better buy file writing with validation
function writeBuysToFile(buys: Buy[]) {
	let buysObj: any = {};

	// Read existing data to preserve LUT and mint info
	let existingData: any = {};
	if (fs.existsSync(keyInfoPath)) {
		existingData = JSON.parse(fs.readFileSync(keyInfoPath, "utf-8"));
	}

	// Preserve important non-wallet data
	if (existingData.addressLUT) buysObj.addressLUT = existingData.addressLUT;
	if (existingData.mint) buysObj.mint = existingData.mint;
	if (existingData.mintPk) buysObj.mintPk = existingData.mintPk;
	if (existingData.numOfWallets) buysObj.numOfWallets = existingData.numOfWallets;

	// Add wallet buy data with validation
	let validBuys = 0;
	buys.forEach(buy => {
		const solAmount = Number(buy.solAmount);
		const tokenAmount = buy.tokenAmount.toString();
		
		// ✅ FIX: Validate data before saving
		if (solAmount > 0 && tokenAmount !== "0") {
			buysObj[buy.pubkey.toString()] = {
				solAmount: solAmount.toString(),
				tokenAmount: tokenAmount,
				percentSupply: buy.percentSupply,
			};
			validBuys++;
		}
	});

	// Write to file
	fs.writeFileSync(keyInfoPath, JSON.stringify(buysObj, null, 2), "utf8");
	
	console.log(`\n✅ SUCCESS: Saved ${validBuys} valid wallet configurations`);
	console.log(`📁 File: ${keyInfoPath}`);
	
	// ✅ DEBUG: Show what was saved
	console.log(`\n📋 SAVED BUY DATA:`);
	buys.forEach((buy, index) => {
		const solAmount = Number(buy.solAmount);
		if (solAmount > 0) {
			const walletName = buy.pubkey.equals(wallet.publicKey) ? "DEV" : `W${index}`;
			console.log(`  ${walletName}: ${solAmount} SOL → ${(buy.tokenAmount.toNumber() / 1e6).toFixed(2)}M tokens`);
		}
	});
	
	console.log(`\n💡 NEXT STEPS:`);
	console.log(`1. Run "Send Simulation SOL Bundle" to fund wallets`);
	console.log(`2. Then run "Create Pool Bundle" to launch`);
}

export async function sender() {
	let running = true;

	while (running) {
		console.log("\nBuyer UI:");
		console.log("1. Create LUT");
		console.log("2. Extend LUT Bundle");
		console.log("3. Simulate Buys");
		console.log("4. Send Simulation SOL Bundle");
		console.log("5. Reclaim Buyers Sol");

		const answer = prompt("Choose an option or 'exit': "); // Use prompt-sync for user input

		switch (answer) {
			case "1":
				await createLUT();
				break;
			case "2":
				await extendLUT();
				break;
			case "3":
				await simulateAndWriteBuys();
				break;
			case "4":
				await generateATAandSOL();
				break;
			case "5":
				await createReturns();
				break;
			case "exit":
				running = false;
				break;
			default:
				console.log("Invalid option, please choose again.");
		}
	}

	console.log("Exiting...");
}