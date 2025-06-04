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
} from "@solana/web3.js";
import { loadKeypairs } from "./createKeys";
import { searcherClient } from "./clients/jito";
import { Bundle as JitoBundle } from "jito-ts/dist/sdk/block-engine/types.js";
import promptSync from "prompt-sync";
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

function chunkArray<T>(array: T[], size: number): T[][] {
	return Array.from({ length: Math.ceil(array.length / size) }, (v, i) => array.slice(i * size, i * size + size));
}

async function createWalletSwaps(
	program: anchor.Program,
	blockhash: string,
	keypairs: Keypair[],
	lut: AddressLookupTableAccount,
	mint: PublicKey
): Promise<VersionedTransaction[]> {
	const txsSigned: VersionedTransaction[] = [];
	const chunkedKeypairs = chunkArray(keypairs, 6);

	// Load keyInfo data from JSON file
	let keyInfo: { [key: string]: { solAmount: number; tokenAmount: string; percentSupply: number } } = {};
	if (fs.existsSync(keyInfoPath)) {
		const existingData = fs.readFileSync(keyInfoPath, "utf-8");
		keyInfo = JSON.parse(existingData);
	}

	// Iterate over each chunk of keypairs
	for (let chunkIndex = 0; chunkIndex < chunkedKeypairs.length; chunkIndex++) {
		const chunk = chunkedKeypairs[chunkIndex];
		const instructionsForChunk: TransactionInstruction[] = [];

		// Iterate over each keypair in the chunk to create swap instructions
		for (let i = 0; i < chunk.length; i++) {
			const keypair = chunk[i];
			console.log(`Processing keypair ${i + 1}/${chunk.length}:`, keypair.publicKey.toString());

			const ataAddress = await spl.getAssociatedTokenAddress(mint, keypair.publicKey);
			const createTokenAta = spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ataAddress, keypair.publicKey, mint);

			// Extract tokenAmount from keyInfo for this keypair
			const keypairInfo = keyInfo[keypair.publicKey.toString()];
			if (!keypairInfo) {
				console.log(`No key info found for keypair: ${keypair.publicKey.toString()}`);
				continue;
			}

			// Calculate SOL amount based on tokenAmount
			const amount = new BN(keypairInfo.tokenAmount);
			const solAmount = new BN(100000 * keypairInfo.solAmount * LAMPORTS_PER_SOL);

			// Create buy instruction with Anchor (now with creator parameter)
			const buyIx = await (program.methods as any)
				.buy(amount, solAmount)
				.accounts({
					global: globalAccount,
					feeRecipient: feeRecipient,
					mint: mint,
					bondingCurve: PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mint.toBytes()], PUMP_PROGRAM)[0],
					associatedBondingCurve: PublicKey.findProgramAddressSync(
						[PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mint.toBytes()], PUMP_PROGRAM)[0].toBytes(), spl.TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()],
						spl.ASSOCIATED_TOKEN_PROGRAM_ID
					)[0],
					associatedUser: ataAddress,
					user: keypair.publicKey,
					systemProgram: SystemProgram.programId,
					tokenProgram: spl.TOKEN_PROGRAM_ID,
					creatorVault: PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), wallet.publicKey.toBytes()], PUMP_PROGRAM)[0],
					eventAuthority: eventAuthority,
					program: PUMP_PROGRAM,
				})
				.instruction();

			instructionsForChunk.push(createTokenAta, buyIx);
		}

		const message = new TransactionMessage({
			payerKey: payer.publicKey,
			recentBlockhash: blockhash,
			instructions: instructionsForChunk,
		}).compileToV0Message([lut]);

		const versionedTx = new VersionedTransaction(message);

		console.log("Txn size:", versionedTx.serialize().length);
		if (versionedTx.serialize().length > 1232) {
			console.log("tx too big");
		}

		// Sign with the keypairs for this chunk
		for (const kp of chunk) {
			if (kp.publicKey.toString() in keyInfo) {
				versionedTx.sign([kp]);
			}
		}

		versionedTx.sign([payer]);
		txsSigned.push(versionedTx);
	}

	return txsSigned;
}

export async function buyBundle() {
	const provider = new anchor.AnchorProvider(new anchor.web3.Connection(rpc), new anchor.Wallet(wallet), { commitment: "confirmed" });

	// Load the NEW IDL format directly (no conversion needed with latest Anchor)
	const IDL_PumpFun = JSON.parse(fs.readFileSync("./pumpfun-IDL.json", "utf-8"));
	const program = new anchor.Program(IDL_PumpFun as anchor.Idl, PUMP_PROGRAM, provider);

	let keyInfo: { [key: string]: any } = {};
	if (fs.existsSync(keyInfoPath)) {
		const existingData = fs.readFileSync(keyInfoPath, "utf-8");
		keyInfo = JSON.parse(existingData);
	}

	const lut = new PublicKey(keyInfo.addressLUT.toString());
	const lookupTableAccount = (await connection.getAddressLookupTable(lut)).value;

	if (lookupTableAccount == null) {
		console.log("Lookup table account not found!");
		process.exit(0);
	}

	// -------- step 1: ask necessary questions for pool build --------
	const name = prompt("Name of your token: ");
	const symbol = prompt("Symbol of your token: ");
	const description = prompt("Description of your token: ");
	const twitter = prompt("Twitter of your token: ");
	const telegram = prompt("Telegram of your token: ");
	const website = prompt("Website of your token: ");
	const tipAmt = +prompt("Jito tip in SOL: ") * LAMPORTS_PER_SOL;

	// -------- step 2: upload metadata --------
	console.log("\n=== UPLOADING METADATA ===");
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
		console.log("✅ Metadata uploaded successfully");
		console.log("Metadata URI: ", metadata_uri);
	} catch (error) {
		console.error("❌ Error uploading metadata:", error);
		return;
	}

	// -------- step 3: use existing mint --------
	console.log("\n=== USING MINT FROM KEYINFO ===");
	
	if (!keyInfo.mintPk) {
		console.log("❌ No mint found in keyInfo. Please run 'Extend LUT Bundle' first.");
		return;
	}
	
	const mintKp = Keypair.fromSecretKey(Uint8Array.from(bs58.decode(keyInfo.mintPk)));
	console.log(`Using mint: ${mintKp.publicKey.toBase58()}`);

	// -------- step 4: create the token with Anchor (WITH creator parameter) --------
	console.log("\n=== CREATING TOKEN WITH ANCHOR ===");
	
	const [bondingCurve] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mintKp.publicKey.toBytes()], PUMP_PROGRAM);
	const [metadata] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL_TOKEN_METADATA_PROGRAM_ID.toBytes(), mintKp.publicKey.toBytes()], MPL_TOKEN_METADATA_PROGRAM_ID);
	const [associatedBondingCurve] = PublicKey.findProgramAddressSync([bondingCurve.toBytes(), spl.TOKEN_PROGRAM_ID.toBytes(), mintKp.publicKey.toBytes()], spl.ASSOCIATED_TOKEN_PROGRAM_ID);

	const createIx = await (program.methods as any)
		.create(name, symbol, metadata_uri, wallet.publicKey) // ✅ WITH creator parameter
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

	// Get the associated token address for dev wallet
	const ata = spl.getAssociatedTokenAddressSync(mintKp.publicKey, wallet.publicKey);
	const ataIx = spl.createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, ata, wallet.publicKey, mintKp.publicKey);

	// Extract tokenAmount from keyInfo for dev wallet
	const keypairInfo = keyInfo[wallet.publicKey.toString()];
	if (!keypairInfo) {
		console.log(`❌ No key info found for dev wallet: ${wallet.publicKey.toString()}`);
		console.log("Please run the simulation first to set buy amounts.");
		return;
	}

	// Calculate SOL amount based on tokenAmount for dev wallet
	const amount = new BN(keypairInfo.tokenAmount);
	const solAmount = new BN(100000 * keypairInfo.solAmount * LAMPORTS_PER_SOL);

	console.log(`Dev wallet buying ${amount.toString()} tokens for ${solAmount.toNumber() / LAMPORTS_PER_SOL} SOL`);

	const buyIx = await (program.methods as any)
		.buy(amount, solAmount)
		.accounts({
			global: globalAccount,
			feeRecipient: feeRecipient,
			mint: mintKp.publicKey,
			bondingCurve: bondingCurve,
			associatedBondingCurve: associatedBondingCurve,
			associatedUser: ata,
			user: wallet.publicKey,
			systemProgram: SystemProgram.programId,
			tokenProgram: spl.TOKEN_PROGRAM_ID,
			creatorVault: PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), wallet.publicKey.toBytes()], PUMP_PROGRAM)[0],
			eventAuthority: eventAuthority,
			program: PUMP_PROGRAM,
		})
		.instruction();

	const tipIxn = SystemProgram.transfer({
		fromPubkey: wallet.publicKey,
		toPubkey: getRandomTipAccount(),
		lamports: BigInt(tipAmt),
	});

	const initIxs: TransactionInstruction[] = [createIx, ataIx, buyIx, tipIxn];

	const { blockhash } = await connection.getLatestBlockhash();

	const messageV0 = new TransactionMessage({
		payerKey: wallet.publicKey,
		instructions: initIxs,
		recentBlockhash: blockhash,
	}).compileToV0Message();

	const fullTX = new VersionedTransaction(messageV0);
	fullTX.sign([wallet, mintKp]);

	console.log("\n=== SIMULATING CREATE + DEV BUY TRANSACTION ===");
	try {
		const simulationResult = await connection.simulateTransaction(fullTX, { 
			commitment: "processed",
			sigVerify: false
		});

		if (simulationResult.value.err) {
			console.error("❌ Create transaction simulation error:", simulationResult.value.err);
			console.log("Logs:");
			const logs = simulationResult.value.logs || [];
			logs.forEach((log, i) => console.log(`  ${i}: ${log}`));
			return;
		} else {
			console.log("✅ Create transaction simulation success!");
		}
	} catch (error) {
		console.error("❌ Error during create transaction simulation:", error);
		return;
	}

	const bundledTxns: VersionedTransaction[] = [fullTX];

	// -------- step 5: create wallet swap transactions --------
	console.log("\n=== CREATING WALLET BUY TRANSACTIONS ===");
	const txMainSwaps: VersionedTransaction[] = await createWalletSwaps(program, blockhash, loadKeypairs(), lookupTableAccount, mintKp.publicKey);
	bundledTxns.push(...txMainSwaps);

	// -------- step 6: send bundle --------
	console.log(`\n=== SENDING BUNDLE WITH ${bundledTxns.length} TRANSACTIONS ===`);
	await sendBundle(bundledTxns);
}

export async function sendBundle(bundledTxns: VersionedTransaction[]) {
	if (bundledTxns.length === 0) {
		console.log("No transactions to send in bundle");
		return;
	}

	if (bundledTxns.length > 5) {
		console.log(`❌ Bundle has ${bundledTxns.length} transactions, max is 5!`);
		return;
	}

	try {
		const bundleId = await searcherClient.sendBundle(new JitoBundle(bundledTxns, bundledTxns.length));
		console.log(`✅ Bundle ${bundleId} sent successfully!`);

		// Listen for bundle result with timeout
		const result = await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error("Bundle result timeout"));
			}, 30000);

			searcherClient.onBundleResult(
				(result) => {
					clearTimeout(timeout);
					console.log("Bundle result received:", result);
					resolve(result);
				},
				(e: Error) => {
					clearTimeout(timeout);
					console.error("Error receiving bundle result:", e);
					reject(e);
				}
			);
		});

		console.log("Final result:", result);
	} catch (error) {
		const err = error as any;
		console.error("❌ Error sending bundle:", err.message);

		if (err?.message?.includes("Bundle Dropped, no connected leader up soon")) {
			console.error("Bundle dropped - no connected leader up soon.");
		} else if (err?.message?.includes("exceeded maximum number of transactions")) {
			console.error("Bundle size exceeded maximum limit.");
		} else if (err?.message?.includes("Bundles must write lock at least one tip account")) {
			console.error("Bundle missing required tip account.");
		} else {
			console.error("An unexpected error occurred:", err.message);
		}
	}
}