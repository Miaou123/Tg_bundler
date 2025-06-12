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
  import path from 'path';
  import { connection, payer, PUMP_PROGRAM } from '../shared/config';
  import { searcherClient } from "../clients/jito";
  import { Bundle as JitoBundle } from 'jito-ts/dist/sdk/block-engine/types.js';
  import { getRandomTipAccount } from "../clients/config";
  import { lookupTableProvider } from "../clients/LookupTableProvider";
  import { loadUserKeypairs } from './keys';
  import * as spl from '@solana/spl-token';
  import bs58 from 'bs58';
  import { loadUserPoolInfo, saveUserPoolInfo, getUserKeyInfoPath } from '../shared/utils';
  
  /**
   * Create user-specific metadata file
   * @param userId User ID
   * @param mintAddress Mint address
   */
  function createUserMetadataFile(userId: number, mintAddress: string): void {
    const metadataPath = path.join(path.dirname(getUserKeyInfoPath(userId)), `metadata_${userId}_${mintAddress.slice(0, 8)}.json`);
    
    const emptyMetadata = {
      name: "",
      symbol: "", 
      description: "",
      image: "",
      showName: true,
      twitter: "",
      telegram: "", 
      website: ""
    };
    
    fs.writeFileSync(metadataPath, JSON.stringify(emptyMetadata, null, 2));
    console.log(`📄 Created metadata file: ${metadataPath}`);
  }

  /**
   * Create a new user-specific Lookup Table
   * @param userId Telegram user ID
   * @param jitoTipAmount Jito tip amount in SOL
   * @returns Promise<void>
   */
  export async function createUserLUT(userId: number, jitoTipAmount: number = 0.01): Promise<void> {
    const tipAmount = jitoTipAmount * LAMPORTS_PER_SOL;
  
    // Read existing data from user's pool info
    const poolInfo = loadUserPoolInfo(userId);
  
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
  
    // Append new LUT info to user's pool info
    poolInfo.addressLUT = lut.toString();
    poolInfo.lutCreatedAt = new Date().toISOString();
  
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
  
    // Write updated content back to user's pool info
    saveUserPoolInfo(userId, poolInfo);
  
    // Push to bundle
    bundledTxns.push(createLUT);
  
    // -------- step 3: SEND BUNDLE --------
    await sendBundle(bundledTxns);
  }
  
  /**
   * Extend a user-specific Lookup Table with wallet addresses and token-related accounts
   * @param userId Telegram user ID
   * @param jitoTipAmount Jito tip amount in SOL (optional)
   * @param vanityPK Vanity private key (optional)
   * @returns Promise<void>
   */
  export async function extendUserLUT(userId: number, jitoTipAmount?: number, vanityPK?: string | null): Promise<void> {
    // Read existing data from user's pool info
    const poolInfo = loadUserPoolInfo(userId);

    const bundledTxns1: VersionedTransaction[] = [];

    // -------- step 2: get all LUT addresses --------
    const accounts: PublicKey[] = []; // Array with all new keys to push to the new LUT
    
    if (!poolInfo.addressLUT) {
      throw new Error("No LUT address found in pool info. Please create LUT first.");
    }
    
    const lut = new PublicKey(poolInfo.addressLUT.toString());

    // -------- FIXED: Use exact same approach as old working code --------
    const lookupTableAccount = (
        await connection.getAddressLookupTable(lut)
    ).value;

    if (lookupTableAccount == null) {
        throw new Error("Lookup table account not found!");
    }

    // -------- step 3: handle vanity address if provided --------
    let mintKp: Keypair;
    if (vanityPK) {
        console.log("Using vanity address");
        const decodedPrivateKey = bs58.decode(vanityPK);
        mintKp = Keypair.fromSecretKey(decodedPrivateKey);
    } else {
        console.log("No vanity, using random address");
        mintKp = Keypair.generate();
    }

    // Write mint info to json
    console.log(`Mint: ${mintKp.publicKey.toString()}`);
    poolInfo.mint = mintKp.publicKey.toString();
    poolInfo.mintPk = bs58.encode(mintKp.secretKey);
    saveUserPoolInfo(userId, poolInfo);

    // Create empty metadata file for this user and mint
    createUserMetadataFile(userId, mintKp.publicKey.toString());

    // -------- step 4: get all related addresses (EXACT SAME AS OLD CODE) --------
    
    // Define constants exactly like old code
    const mintAuthority = new PublicKey("TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM");
    const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
    const global = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
    
    // Use manual PDA derivation instead of program.programId (EXACT SAME AS OLD CODE)
    const [bondingCurve] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding-curve"), mintKp.publicKey.toBuffer()],
        PUMP_PROGRAM
    );
    
    const [metadata] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          mintKp.publicKey.toBuffer(),
        ],
        MPL_TOKEN_METADATA_PROGRAM_ID,
    );
    
    const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
        [
          bondingCurve.toBuffer(),
          spl.TOKEN_PROGRAM_ID.toBuffer(),
          mintKp.publicKey.toBuffer(),
        ],
        spl.ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    
    const eventAuthority = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");
    const feeRecipient = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");

    // EXACT SAME ORDER AND ACCOUNTS AS OLD CODE
    accounts.push(
        spl.ASSOCIATED_TOKEN_PROGRAM_ID,
        spl.TOKEN_PROGRAM_ID,
        MPL_TOKEN_METADATA_PROGRAM_ID,
        mintAuthority,
        global,
        PUMP_PROGRAM,
        metadata,                    // This was missing in new code!
        associatedBondingCurve,
        bondingCurve,
        eventAuthority,
        SystemProgram.programId,
        SYSVAR_RENT_PUBKEY,
        mintKp.publicKey,
        feeRecipient,
    );

    // Loop through each keypair and push its pubkey and ATAs to the accounts array
    const keypairs = loadUserKeypairs(userId);
    for (const keypair of keypairs) {
        const ataToken = await spl.getAssociatedTokenAddress(
            mintKp.publicKey,
            keypair.publicKey,
        );
        accounts.push(keypair.publicKey, ataToken);
    }

    // Push wallet and payer ATAs and pubkey JUST IN CASE (EXACT SAME AS OLD CODE)
    const ataTokenwall = await spl.getAssociatedTokenAddress(
        mintKp.publicKey,
        payer.publicKey,  // Use payer instead of wallet
    );

    const ataTokenpayer = await spl.getAssociatedTokenAddress(
        mintKp.publicKey,
        payer.publicKey,
    );

    // Add just in case (EXACT SAME AS OLD CODE)
    accounts.push(
        payer.publicKey,  // Use payer instead of wallet
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
    
    // Add the jito tip to the last txn (EXACT SAME AS OLD CODE)
    const tipAmount = jitoTipAmount ? jitoTipAmount * LAMPORTS_PER_SOL : 0.01 * LAMPORTS_PER_SOL;
    extendLUTixs4.push(
        SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: getRandomTipAccount(),
            lamports: BigInt(tipAmount),
        })
    );

    // -------- step 6: separate into 4 different bundles to complete all txns --------
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

    // Update user's pool info with extend info
    poolInfo.lutExtendedAt = new Date().toISOString();
    if (vanityPK) {
      poolInfo.vanityMint = mintKp.publicKey.toString();
    } else {
      poolInfo.randomMint = mintKp.publicKey.toString();
    }
    saveUserPoolInfo(userId, poolInfo);
  }
  
  /**
   * Build a versioned transaction (EXACT SAME AS OLD CODE)
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
   * Send a bundle of transactions to Jito (EXACT SAME AS OLD CODE)
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
  
  // Legacy functions for backward compatibility - these now throw errors
  export async function createLUT(): Promise<never> {
    throw new Error('createLUT is deprecated. Use createUserLUT(userId, jitoTipAmount) instead.');
  }
  
  export async function extendLUT(): Promise<never> {
    throw new Error('extendLUT is deprecated. Use extendUserLUT(userId, jitoTipAmount, vanityPK) instead.');
  }