import { connection, wallet, PUMP_PROGRAM, feeRecipient, eventAuthority, global, MPL_TOKEN_METADATA_PROGRAM_ID, mintAuthority, rpc, payer } from "../config";
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
	AccountMeta,
	ComputeBudgetProgram,
} from "@solana/web3.js";
import { loadKeypairs } from "./createKeys";
import { searcherClient } from "./clients/jito";
import { Bundle as JitoBundle } from "jito-ts/dist/sdk/block-engine/types.js";
import promptSync from "prompt-sync";
import * as spl from "@solana/spl-token";
import bs58 from "bs58";
import path from "path";
import fs from "fs";
import { Program } from "@coral-xyz/anchor";
import { getRandomTipAccount } from "./clients/config";
import BN from "bn.js";
import axios from "axios";
import * as anchor from "@coral-xyz/anchor";

const prompt = promptSync();
const keyInfoPath = path.join(__dirname, "keyInfo.json");

export async function buyBundle() {
	const provider = new anchor.AnchorProvider(new anchor.web3.Connection(rpc), new anchor.Wallet(wallet), { commitment: "confirmed" });

	// Initialize pumpfun anchor
	const IDL_PumpFun = JSON.parse(fs.readFileSync("./pumpfun-IDL.json", "utf-8")) as anchor.Idl;

	const program = new anchor.Program(IDL_PumpFun, PUMP_PROGRAM, provider);

	// Start create bundle
	const bundledTxns: VersionedTransaction[] = [];
	const keypairs: Keypair[] = loadKeypairs();

	let keyInfo: { [key: string]: any } = {};
	if (fs.existsSync(keyInfoPath)) {
		const existingData = fs.readFileSync(keyInfoPath, "utf-8");
		keyInfo = JSON.parse(existingData);
	}

	const lut = new PublicKey(keyInfo.addressLUT.toString());

	// -------- step 1: ask nessesary questions for pool build --------
	const name = prompt("Name of your token: ");
	const symbol = prompt("Symbol of your token: ");
	const description = prompt("Description of your token: ");
	const twitter = prompt("Twitter of your token: ");
	const telegram = prompt("Telegram of your token: ");
	const website = prompt("Website of your token: ");
	const tipAmt = +prompt("Jito tip in SOL: ") * LAMPORTS_PER_SOL;

	// -------- step 2: build pool init + dev snipe --------
	const files = await fs.promises.readdir("./img");
	if (files.length == 0) {
		console.log("No image found in the img folder");
		return;
	}
	if (files.length > 1) {
		console.log("Multiple images found in the img folder, please only keep one image");
		return;
	}
	const data: Buffer = fs.readFileSync(`./img/${files[0]}`);

	let formData = new FormData();
	if (data) {
		formData.append("file", new Blob([data], { type: "image/jpeg" }));
	} else {
		console.log("No image found");
		return;
	}

	formData.append("name", name);
	formData.append("symbol", symbol);
	formData.append("description", description);
	formData.append("twitter", twitter);
	formData.append("telegram", telegram);
	formData.append("website", website);
	formData.append("showName", "true");

	let metadata_uri;
	try {
		const response = await axios.post("https://pump.fun/api/ipfs", formData, {
			headers: {
				"Content-Type": "multipart/form-data",
			},
		});
		metadata_uri = response.data.metadataUri;
		console.log("Metadata URI: ", metadata_uri);
	} catch (error) {
		console.error("Error uploading metadata:", error);
		return;
	}

	const mintKp = Keypair.fromSecretKey(Uint8Array.from(bs58.decode(keyInfo.mintPk)));
	console.log(`Mint: ${mintKp.publicKey.toBase58()}`);

	// Derive accounts using the PUMP_PROGRAM (not the anchor program)
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

	console.log("Derived accounts:");
	console.log("Bonding Curve:", bondingCurve.toString());
	console.log("Metadata:", metadata.toString());
	console.log("Associated Bonding Curve:", associatedBondingCurve.toString());
	console.log("Global:", global.toString());

	// Extract tokenAmount from keyInfo for dev wallet
	const keypairInfo = keyInfo[wallet.publicKey.toString()];
	if (!keypairInfo) {
		console.log(`No key info found for dev wallet: ${wallet.publicKey.toString()}`);
		return;
	}

	// Calculate SOL amount based on tokenAmount
	const amount = new BN(keypairInfo.tokenAmount);
	const solAmount = new BN(keypairInfo.solAmount * LAMPORTS_PER_SOL);

	console.log("Building manual instructions with exact format...");

	// Manual create instruction with exact Pump.Fun format
	const createData = Buffer.alloc(512);
	let offset = 0;

	// Method selector (from successful Pump.Fun transactions)
	const selector = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);
	selector.copy(createData, offset);
	offset += 8;

	// String encoding: length as u32 LE + utf8 bytes
	function writeString(str: string) {
		const strBytes = Buffer.from(str, 'utf8');
		createData.writeUInt32LE(strBytes.length, offset);
		offset += 4;
		strBytes.copy(createData, offset);
		offset += strBytes.length;
	}

	writeString(name);
	writeString(symbol);
	writeString(metadata_uri);

	const createInstructionData = createData.subarray(0, offset);

	const createIx = new TransactionInstruction({
		keys: [
			{ pubkey: mintKp.publicKey, isSigner: true, isWritable: true },
			{ pubkey: mintAuthority, isSigner: false, isWritable: false },
			{ pubkey: bondingCurve, isSigner: false, isWritable: true },
			{ pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
			{ pubkey: global, isSigner: false, isWritable: false },
			{ pubkey: MPL_TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: metadata, isSigner: false, isWritable: true },
			{ pubkey: wallet.publicKey, isSigner: true, isWritable: true },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
			{ pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: spl.ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
			{ pubkey: eventAuthority, isSigner: false, isWritable: false },
			{ pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
		],
		programId: PUMP_PROGRAM,
		data: createInstructionData,
	});

	console.log("Create instruction data length:", createInstructionData.length);

	// Get the associated token address for dev wallet
	const ata = spl.getAssociatedTokenAddressSync(mintKp.publicKey, wallet.publicKey);

	// Manual buy instruction
	const buyData = Buffer.alloc(24);
	offset = 0;

	// Buy method selector
	const buySelector = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
	buySelector.copy(buyData, offset);
	offset += 8;

	// Amount (u64 LE)
	amount.toArrayLike(Buffer, 'le', 8).copy(buyData, offset);
	offset += 8;

	// Max SOL cost (u64 LE)
	solAmount.toArrayLike(Buffer, 'le', 8).copy(buyData, offset);

	const buyIx = new TransactionInstruction({
		keys: [
			{ pubkey: global, isSigner: false, isWritable: false },
			{ pubkey: feeRecipient, isSigner: false, isWritable: true },
			{ pubkey: mintKp.publicKey, isSigner: false, isWritable: false },
			{ pubkey: bondingCurve, isSigner: false, isWritable: true },
			{ pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
			{ pubkey: ata, isSigner: false, isWritable: true },
			{ pubkey: wallet.publicKey, isSigner: true, isWritable: true },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
			{ pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
			{ pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
			{ pubkey: eventAuthority, isSigner: false, isWritable: false },
			{ pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
		],
		programId: PUMP_PROGRAM,
		data: buyData,
	});

	// Add compute budget instructions
	const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
	const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 });

	// Create ATA instruction - use the right one that works
	const ataIx = spl.createAssociatedTokenAccountInstruction(
		wallet.publicKey, // payer
		ata, // ata address
		wallet.publicKey, // owner
		mintKp.publicKey // mint
	);

	const tipIxn = SystemProgram.transfer({
		fromPubkey: wallet.publicKey,
		toPubkey: getRandomTipAccount(),
		lamports: BigInt(tipAmt),
	});

	// Build instruction array
	const initIxs: TransactionInstruction[] = [
		computeLimitIx, 
		computePriceIx, 
		createIx, 
		ataIx, 
		buyIx, 
		tipIxn
	];

	const { blockhash } = await connection.getLatestBlockhash();

	// Get lookup table account properly
	const lutAccount = (await connection.getAddressLookupTable(lut)).value;
	if (!lutAccount) {
		console.log("Lookup table account not found!");
		return;
	}

	const messageV0 = new TransactionMessage({
		payerKey: wallet.publicKey,
		instructions: initIxs,
		recentBlockhash: blockhash,
	}).compileToV0Message([lutAccount]);

	const fullTX = new VersionedTransaction(messageV0);
	fullTX.sign([wallet, mintKp]);

	// Check transaction size
	const serializedTx = fullTX.serialize();
	console.log(`Initial transaction size: ${serializedTx.length} bytes`);

	bundledTxns.push(fullTX);

	// -------- step 3: create swap txns --------
	const txMainSwaps: VersionedTransaction[] = await createWalletSwaps(blockhash, keypairs, lutAccount, bondingCurve, associatedBondingCurve, mintKp.publicKey);
	bundledTxns.push(...txMainSwaps);

	// -------- step 4: send bundle --------
	// Simulate each transaction
	console.log("\n=== SIMULATING ALL TRANSACTIONS ===");
	for (let i = 0; i < bundledTxns.length; i++) {
		const tx = bundledTxns[i];
		console.log(`\nSimulating transaction ${i + 1}/${bundledTxns.length}:`);
		try {
			const simulationResult = await connection.simulateTransaction(tx, { commitment: "processed" });

			if (simulationResult.value.err) {
				console.error("❌ Simulation error:", simulationResult.value.err);
				console.log("Logs:", simulationResult.value.logs);
			} else {
				console.log("✅ Simulation success!");
			}
		} catch (error) {
			console.error("❌ Error during simulation:", error);
		}
	}

	await sendBundle(bundledTxns);
}

async function createWalletSwaps(
	blockhash: string,
	keypairs: Keypair[],
	lut: AddressLookupTableAccount,
	bondingCurve: PublicKey,
	associatedBondingCurve: PublicKey,
	mint: PublicKey
): Promise<VersionedTransaction[]> {
	const txsSigned: VersionedTransaction[] = [];
	const chunkedKeypairs = chunkArray(keypairs, 2);

	// Load keyInfo data from JSON file
	let keyInfo: { [key: string]: { solAmount: number; tokenAmount: string; percentSupply: number } } = {};
	if (fs.existsSync(keyInfoPath)) {
		const existingData = fs.readFileSync(keyInfoPath, "utf-8");
		keyInfo = JSON.parse(existingData);
	}

	// Iterate over each chunk of keypairs
	for (let chunkIndex = 0; chunkIndex < chunkedKeypairs.length; chunkIndex++) {
		const chunk = chunkedKeypairs[chunkIndex];
		const validKeypairs = chunk.filter(kp => kp.publicKey.toString() in keyInfo);
		
		if (validKeypairs.length === 0) {
			console.log(`Skipping chunk ${chunkIndex} - no valid keypairs`);
			continue;
		}

		const instructionsForChunk: TransactionInstruction[] = [];

		// Add compute budget
		const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });
		const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 });
		instructionsForChunk.push(computeLimitIx, computePriceIx);

		// Process each valid keypair
		for (const keypair of validKeypairs) {
			console.log(`Processing keypair: ${keypair.publicKey.toString()}`);

			const ataAddress = spl.getAssociatedTokenAddressSync(mint, keypair.publicKey);
			const keypairInfo = keyInfo[keypair.publicKey.toString()];
			const amount = new BN(keypairInfo.tokenAmount);
			const solAmount = new BN(keypairInfo.solAmount * LAMPORTS_PER_SOL);

			// Create ATA instruction
			const createTokenAta = spl.createAssociatedTokenAccountInstruction(
				payer.publicKey,
				ataAddress,
				keypair.publicKey,
				mint
			);

			// Manual buy instruction
			const buyData = Buffer.alloc(24);
			let offset = 0;

			// Buy selector
			const buySelector = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
			buySelector.copy(buyData, offset);
			offset += 8;

			// Amount and sol amount
			amount.toArrayLike(Buffer, 'le', 8).copy(buyData, offset);
			offset += 8;
			solAmount.toArrayLike(Buffer, 'le', 8).copy(buyData, offset);

			const buyIx = new TransactionInstruction({
				keys: [
					{ pubkey: global, isSigner: false, isWritable: false },
					{ pubkey: feeRecipient, isSigner: false, isWritable: true },
					{ pubkey: mint, isSigner: false, isWritable: false },
					{ pubkey: bondingCurve, isSigner: false, isWritable: true },
					{ pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
					{ pubkey: ataAddress, isSigner: false, isWritable: true },
					{ pubkey: keypair.publicKey, isSigner: true, isWritable: true },
					{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
					{ pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
					{ pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
					{ pubkey: eventAuthority, isSigner: false, isWritable: false },
					{ pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
				],
				programId: PUMP_PROGRAM,
				data: buyData,
			});

			instructionsForChunk.push(createTokenAta, buyIx);
		}

		if (instructionsForChunk.length <= 2) continue;

		const message = new TransactionMessage({
			payerKey: payer.publicKey,
			recentBlockhash: blockhash,
			instructions: instructionsForChunk,
		}).compileToV0Message([lut]);

		const versionedTx = new VersionedTransaction(message);

		const serializedMsg = versionedTx.serialize();
		console.log("Txn size:", serializedMsg.length);
		if (serializedMsg.length > 1232) {
			console.log("tx too big, skipping");
			continue;
		}

		// Sign transaction
		versionedTx.sign([payer]);
		for (const kp of validKeypairs) {
			versionedTx.sign([kp]);
		}

		txsSigned.push(versionedTx);
	}

	return txsSigned;
}

function chunkArray<T>(array: T[], size: number): T[][] {
	return Array.from({ length: Math.ceil(array.length / size) }, (v, i) => array.slice(i * size, i * size + size));
}

export async function sendBundle(bundledTxns: VersionedTransaction[]) {
	if (bundledTxns.length === 0) {
		console.log("No transactions to send in bundle");
		return;
	}

	try {
		const bundleId = await searcherClient.sendBundle(new JitoBundle(bundledTxns, bundledTxns.length));
		console.log(`Bundle ${bundleId} sent.`);

		// Listen for bundle result
		const result = await new Promise((resolve, reject) => {
			searcherClient.onBundleResult(
				(result) => {
					console.log("Received bundle result:", result);
					resolve(result);
				},
				(e: Error) => {
					console.error("Error receiving bundle result:", e);
					reject(e);
				}
			);
		});

		console.log("Result:", result);
	} catch (error) {
		const err = error as any;
		console.error("Error sending bundle:", err.message);
	}
}