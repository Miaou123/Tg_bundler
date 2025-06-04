import { connection, rpc, wallet, global as globalAccount, feeRecipient, PUMP_PROGRAM, payer } from "../config";
import { PublicKey, VersionedTransaction, SYSVAR_RENT_PUBKEY, TransactionMessage, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { loadKeypairs } from "./createKeys";
import { searcherClient } from "./clients/jito";
import { Bundle as JitoBundle } from "jito-ts/dist/sdk/block-engine/types.js";
import promptSync from "prompt-sync";
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
	try {
		const bundleId = await searcherClient.sendBundle(new JitoBundle(bundledTxns, bundledTxns.length));
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

export async function sellXPercentagePF() {
	const provider = new anchor.AnchorProvider(new anchor.web3.Connection(rpc), new anchor.Wallet(wallet), { commitment: "confirmed" });

	// Initialize pumpfun anchor with corrected constructor
	const IDL_PumpFun = JSON.parse(fs.readFileSync("./pumpfun-IDL.json", "utf-8"));
	const pfprogram = new anchor.Program(IDL_PumpFun as anchor.Idl, PUMP_PROGRAM, provider);

	// Start selling
	const bundledTxns = [];
	const keypairs = loadKeypairs();

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

	const mintKp = Keypair.fromSecretKey(Uint8Array.from(bs58.decode(poolInfo.mintPk)));

	const [bondingCurve] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mintKp.publicKey.toBytes()], PUMP_PROGRAM);
	let [associatedBondingCurve] = PublicKey.findProgramAddressSync(
		[bondingCurve.toBytes(), spl.TOKEN_PROGRAM_ID.toBytes(), mintKp.publicKey.toBytes()],
		spl.ASSOCIATED_TOKEN_PROGRAM_ID
	);

	const supplyPercent = +prompt("Percentage to sell (Ex. 1 for 1%): ") / 100;
	const jitoTipAmt = +prompt("Jito tip in Sol (Ex. 0.01): ") * LAMPORTS_PER_SOL;

	const mintInfo = await connection.getTokenSupply(mintKp.publicKey);

	let sellTotalAmount = 0;

	const chunkedKeypairs = chunkArray(keypairs, 6);

	// start the selling process
	const PayerTokenATA = await spl.getAssociatedTokenAddress(new PublicKey(poolInfo.mint), payer.publicKey);

	const { blockhash } = await connection.getLatestBlockhash();

	for (let chunkIndex = 0; chunkIndex < chunkedKeypairs.length; chunkIndex++) {
		const chunk = chunkedKeypairs[chunkIndex];
		const instructionsForChunk = [];
		const isFirstChunk = chunkIndex === 0;

		if (isFirstChunk) {
			// Handle the first chunk separately
			const transferAmount = await getSellBalance(wallet, new PublicKey(poolInfo.mint), supplyPercent);
			sellTotalAmount += transferAmount;
			console.log(`Sending ${transferAmount / 1e6} from dev wallet.`);

			const ataIx = spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, PayerTokenATA, payer.publicKey);

			const TokenATA = await spl.getAssociatedTokenAddress(new PublicKey(poolInfo.mint), wallet.publicKey);
			const transferIx = spl.createTransferInstruction(TokenATA, PayerTokenATA, wallet.publicKey, transferAmount);

			instructionsForChunk.push(ataIx, transferIx);
		}

		for (let keypair of chunk) {
			const transferAmount = await getSellBalance(keypair, new PublicKey(poolInfo.mint), supplyPercent);
			sellTotalAmount += transferAmount;
			console.log(`Sending ${transferAmount / 1e6} from ${keypair.publicKey.toString()}.`);

			const TokenATA = await spl.getAssociatedTokenAddress(new PublicKey(poolInfo.mint), keypair.publicKey);
			const transferIx = spl.createTransferInstruction(TokenATA, PayerTokenATA, keypair.publicKey, transferAmount);
			instructionsForChunk.push(transferIx);
		}

		if (instructionsForChunk.length > 0) {
			const message = new TransactionMessage({
				payerKey: payer.publicKey,
				recentBlockhash: blockhash,
				instructions: instructionsForChunk,
			}).compileToV0Message([lookupTableAccount]);

			const versionedTx = new VersionedTransaction(message);

			const serializedMsg = versionedTx.serialize();
			console.log("Txn size:", serializedMsg.length);
			if (serializedMsg.length > 1232) {
				console.log("tx too big");
			}

			versionedTx.sign([payer]);

			for (let keypair of chunk) {
				versionedTx.sign([keypair]);
			}

			bundledTxns.push(versionedTx);
		}
	}

	const payerNum = randomInt(0, 24);
	const payerKey = keypairs[payerNum];

	const sellPayerIxs = [];

	console.log(`TOTAL: Selling ${sellTotalAmount / 1e6}.`);

	if (+mintInfo.value.amount * 0.25 <= sellTotalAmount) {
		console.log("Price impact too high.");
		console.log("Cannot sell more than 25% of supply at a time.");
		return;
	}

	// Create sell instruction with new IDL (includes creatorVault)
	const [creatorVault] = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), wallet.publicKey.toBytes()], PUMP_PROGRAM);

	const sellIx = await (pfprogram.methods as any)
		.sell(new BN(sellTotalAmount), new BN(0))
		.accounts({
			global: globalAccount,
			feeRecipient,
			mint: new PublicKey(poolInfo.mint),
			bondingCurve,
			associatedBondingCurve,
			associatedUser: PayerTokenATA,
			user: payer.publicKey,
			systemProgram: SystemProgram.programId,
			creatorVault: creatorVault, // NEW account from updated IDL
			tokenProgram: spl.TOKEN_PROGRAM_ID,
			eventAuthority: PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], PUMP_PROGRAM)[0],
			program: PUMP_PROGRAM,
		})
		.instruction();

	sellPayerIxs.push(
		sellIx,
		SystemProgram.transfer({
			fromPubkey: payer.publicKey,
			toPubkey: getRandomTipAccount(),
			lamports: BigInt(jitoTipAmt),
		})
	);

	const sellMessage = new TransactionMessage({
		payerKey: payerKey.publicKey,
		recentBlockhash: blockhash,
		instructions: sellPayerIxs,
	}).compileToV0Message([lookupTableAccount]);

	const sellTx = new VersionedTransaction(sellMessage);

	const serializedMsg = sellTx.serialize();
	console.log("Txn size:", serializedMsg.length);
	if (serializedMsg.length > 1232) {
		console.log("tx too big");
	}

	sellTx.sign([payer, payerKey]);

	bundledTxns.push(sellTx);

	await sendBundle(bundledTxns);

	return;
}

async function getSellBalance(keypair: Keypair, mint: PublicKey, supplyPercent: number) {
	let amount;
	try {
		const tokenAccountPubKey = spl.getAssociatedTokenAddressSync(mint, keypair.publicKey);
		const balance = await connection.getTokenAccountBalance(tokenAccountPubKey);
		amount = Math.floor(Number(balance.value.amount) * supplyPercent);
	} catch (e) {
		amount = 0;
	}

	return amount;
}