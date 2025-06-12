import { 
  AddressLookupTableProgram, 
  Keypair, 
  PublicKey, 
  VersionedTransaction, 
  TransactionMessage, 
  TransactionInstruction, 
  SystemProgram, 
  LAMPORTS_PER_SOL, 
  Blockhash, 
  AddressLookupTableAccount, 
  SYSVAR_RENT_PUBKEY 
} from '@solana/web3.js';
import fs from 'fs';
import { connection, payer, PUMP_PROGRAM, KEY_INFO_PATH } from '../shared/config';
import { searcherClient } from "../clients/jito";
import { Bundle as JitoBundle } from 'jito-ts/dist/sdk/block-engine/types.js';
import { getRandomTipAccount } from "../clients/config";
import { lookupTableProvider } from "../clients/LookupTableProvider";
import { loadKeypairs } from './keys';
import * as spl from '@solana/spl-token';
import bs58 from 'bs58';
import { loadPoolInfo, savePoolInfo } from '../shared/utils';

/**
 * Extend a Lookup Table with wallet addresses and token-related accounts
 * @returns Promise<void>
 */
export async function extendLUT(vanityPK?: string | null, jitoTipAmt?: number): Promise<void> {
  // -------- step 1: ask nessesary questions for LUT build --------
  // These would be provided by the UI, but we'll use parameters for now
  
  // Read existing data from poolInfo.json
  const poolInfo = loadPoolInfo();

  const bundledTxns1: VersionedTransaction[] = [];

  // -------- step 2: get all LUT addresses --------
  const accounts: PublicKey[] = []; // Array with all new keys to push to the new LUT
  
  if (!poolInfo.addressLUT) {
    throw new Error("No LUT address found in pool info");
  }
  
  const lut = new PublicKey(poolInfo.addressLUT.toString());

  const lookupTableAccount = (
      await connection.getAddressLookupTable(lut)
  ).value;

  if (lookupTableAccount == null) {
      console.log("Lookup table account not found!");
      return;
  }

  // Write mint info to json
  let mintKp;

  if (!vanityPK) {
      mintKp = Keypair.generate();
  } else {
      mintKp = Keypair.fromSecretKey(bs58.decode(vanityPK));
  }

  console.log(`Mint: ${mintKp.publicKey.toString()}`);
  poolInfo.mint = mintKp.publicKey.toString();
  poolInfo.mintPk = bs58.encode(mintKp.secretKey);
  savePoolInfo(poolInfo);  

  // Fetch accounts for LUT
  const mintAuthority = new PublicKey(
      "TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM",
  );
  const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey(
      "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
  );
  const global = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
  
  // Use manual PDA derivation instead of program.programId
  const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mintKp.publicKey.toBytes()],
      PUMP_PROGRAM, // Use the imported constant directly
  );
  const [metadata] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        MPL_TOKEN_METADATA_PROGRAM_ID.toBytes(),
        mintKp.publicKey.toBytes(),
      ],
      MPL_TOKEN_METADATA_PROGRAM_ID,
  );
  let [associatedBondingCurve] = PublicKey.findProgramAddressSync(
      [
        bondingCurve.toBytes(),
        spl.TOKEN_PROGRAM_ID.toBytes(),
        mintKp.publicKey.toBytes(),
      ],
      spl.ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const eventAuthority = new PublicKey(
      "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1",
  );
  const feeRecipient = new PublicKey(
      "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM",
  );

  // These values vary based on the new market created
  accounts.push(
      spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      spl.TOKEN_PROGRAM_ID,
      MPL_TOKEN_METADATA_PROGRAM_ID,
      mintAuthority,
      global,
      PUMP_PROGRAM, // Use the imported constant
      metadata,
      associatedBondingCurve,
      bondingCurve,
      eventAuthority,
      SystemProgram.programId,
      SYSVAR_RENT_PUBKEY,
      mintKp.publicKey,
      feeRecipient,
  );   // DO NOT ADD PROGRAM OR JITO TIP ACCOUNT??

  // Loop through each keypair and push its pubkey and ATAs to the accounts array
  const keypairs = loadKeypairs();
  for (const keypair of keypairs) {
      const ataToken = await spl.getAssociatedTokenAddress(
          mintKp.publicKey,
          keypair.publicKey,
      );
      accounts.push(keypair.publicKey, ataToken);
  }

  // Push wallet and payer ATAs and pubkey JUST IN CASE (not sure tbh)
  const ataTokenwall = await spl.getAssociatedTokenAddress(
      mintKp.publicKey,
      payer.publicKey,
  );

  const ataTokenpayer = await spl.getAssociatedTokenAddress(
      mintKp.publicKey,
      payer.publicKey,
  );

  // Add just in case
  accounts.push(
      payer.publicKey, // Using payer instead of wallet for consistency
      payer.publicKey,
      ataTokenwall,
      ataTokenpayer,
      lut, 
      spl.NATIVE_MINT, 
  );

  // -------- step 5: push LUT addresses to a txn --------
  const extendLUTixs1: TransactionInstruction[] = [];
  const extendLUTixs2: TransactionInstruction[] = [];
  const extendLUTixs3: TransactionInstruction[] = [];
  const extendLUTixs4: TransactionInstruction[] = [];

  // Chunk accounts array into groups of 30
  const accountChunks = Array.from({ length: Math.ceil(accounts.length / 30) }, (v, i) => accounts.slice(i * 30, (i + 1) * 30));
  console.log("Num of chunks:", accountChunks.length);
  console.log("Num of accounts:", accounts.length);

  for (let i = 0; i < accountChunks.length; i++) {
      const chunk = accountChunks[i];
      const extendInstruction = AddressLookupTableProgram.extendLookupTable({
          lookupTable: lut,
          authority: payer.publicKey,
          payer: payer.publicKey,
          addresses: chunk,
      });
      if (i == 0) {
          extendLUTixs1.push(extendInstruction);
          console.log("Chunk:", i);
      } else if (i == 1) {
          extendLUTixs2.push(extendInstruction);
          console.log("Chunk:", i);
      } else if (i == 2) {
          extendLUTixs3.push(extendInstruction);
          console.log("Chunk:", i);
      } else if (i == 3) {
          extendLUTixs4.push(extendInstruction);
          console.log("Chunk:", i);
      }
  }
  
  // Add the jito tip to the last txn
  if (jitoTipAmt) {
    extendLUTixs4.push(
      SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: getRandomTipAccount(),
          lamports: BigInt(jitoTipAmt),
      })
    );
  } else {
    const defaultTipAmount = 0.01 * LAMPORTS_PER_SOL;
    extendLUTixs4.push(
      SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: getRandomTipAccount(),
          lamports: BigInt(defaultTipAmount),
      })
    );
  }

  // -------- step 6: seperate into 2 different bundles to complete all txns --------
  const { blockhash: block1 } = await connection.getLatestBlockhash();

  const extend1 = await buildTxn(extendLUTixs1, block1, lookupTableAccount);
  const extend2 = await buildTxn(extendLUTixs2, block1, lookupTableAccount);
  const extend3 = await buildTxn(extendLUTixs3, block1, lookupTableAccount);
  const extend4 = await buildTxn(extendLUTixs4, block1, lookupTableAccount);

  bundledTxns1.push(
      extend1,
      extend2,
      extend3,
      extend4,
  );

  // -------- step 7: send bundle --------
  await sendBundle(bundledTxns1);
}

/**
 * Create a new Lookup Table
 * @returns Promise<void>
 */
export async function createLUT(jitoTipAmt?: number): Promise<void> {
  // Use provided tip amount or default to 0.01 SOL
  const tipAmount = jitoTipAmt || 0.01 * LAMPORTS_PER_SOL;

  // Read existing data from poolInfo.json
  const poolInfo = loadPoolInfo();

  const bundledTxns: VersionedTransaction[] = [];

  // -------- step 2: create a new LUT every time there is a new launch --------
  const createLUTixs: TransactionInstruction[] = [];

  const [ create, lut ] = AddressLookupTableProgram.createLookupTable({
      authority: payer.publicKey,
      payer: payer.publicKey,
      recentSlot: await connection.getSlot("finalized")
  });

  createLUTixs.push(
      create,
      SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: getRandomTipAccount(),
          lamports: BigInt(tipAmount),
      }),
  );

  const addressesMain: PublicKey[] = [];
  createLUTixs.forEach((ixn) => {
      ixn.keys.forEach((key) => {
          addressesMain.push(key.pubkey);
      });
  });

  const lookupTablesMain1 =
      lookupTableProvider.computeIdealLookupTablesForAddresses(addressesMain);

  const { blockhash } = await connection.getLatestBlockhash();

  const messageMain1 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: createLUTixs,
  }).compileToV0Message(lookupTablesMain1);
  const createLUT = new VersionedTransaction(messageMain1);

  // Append new LUT info
  poolInfo.addressLUT = lut.toString(); // Using 'addressLUT' as the field name

  try {
      const serializedMsg = createLUT.serialize();
      console.log('Txn size:', serializedMsg.length);
      if (serializedMsg.length > 1232) {
          console.log('tx too big');
      }
      createLUT.sign([payer]);
  } catch (e) {
      console.log(e, 'error signing createLUT');
      return;
  }

  // Write updated content back to poolInfo.json
  savePoolInfo(poolInfo);

  // Push to bundle
  bundledTxns.push(createLUT);

  // -------- step 3: SEND BUNDLE --------
  await sendBundle(bundledTxns);
}

/**
 * Build a versioned transaction
 * @param extendLUTixs Instructions to include in the transaction
 * @param blockhash Recent blockhash
 * @param lut Lookup table account
 * @returns Signed versioned transaction
 */
async function buildTxn(extendLUTixs: TransactionInstruction[], blockhash: string | Blockhash, lut: AddressLookupTableAccount): Promise<VersionedTransaction> {
  const messageMain = new TransactionMessage({
          payerKey: payer.publicKey,
          recentBlockhash: blockhash,
          instructions: extendLUTixs,
      }).compileToV0Message([lut]);
      const txn = new VersionedTransaction(messageMain);
  
      try {
          const serializedMsg = txn.serialize();
          console.log('Txn size:', serializedMsg.length);
          if (serializedMsg.length > 1232) {
              console.log('tx too big');
          }
          txn.sign([payer]);
      } catch (e) {
          const serializedMsg = txn.serialize();
          console.log('txn size:', serializedMsg.length);
          console.log(e, 'error signing extendLUT');
          throw e;
      }
      return txn;
}

/**
 * Send a bundle of transactions to Jito
 * @param bundledTxns Transactions to send
 * @returns Promise<string | null> Bundle ID or null if failed
 */
export async function sendBundle(bundledTxns: VersionedTransaction[]): Promise<string | null> {
  try {
      if (!searcherClient) {
        throw new Error("Searcher client is not initialized");
      }
      const bundleId = await searcherClient.sendBundle(new JitoBundle(bundledTxns, bundledTxns.length));
      console.log(`Bundle ${bundleId} sent.`);
      return bundleId.toString();
  } catch (error) {
      const err = error as any;
      console.error("Error sending bundle:", err.message);
  
      if (err?.message?.includes('Bundle Dropped, no connected leader up soon')) {
          console.error("Error sending bundle: Bundle Dropped, no connected leader up soon.");
      } else {
          console.error("An unexpected error occurred:", err.message);
      }
      return null;
  }
}