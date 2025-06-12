// src/core/funding.ts

import { 
    PublicKey, 
    SystemProgram, 
    TransactionInstruction, 
    LAMPORTS_PER_SOL, 
    VersionedTransaction, 
    TransactionMessage, 
    Blockhash,
    Keypair 
  } from '@solana/web3.js';
  import fs from 'fs';
  import { connection, payer } from '../shared/config';
  import { searcherClient } from "../clients/jito";
  import { Bundle as JitoBundle } from 'jito-ts/dist/sdk/block-engine/types.js';
  import { getRandomTipAccount } from "../clients/config";
  import { loadUserKeypairs } from './keys';
  import { getUserKeyInfoPath } from '../shared/config';
  
  /**
   * Utility function to chunk arrays
   */
  function chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
  
  /**
   * Send bundle via Jito
   */
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
      throw error;
    }
  }
  
  /**
   * Generate SOL transfer instructions for all keypairs based on simulation data
   * @param userId User ID
   * @param tipAmt Jito tip amount in lamports
   * @param steps Maximum number of wallets to process
   * @returns Array of transfer instructions
   */
  async function generateSOLTransferForKeypairs(userId: number, tipAmt: number, steps: number = 24): Promise<TransactionInstruction[]> {
    const keypairs: Keypair[] = loadUserKeypairs(userId);
    const keyInfoPath = getUserKeyInfoPath(userId);
    const ixs: TransactionInstruction[] = [];
  
    let existingData: any = {};
    if (fs.existsSync(keyInfoPath)) {
      existingData = JSON.parse(fs.readFileSync(keyInfoPath, "utf-8"));
    }
  
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
        // Send solAmount * 1.015 + 0.01 to meet threshold (accounts for fees and buffer)
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
  
    // Add Jito tip
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: getRandomTipAccount(),
        lamports: BigInt(tipAmt),
      })
    );
  
    return ixs;
  }
  
  /**
   * Process SOL transfer instructions into versioned transactions
   * @param ixs Array of transaction instructions
   * @param blockhash Recent blockhash
   * @returns Array of versioned transactions
   */
  async function processInstructionsSOL(ixs: TransactionInstruction[], blockhash: string | Blockhash): Promise<VersionedTransaction[]> {
    const txns: VersionedTransaction[] = [];
    const instructionChunks = chunkArray(ixs, 45); // Chunk to stay under transaction limits
  
    for (let i = 0; i < instructionChunks.length; i++) {
      const versionedTx = await createAndSignVersionedTxWithKeypairs(instructionChunks[i], blockhash);
      txns.push(versionedTx);
    }
  
    return txns;
  }
  
  /**
   * Create and sign versioned transaction with keypairs
   * @param instructionsChunk Chunk of instructions
   * @param blockhash Recent blockhash
   * @returns Signed versioned transaction
   */
  async function createAndSignVersionedTxWithKeypairs(instructionsChunk: TransactionInstruction[], blockhash: Blockhash | string): Promise<VersionedTransaction> {
    // For simple SOL transfers, we don't need LUT
    const message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: instructionsChunk,
    }).compileToV0Message([]);
  
    const versionedTx = new VersionedTransaction(message);
    versionedTx.sign([payer]);
  
    return versionedTx;
  }
  
  /**
   * Send SOL to simulation wallets based on saved buy data
   * @param userId User ID
   * @param jitoTipAmount Jito tip amount in SOL
   */
  export async function sendSimulationSOL(userId: number, jitoTipAmount: number = 0.01): Promise<void> {
    const jitoTipAmt = jitoTipAmount * LAMPORTS_PER_SOL;
  
    const { blockhash } = await connection.getLatestBlockhash();
    const sendTxns: VersionedTransaction[] = [];
  
    const solIxs = await generateSOLTransferForKeypairs(userId, jitoTipAmt);
  
    const solTxns = await processInstructionsSOL(solIxs, blockhash);
    sendTxns.push(...solTxns);
  
    await sendBundle(sendTxns);
  }
  
  /**
   * Reclaim SOL from all wallets back to main wallet
   * @param userId User ID
   * @param jitoTipAmount Jito tip amount in SOL
   */
  export async function reclaimUserSOL(userId: number, jitoTipAmount: number = 0.01): Promise<void> {
    const txsSigned: VersionedTransaction[] = [];
    const keypairs: Keypair[] = loadUserKeypairs(userId);
    const chunkedKeypairs: Keypair[][] = chunkArray(keypairs, 7); // Process in chunks of 7
  
    const TipAmt = jitoTipAmount * LAMPORTS_PER_SOL;
  
    const { blockhash } = await connection.getLatestBlockhash();
  
    // Iterate over each chunk of keypairs
    for (let chunkIndex = 0; chunkIndex < chunkedKeypairs.length; chunkIndex++) {
      const chunk: Keypair[] = chunkedKeypairs[chunkIndex];
      const instructionsForChunk: TransactionInstruction[] = [];
  
      // Iterate over each keypair in the chunk to create transfer instructions
      for (let i = 0; i < chunk.length; i++) {
        const keypair: Keypair = chunk[i];
        console.log(`Processing keypair ${i + 1}/${chunk.length}:`, keypair.publicKey.toString());
  
        try {
          const balance = await connection.getBalance(keypair.publicKey);
          
          if (balance > 0) {
            const sendSOLixs = SystemProgram.transfer({
              fromPubkey: keypair.publicKey,
              toPubkey: payer.publicKey,
              lamports: balance,
            });
  
            instructionsForChunk.push(sendSOLixs);
            console.log(`Added transfer of ${balance / LAMPORTS_PER_SOL} SOL from wallet ${i + 1}`);
          } else {
            console.log(`Wallet ${i + 1} has no balance, skipping.`);
          }
        } catch (error) {
          console.error(`Error processing wallet ${i + 1}:`, error);
          continue;
        }
      }
  
      // Add Jito tip to the last chunk
      if (chunkIndex === chunkedKeypairs.length - 1) {
        const tipSwapIxn = SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: getRandomTipAccount(),
          lamports: BigInt(TipAmt),
        });
        instructionsForChunk.push(tipSwapIxn);
        console.log("Jito tip added :)");
      }
  
      // Skip empty chunks
      if (instructionsForChunk.length === 0) {
        continue;
      }
  
      // Create transaction message
      const message = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions: instructionsForChunk,
      }).compileToV0Message([]);
  
      const versionedTx = new VersionedTransaction(message);
  
      console.log(
        "Signing transaction with chunk signers",
        chunk.map((kp: Keypair) => kp.publicKey.toString())
      );
  
      // Sign with payer first
      versionedTx.sign([payer]);
  
      // Sign with each keypair in the chunk
      for (const keypair of chunk) {
        versionedTx.sign([keypair]);
      }
  
      txsSigned.push(versionedTx);
    }
  
    if (txsSigned.length > 0) {
      await sendBundle(txsSigned);
    } else {
      console.log("No transactions to send - all wallets are empty.");
    }
  }