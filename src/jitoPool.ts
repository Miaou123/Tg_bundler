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

	// -------- step 3: derive deterministic mint address --------
	// Use existing mint from keyInfo if available, otherwise derive new one
	let mintKp: Keypair;
	if (keyInfo.mintPk) {
		mintKp = Keypair.fromSecretKey(Uint8Array.from(bs58.decode(keyInfo.mintPk)));
		console.log(`Using existing mint: ${mintKp.publicKey.toBase58()}`);
	} else {
		// For Pump.Fun, we can use a deterministic approach or generate new one
		// Using the existing approach from keyInfo generation
		mintKp = Keypair.generate();
		console.log(`Generated new mint: ${mintKp.publicKey.toBase58()}`);
		
		// Save to keyInfo for consistency
		keyInfo.mint = mintKp.publicKey.toString();
		keyInfo.mintPk = bs58.encode(mintKp.secretKey);
		fs.writeFileSync(keyInfoPath, JSON.stringify(keyInfo, null, 2));
	}

	// -------- step 4: derive all program addresses --------
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
	console.log("Mint:", mintKp.publicKey.toString());
	console.log("Bonding Curve:", bondingCurve.toString());
	console.log("Metadata:", metadata.toString());
	console.log("Associated Bonding Curve:", associatedBondingCurve.toString());

	// -------- step 5: build single bundle with limited transactions --------
	const bundledTxns: VersionedTransaction[] = [];
	const allInstructions: TransactionInstruction[] = [];

	// Create token instruction
	const createIx = await program.methods
		.create(name, symbol, metadata_uri)
		.accounts({
			mint: mintKp.publicKey,
			mintAuthority: mintAuthority,
			bondingCurve: bondingCurve,
			associatedBondingCurve: associatedBondingCurve,
			global: global,
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

	allInstructions.push(createIx);

	// Dev wallet buy
	const devKeypairInfo = keyInfo[wallet.publicKey.toString()];
	if (devKeypairInfo) {
		const devAta = spl.getAssociatedTokenAddressSync(mintKp.publicKey, wallet.publicKey);
		const devAtaIx = spl.createAssociatedTokenAccountIdempotentInstruction(
			wallet.publicKey, devAta, wallet.publicKey, mintKp.publicKey
		);
		
		const devAmount = new BN(devKeypairInfo.tokenAmount);
		const devSolAmount = new BN(devKeypairInfo.solAmount * LAMPORTS_PER_SOL);

		const devBuyIx = await program.methods
			.buy(devAmount, devSolAmount)
			.accounts({
				global: global,
				feeRecipient: feeRecipient,
				mint: mintKp.publicKey,
				bondingCurve: bondingCurve,
				associatedBondingCurve: associatedBondingCurve,
				associatedUser: devAta,
				user: wallet.publicKey,
				systemProgram: SystemProgram.programId,
				tokenProgram: spl.TOKEN_PROGRAM_ID,
				rent: SYSVAR_RENT_PUBKEY,
				eventAuthority: eventAuthority,
				program: PUMP_PROGRAM,
			})
			.instruction();

		allInstructions.push(devAtaIx, devBuyIx);
		console.log(`Added dev buy: ${devKeypairInfo.solAmount} SOL`);
	}

	// Add limited number of sub-wallet buys to stay under 5-transaction limit
	const keypairs = loadKeypairs();
	const maxWallets = 1; // Conservative: 1 create + 1 dev_ata + 1 dev_buy + 1 wallet_buy + 1 tip = 5 transactions
	
	for (let i = 0; i < Math.min(maxWallets, keypairs.length); i++) {
		const keypair = keypairs[i];
		const keypairInfo = keyInfo[keypair.publicKey.toString()];
		
		if (!keypairInfo) {
			console.log(`No key info found for keypair: ${keypair.publicKey.toString()}`);
			continue;
		}

		const ataAddress = spl.getAssociatedTokenAddressSync(mintKp.publicKey, keypair.publicKey);
		const createTokenAta = spl.createAssociatedTokenAccountIdempotentInstruction(
			payer.publicKey, ataAddress, keypair.publicKey, mintKp.publicKey
		);

		const amount = new BN(keypairInfo.tokenAmount);
		const solAmount = new BN(keypairInfo.solAmount * LAMPORTS_PER_SOL);

		const buyIx = await program.methods
			.buy(amount, solAmount)
			.accounts({
				global: global,
				feeRecipient: feeRecipient,
				mint: mintKp.publicKey,
				bondingCurve: bondingCurve,
				associatedBondingCurve: associatedBondingCurve,
				associatedUser: ataAddress,
				user: keypair.publicKey,
				systemProgram: SystemProgram.programId,
				tokenProgram: spl.TOKEN_PROGRAM_ID,
				rent: SYSVAR_RENT_PUBKEY,
				eventAuthority: eventAuthority,
				program: PUMP_PROGRAM,
			})
			.instruction();

		allInstructions.push(createTokenAta, buyIx);
		console.log(`Added wallet ${i + 1} buy: ${keypairInfo.solAmount} SOL`);
	}

	// Add Jito tip
	const tipIxn = SystemProgram.transfer({
		fromPubkey: wallet.publicKey,
		toPubkey: getRandomTipAccount(),
		lamports: BigInt(tipAmt),
	});
	allInstructions.push(tipIxn);

	console.log(`\nTotal instructions: ${allInstructions.length}`);
	console.log("Instruction breakdown:");
	console.log("1. Create token");
	if (devKeypairInfo) {
		console.log("2. Dev ATA creation");
		console.log("3. Dev buy");
	}
	console.log(`${allInstructions.length - 1}. Wallet transactions`);
	console.log(`${allInstructions.length}. Jito tip`);

	if (allInstructions.length > 25) {
		console.log("⚠️  Warning: Too many instructions, may exceed transaction size limit");
		console.log("Consider reducing the number of wallets");
	}

	// -------- step 6: create single transaction --------
	const { blockhash } = await connection.getLatestBlockhash();

	const messageV0 = new TransactionMessage({
		payerKey: wallet.publicKey,
		instructions: allInstructions,
		recentBlockhash: blockhash,
	}).compileToV0Message([lookupTableAccount]);

	const fullTX = new VersionedTransaction(messageV0);
	
	// Sign with all required signers
	const signers = [wallet, mintKp];
	for (let i = 0; i < Math.min(maxWallets, keypairs.length); i++) {
		const keypair = keypairs[i];
		if (keyInfo[keypair.publicKey.toString()]) {
			signers.push(keypair);
		}
	}
	
	fullTX.sign(signers);

	// Check transaction size
	const serializedTx = fullTX.serialize();
	console.log(`\nTransaction size: ${serializedTx.length} bytes`);
	if (serializedTx.length > 1232) {
		console.log("❌ Transaction too large! Reduce number of wallets.");
		return;
	}

	bundledTxns.push(fullTX);

	// -------- step 7: simulate and send single bundle --------
	console.log("\n=== SIMULATING TRANSACTION ===");
	try {
		const simulationResult = await connection.simulateTransaction(fullTX, { commitment: "processed" });

		if (simulationResult.value.err) {
			console.error("❌ Simulation error:", simulationResult.value.err);
			console.log("Logs:", simulationResult.value.logs);
			return;
		} else {
			console.log("✅ Simulation success!");
		}
	} catch (error) {
		console.error("❌ Error during simulation:", error);
		return;
	}

	console.log(`\nSending single bundle with ${bundledTxns.length} transaction...`);
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
		console.log(`Bundle ${bundleId} sent.`);

		// Listen for bundle result with timeout
		const result = await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error("Bundle result timeout"));
			}, 30000);

			searcherClient.onBundleResult(
				(result) => {
					clearTimeout(timeout);
					console.log("Received bundle result:", result);
					resolve(result);
				},
				(e: Error) => {
					clearTimeout(timeout);
					console.error("Error receiving bundle result:", e);
					reject(e);
				}
			);
		});

		console.log("Result:", result);
	} catch (error) {
		const err = error as any;
		console.error("Error sending bundle:", err.message);

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