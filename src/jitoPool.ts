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
import { sha256 } from "@noble/hashes/sha256";

const prompt = promptSync();
const keyInfoPath = path.join(__dirname, "keyInfo.json");

function calculateDiscriminator(instruction: string): Buffer {
    // Use the actual discriminator from working Pump.Fun transactions
    if (instruction === "create") {
        return Buffer.from("114ca4929b2a32b1", "hex");
    }
    // Fallback to standard Anchor calculation for other instructions
    return Buffer.from(sha256(`global:${instruction}`)).slice(0, 8);
}

function createRawCreateInstruction(
    mintKp: Keypair,
    name: string,
    symbol: string,
    metadata_uri: string
): TransactionInstruction {
    
    // Use the correct discriminator format
    const discriminator = calculateDiscriminator("create");
    
    // Serialize arguments using manual Borsh format for strings
    // Borsh string format: 4-byte little-endian length + UTF-8 bytes
    const nameBuffer = Buffer.from(name, 'utf8');
    const nameLen = Buffer.alloc(4);
    nameLen.writeUInt32LE(nameBuffer.length, 0);
    
    const symbolBuffer = Buffer.from(symbol, 'utf8');
    const symbolLen = Buffer.alloc(4);
    symbolLen.writeUInt32LE(symbolBuffer.length, 0);
    
    const uriBuffer = Buffer.from(metadata_uri, 'utf8');
    const uriLen = Buffer.alloc(4);
    uriLen.writeUInt32LE(uriBuffer.length, 0);
    
    // Combine: discriminator + (length + data) for each string in Borsh format
    const data = Buffer.concat([
        discriminator,           // 8 bytes
        nameLen,                // 4 bytes 
        nameBuffer,             // name.length bytes
        symbolLen,              // 4 bytes
        symbolBuffer,           // symbol.length bytes  
        uriLen,                 // 4 bytes
        uriBuffer              // uri.length bytes
    ]);
    
    console.log("Raw instruction Borsh serialization:");
    console.log("  Discriminator:", discriminator.toString('hex'));
    console.log("  Name length:", nameBuffer.length, "bytes");
    console.log("  Symbol length:", symbolBuffer.length, "bytes"); 
    console.log("  URI length:", uriBuffer.length, "bytes");
    console.log("  Total data length:", data.length, "bytes");
    
    // Derive accounts
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
    
    return new TransactionInstruction({
        programId: PUMP_PROGRAM,
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
        data: data,
    });
}

async function testDiscriminator(program: anchor.Program, mintKp: Keypair, name: string, symbol: string, metadata_uri: string) {
    console.log("\n=== TESTING DISCRIMINATOR ===");
    
    // Calculate expected discriminator
    const expectedDiscriminator = calculateDiscriminator("create");
    console.log("Expected create discriminator:", expectedDiscriminator.toString('hex'));
    
    // Check what Anchor generates
    try {
        const [bondingCurve] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mintKp.publicKey.toBytes()], PUMP_PROGRAM);
        const [metadata] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), MPL_TOKEN_METADATA_PROGRAM_ID.toBytes(), mintKp.publicKey.toBytes()], MPL_TOKEN_METADATA_PROGRAM_ID);
        const [associatedBondingCurve] = PublicKey.findProgramAddressSync([bondingCurve.toBytes(), spl.TOKEN_PROGRAM_ID.toBytes(), mintKp.publicKey.toBytes()], spl.ASSOCIATED_TOKEN_PROGRAM_ID);

        const ix = await program.methods
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
        
        const anchorDiscriminator = ix.data.slice(0, 8);
        console.log("Anchor generated discriminator:", anchorDiscriminator.toString('hex'));
        
        // Compare
        if (Buffer.compare(expectedDiscriminator, anchorDiscriminator) === 0) {
            console.log("✅ Discriminators match!");
        } else {
            console.log("❌ Discriminator mismatch!");
            console.log("Expected:", expectedDiscriminator.toString('hex'));
            console.log("Anchor:  ", anchorDiscriminator.toString('hex'));
        }
        
        // Let's also try checking a known working transaction
        console.log("\n=== CHECKING KNOWN WORKING TRANSACTION ===");
        try {
            // This is a known working create transaction signature from the search results
            const workingTxSig = "2nRAKcDF5MsXtvezRaUCNpQMbzSNacbJyxPKdWP2AEpSZMj41QJc7scwyr6aXVfT66q4ZkgHDqFjbBXibwAtatnz";
            const workingTx = await connection.getParsedTransaction(workingTxSig, { maxSupportedTransactionVersion: 0 });
            
            if (workingTx?.transaction.message.instructions) {
                const pumpIx = workingTx.transaction.message.instructions.find(ix => 
                    'programId' in ix && ix.programId.equals(PUMP_PROGRAM)
                );
                
                if (pumpIx && 'data' in pumpIx) {
                    const workingData = Buffer.from(pumpIx.data, 'base64');
                    const workingDiscriminator = workingData.slice(0, 8);
                    console.log("Working transaction discriminator:", workingDiscriminator.toString('hex'));
                    
                    if (Buffer.compare(expectedDiscriminator, workingDiscriminator) === 0) {
                        console.log("✅ Our expected discriminator matches working transaction!");
                    } else {
                        console.log("❌ Our expected discriminator doesn't match working transaction!");
                        console.log("Working:  ", workingDiscriminator.toString('hex'));
                        console.log("Expected: ", expectedDiscriminator.toString('hex'));
                    }
                }
            }
        } catch (err) {
            console.log("Could not fetch working transaction (might be old)");
        }
        
    } catch (error) {
        console.log("❌ Error creating instruction for discriminator test:", error);
    }
}

async function debugCreateInstruction(program: anchor.Program, mintKp: Keypair, name: string, symbol: string, metadata_uri: string) {
	console.log("\n=== DEBUGGING CREATE INSTRUCTION ===");
	
	// Derive all accounts step by step
	const [bondingCurve] = PublicKey.findProgramAddressSync(
		[Buffer.from("bonding-curve"), mintKp.publicKey.toBytes()], 
		PUMP_PROGRAM
	);
	console.log("✓ Bonding Curve:", bondingCurve.toString());

	const [metadata] = PublicKey.findProgramAddressSync(
		[Buffer.from("metadata"), MPL_TOKEN_METADATA_PROGRAM_ID.toBytes(), mintKp.publicKey.toBytes()],
		MPL_TOKEN_METADATA_PROGRAM_ID
	);
	console.log("✓ Metadata:", metadata.toString());

	const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
		[bondingCurve.toBytes(), spl.TOKEN_PROGRAM_ID.toBytes(), mintKp.publicKey.toBytes()],
		spl.ASSOCIATED_TOKEN_PROGRAM_ID
	);
	console.log("✓ Associated Bonding Curve:", associatedBondingCurve.toString());

	// Check if accounts already exist
	console.log("\n=== CHECKING ACCOUNT EXISTENCE ===");
	
	try {
		const mintAccount = await connection.getAccountInfo(mintKp.publicKey);
		if (mintAccount) {
			console.log("❌ Mint already exists:", mintKp.publicKey.toString());
			console.log("   This mint cannot be used for token creation!");
			return null;
		}
		console.log("✓ Mint is new:", mintKp.publicKey.toString());
	} catch (e) {
		console.log("✓ Mint is new:", mintKp.publicKey.toString());
	}

	try {
		const bondingCurveAccount = await connection.getAccountInfo(bondingCurve);
		if (bondingCurveAccount) {
			console.log("❌ Bonding curve already exists!");
			return null;
		}
		console.log("✓ Bonding curve is new");
	} catch (e) {
		console.log("✓ Bonding curve is new");
	}

	try {
		const metadataAccount = await connection.getAccountInfo(metadata);
		if (metadataAccount) {
			console.log("❌ Metadata already exists!");
			return null;
		}
		console.log("✓ Metadata is new");
	} catch (e) {
		console.log("✓ Metadata is new");
	}

	// Check global account
	try {
		const globalAccount = await connection.getAccountInfo(global);
		if (!globalAccount) {
			console.log("❌ Global account does not exist!");
			return null;
		}
		console.log("✓ Global account exists");
	} catch (e) {
		console.log("❌ Error checking global account:", e);
		return null;
	}

	// Verify all constants
	console.log("\n=== VERIFYING CONSTANTS ===");
	console.log("PUMP_PROGRAM:", PUMP_PROGRAM.toString());
	console.log("MPL_TOKEN_METADATA_PROGRAM_ID:", MPL_TOKEN_METADATA_PROGRAM_ID.toString());
	console.log("global:", global.toString());
	console.log("mintAuthority:", mintAuthority.toString());
	console.log("eventAuthority:", eventAuthority.toString());
	console.log("wallet.publicKey:", wallet.publicKey.toString());

	// Create the instruction with detailed logging
	console.log("\n=== CREATING INSTRUCTION ===");
	
	const accountsObject = {
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
	};

	console.log("Accounts object:");
	Object.entries(accountsObject).forEach(([key, value]) => {
		console.log(`  ${key}: ${value.toString()}`);
	});
	console.log("Arguments:", { name, symbol, metadata_uri });

	try {
		const createIx = await program.methods
			.create(name, symbol, metadata_uri)
			.accounts(accountsObject)
			.instruction();
		
		console.log("✅ Instruction created successfully");
		console.log("Instruction keys:");
		createIx.keys.forEach((k, i) => {
			console.log(`  ${i}: ${k.pubkey.toString()} (writable: ${k.isWritable}, signer: ${k.isSigner})`);
		});
		
		return {
			instruction: createIx,
			accounts: {
				bondingCurve,
				metadata,
				associatedBondingCurve
			}
		};
	} catch (error) {
		console.log("❌ Error creating instruction:", error);
		return null;
	}
}

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

	// -------- step 1: ask necessary questions --------
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
		console.log("Metadata URI:", metadata_uri);
	} catch (error) {
		console.error("❌ Error uploading metadata:", error);
		return;
	}

	// -------- step 3: generate fresh mint --------
	console.log("\n=== GENERATING FRESH MINT ===");
	// ALWAYS generate a fresh mint for token creation
	const mintKp = Keypair.generate();
	console.log(`Generated fresh mint: ${mintKp.publicKey.toBase58()}`);
	
	// Save to keyInfo for future reference
	keyInfo.mint = mintKp.publicKey.toString();
	keyInfo.mintPk = bs58.encode(mintKp.secretKey);
	fs.writeFileSync(keyInfoPath, JSON.stringify(keyInfo, null, 2));

	// -------- step 4: debug the create instruction --------
	const debugResult = await debugCreateInstruction(program, mintKp, name, symbol, metadata_uri);
	
	if (!debugResult) {
		console.log("❌ Failed to create instruction, aborting");
		return;
	}

	// -------- step 5: test discriminator --------
	await testDiscriminator(program, mintKp, name, symbol, metadata_uri);

	console.log("\n✅ Debug completed successfully!");
	
	// -------- step 6: test raw instruction approach --------
	console.log("\n=== TESTING RAW INSTRUCTION ===");
	
	const rawInstruction = createRawCreateInstruction(mintKp, name, symbol, metadata_uri);
	console.log("✅ Raw instruction created");
	console.log("Raw instruction data length:", rawInstruction.data.length);
	console.log("Raw instruction discriminator:", rawInstruction.data.slice(0, 8).toString('hex'));

	// Test raw instruction
	const { blockhash } = await connection.getLatestBlockhash();
	
	const rawMessage = new TransactionMessage({
		payerKey: wallet.publicKey,
		instructions: [rawInstruction],
		recentBlockhash: blockhash,
	}).compileToV0Message([lookupTableAccount]);

	const rawTx = new VersionedTransaction(rawMessage);
	rawTx.sign([wallet, mintKp]);

	console.log("\n=== SIMULATING RAW INSTRUCTION ===");
	try {
		const simulationResult = await connection.simulateTransaction(rawTx, { 
			commitment: "processed",
			sigVerify: false
		});

		if (simulationResult.value.err) {
			console.error("❌ Raw instruction simulation error:", simulationResult.value.err);
			console.log("Logs:");
			const logs = simulationResult.value.logs || [];
			logs.forEach((log, i) => console.log(`  ${i}: ${log}`));
		} else {
			console.log("✅ Raw instruction simulation success!");
			console.log("We found the issue! Using raw instruction instead of Anchor.");
			
			// If raw instruction works, use it for the bundle
			const bundledTxns: VersionedTransaction[] = [];
			bundledTxns.push(rawTx);
			
			console.log(`\n=== SENDING RAW INSTRUCTION BUNDLE ===`);
			await sendBundle(bundledTxns);
			return;
		}
	} catch (error) {
		console.error("❌ Error during raw instruction simulation:", error);
	}

	// -------- step 7: if raw doesn't work, try anchor instruction anyway --------
	console.log("\n=== TESTING ANCHOR INSTRUCTION ANYWAY ===");
	const testMessage = new TransactionMessage({
		payerKey: wallet.publicKey,
		instructions: [debugResult.instruction],
		recentBlockhash: blockhash,
	}).compileToV0Message([lookupTableAccount]);

	const testTx = new VersionedTransaction(testMessage);
	testTx.sign([wallet, mintKp]);

	console.log("Test transaction size:", testTx.serialize().length, "bytes");

	console.log("\n=== SIMULATING ANCHOR INSTRUCTION ===");
	try {
		const simulationResult = await connection.simulateTransaction(testTx, { 
			commitment: "processed",
			sigVerify: false
		});

		if (simulationResult.value.err) {
			console.error("❌ Anchor instruction simulation error:", simulationResult.value.err);
			console.log("Logs:");
			const logs = simulationResult.value.logs || [];
			logs.forEach((log, i) => console.log(`  ${i}: ${log}`));
			
			console.log("\n❌ Both raw and Anchor instructions failed. The issue might be:");
			console.log("1. Incorrect program constants");
			console.log("2. Wrong account derivation logic");
			console.log("3. Program state issues");
			console.log("4. RPC/network issues");
			
			return;
		} else {
			console.log("✅ Anchor instruction simulation success!");
		}
	} catch (error) {
		console.error("❌ Error during anchor instruction simulation:", error);
		return;
	}

	// If we get here, create the full bundle
	console.log("\n=== CREATING FULL BUNDLE ===");
	// Continue with the rest of the bundle creation logic...
	// (rest of your bundle creation code would go here)
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