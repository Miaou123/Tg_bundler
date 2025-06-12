import fs from 'fs';
import path from 'path';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { KEY_INFO_PATH, connection } from './config';
import { PoolInfo } from './types';

/**
 * Escapes special characters for Markdown V2 format
 * @param text Text to escape
 * @returns Escaped text
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

/**
 * Splits a message into chunks respecting the Telegram message size limit
 * @param text Text to split
 * @param maxLength Maximum length per chunk
 * @returns Array of message chunks
 */
export function splitMessage(text: string, maxLength: number = 4000): string[] {
  if (text.length <= maxLength) return [text];
  
  const chunks: string[] = [];
  let currentChunk = '';
  
  const lines = text.split('\n');
  
  for (const line of lines) {
    if (currentChunk.length + line.length + 1 <= maxLength) {
      currentChunk += (currentChunk ? '\n' : '') + line;
    } else {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = line;
    }
  }
  
  if (currentChunk) chunks.push(currentChunk);
  
  return chunks;
}

/**
 * Loads the pool information from keyInfo.json
 * @returns Pool information
 */
export function loadPoolInfo(): PoolInfo {
  if (!fs.existsSync(KEY_INFO_PATH)) {
    return {};
  }

  const data = fs.readFileSync(KEY_INFO_PATH, 'utf-8');
  return JSON.parse(data);
}

/**
 * Saves pool information to keyInfo.json
 * @param poolInfo Pool information
 */
export function savePoolInfo(poolInfo: PoolInfo): void {
  fs.writeFileSync(KEY_INFO_PATH, JSON.stringify(poolInfo, null, 2));
}

/**
 * Formats a SOL amount with proper decimals
 * @param lamports Amount in lamports
 * @returns Formatted SOL amount
 */
export function formatSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(4);
}

/**
 * Formats a token amount with proper decimals (assuming 6 decimals)
 * @param amount Raw token amount
 * @returns Formatted token amount
 */
export function formatTokenAmount(amount: number): string {
  return (amount / 1e6).toFixed(2);
}

/**
 * Formats a timestamp to a readable date string
 * @param timestamp UNIX timestamp
 * @returns Formatted date string
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

/**
 * Validates that a string is a valid base58 encoded private key
 * @param privateKeyString Base58 private key string
 * @returns Whether the string is a valid private key
 */
export function isValidPrivateKey(privateKeyString: string): boolean {
  try {
    const decoded = bs58.decode(privateKeyString);
    return decoded.length === 64; // Solana private keys are 64 bytes
  } catch (error) {
    return false;
  }
}

/**
 * Validates that a string is a valid Solana address
 * @param addressString Solana address string
 * @returns Whether the string is a valid address
 */
export function isValidSolanaAddress(addressString: string): boolean {
  try {
    new PublicKey(addressString);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Validates that an amount is a valid SOL amount
 * @param amountString SOL amount string
 * @returns Whether the amount is valid
 */
export function isValidSolAmount(amountString: string): boolean {
  const amount = parseFloat(amountString);
  return !isNaN(amount) && amount > 0 && amount <= 100000; // Reasonable range check
}

/**
 * Waits for a specified amount of time
 * @param ms Time to wait in milliseconds
 * @returns Promise that resolves after the timeout
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Gets the SOL balance for a given public key
 * @param publicKey Public key to check
 * @returns SOL balance
 */
export async function getSolBalance(publicKey: PublicKey): Promise<number> {
  try {
    const balance = await connection.getBalance(publicKey);
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error("Error getting SOL balance:", error);
    return 0;
  }
}