// src/core/simulation.ts

import { PublicKey, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { connection, payer } from '../shared/config';
import { loadUserKeypairs } from './keys';
import { getUserKeyInfoPath } from '../shared/config';
import fs from 'fs';

interface Buy {
  pubkey: PublicKey;
  solAmount: number;
  tokenAmount: BN;
  percentSupply: number;
}

interface GlobalParams {
  initialVirtualTokenReserves: BN;
  initialVirtualSolReserves: BN;
  initialRealTokenReserves: BN;
  tokenTotalSupply: BN;
  feeBasisPoints: BN;
}

/**
 * Fetch current global parameters from Pump.fun
 */
async function fetchCurrentGlobalParams(): Promise<GlobalParams> {
  try {
    const GLOBAL_ACCOUNT = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
    
    const accountInfo = await connection.getAccountInfo(GLOBAL_ACCOUNT);
    if (!accountInfo) {
      throw new Error("Could not fetch global account");
    }
    
    const data = accountInfo.data;
    let offset = 8; // Skip discriminator
    
    // Read fields in order (little endian)
    const initialVirtualTokenReserves = new BN(data.subarray(offset, offset + 8), 'le');
    offset += 8;
    
    const initialVirtualSolReserves = new BN(data.subarray(offset, offset + 8), 'le');
    offset += 8;
    
    const initialRealTokenReserves = new BN(data.subarray(offset, offset + 8), 'le');
    offset += 8;
    
    const tokenTotalSupply = new BN(data.subarray(offset, offset + 8), 'le');
    offset += 8;
    
    const feeBasisPoints = new BN(data.subarray(offset, offset + 8), 'le');
    
    return {
      initialVirtualTokenReserves,
      initialVirtualSolReserves,
      initialRealTokenReserves,
      tokenTotalSupply,
      feeBasisPoints,
    };
  } catch (error) {
    console.error("❌ Failed to fetch global params:", error);
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

/**
 * Simulate buys for a user with sample data
 * This is a simplified version - in a full implementation you'd want user input for each wallet
 * @param userId User ID
 * @returns Promise with simulation results
 */
export async function simulateUserBuys(userId: number): Promise<{buys: Buy[], isValid: boolean}> {
  console.log("\n🎯 BONDING CURVE SIMULATION");
  console.log("============================");
  
  // Fetch current parameters
  const globalParams = await fetchCurrentGlobalParams();
  const keypairs: Keypair[] = loadUserKeypairs(userId);
  const tokenDecimals = 10 ** 6;
  
  // Use live parameters
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

  const buys: Buy[] = [];

  // Sample buy configuration - in a full implementation, this would come from user input
  const sampleBuyConfig: {wallet: number, amount: number}[] = [
    {wallet: 0, amount: 0.5}, // DEV wallet
    {wallet: 1, amount: 0.1},
    {wallet: 2, amount: 0.1},
    {wallet: 3, amount: 0.1},
    {wallet: 4, amount: 0.1},
    // Add more as needed based on number of keypairs
  ];

  // Only simulate for existing keypairs
  const validBuys = sampleBuyConfig.filter(buy => 
    buy.wallet === 0 || buy.wallet - 1 < keypairs.length
  );

  for (const buyData of validBuys) {
    const { wallet: walletIndex, amount: solInputNumber } = buyData;
    
    if (solInputNumber <= 0) continue;

    let keypair: Keypair;
    if (walletIndex === 0) {
      keypair = payer; // DEV wallet
    } else {
      keypair = keypairs[walletIndex - 1];
    }

    // Calculate tokens received using bonding curve
    const solInputLamports = solInputNumber * LAMPORTS_PER_SOL;
    
    // Bonding curve calculation
    const virtualSolReserves = globalParams.initialVirtualSolReserves.toNumber() + initialRealSolReserves;
    const virtualTokenReserves = initialVirtualTokenReserves;
    
    const tokensOut = Math.floor(
      (virtualTokenReserves * solInputLamports) / (virtualSolReserves + solInputLamports)
    );
    
    // Update reserves for next calculation
    initialRealSolReserves += solInputLamports;
    initialVirtualTokenReserves -= tokensOut;
    totalTokensBought += tokensOut;
    
    const percentSupply = (tokensOut / tokenTotalSupply) * 100;
    
    buys.push({
      pubkey: keypair.publicKey,
      solAmount: solInputNumber,
      tokenAmount: new BN(tokensOut),
      percentSupply: percentSupply
    });

    const walletName = walletIndex === 0 ? "DEV" : `W${walletIndex}`;
    console.log(`  ${walletName}: ${solInputNumber} SOL → ${(tokensOut / tokenDecimals).toFixed(2)}M tokens (${percentSupply.toFixed(3)}%)`);
  }

  // Validate simulation
  const finalVirtualTokenReserves = initialVirtualTokenReserves;
  const finalRealTokenReserves = globalParams.initialRealTokenReserves.toNumber();
  
  console.log(`\n📊 SIMULATION SUMMARY:`);
  console.log(`Total SOL Input: ${(initialRealSolReserves / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`Total Tokens Bought: ${(totalTokensBought / tokenDecimals).toFixed(2)}M tokens`);
  console.log(`Final Virtual Token Reserves: ${(finalVirtualTokenReserves / tokenDecimals).toFixed(2)}M`);
  console.log(`Final Real Token Reserves: ${(finalRealTokenReserves / tokenDecimals).toFixed(2)}M`);
  console.log(`Virtual > Real? ${finalVirtualTokenReserves > finalRealTokenReserves ? '✅ VALID' : '❌ INVALID - WILL FAIL!'}`);
  
  const isValid = finalVirtualTokenReserves > finalRealTokenReserves;
  
  if (!isValid) {
    console.log(`\n🚨 CRITICAL ERROR: Your simulation violates Pump.fun constraints!`);
    console.log(`You're buying too many tokens. The CREATE transaction will fail.`);
    console.log(`Please reduce your buy amounts and try again.\n`);
  }

  return { buys, isValid };
}

/**
 * Write buys to user's key info file
 * @param userId User ID
 * @param buys Array of buy configurations
 */
export async function writeBuysToUserFile(userId: number, buys: Buy[]): Promise<void> {
  const keyInfoPath = getUserKeyInfoPath(userId);
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
  if (existingData.lutCreatedAt) buysObj.lutCreatedAt = existingData.lutCreatedAt;

  // Add wallet buy data with validation
  let validBuys = 0;
  buys.forEach(buy => {
    const solAmount = Number(buy.solAmount);
    const tokenAmount = buy.tokenAmount.toString();
    
    // Validate data before saving
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
}