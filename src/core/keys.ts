import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import path from 'path';
import bs58 from 'bs58';
import { KEYPAIRS_DIR } from '../shared/config';
import { MAX_WALLETS } from '../shared/constants';
import { savePoolInfo, loadPoolInfo } from '../shared/utils';

interface UserWallet {
  index: number;
  publicKey: string;
  secretKey: number[];
}

interface UserKeypairFile {
  userId: number;
  numOfWallets: number;
  createdAt: string;
  wallets: UserWallet[];
}

/**
 * Get user-specific keypair file path
 * @param userId Telegram user ID
 * @returns File path for user's keypairs
 */
function getUserKeypairPath(userId: number): string {
  return path.join(KEYPAIRS_DIR, `user_${userId}.json`);
}

/**
 * Get user-specific keyInfo file path
 * @param userId Telegram user ID
 * @returns File path for user's keyInfo
 */
export function getUserKeyInfoPath(userId: number): string {
  return path.join(KEYPAIRS_DIR, `keyInfo_${userId}.json`);
}

/**
 * Generate a specific number of new wallets
 * @param numOfWallets Number of wallets to generate
 * @returns Array of generated keypairs
 */
export function generateWallets(numOfWallets: number = MAX_WALLETS): Keypair[] {
  let wallets: Keypair[] = [];
  for (let i = 0; i < numOfWallets; i++) {
    const wallet = Keypair.generate();
    wallets.push(wallet);
  }
  return wallets;
}

/**
 * Save user keypairs to a single JSON file
 * @param userId Telegram user ID
 * @param keypairs Array of keypairs to save
 */
export function saveUserKeypairs(userId: number, keypairs: Keypair[]): void {
  // Ensure the keypairs directory exists
  if (!fs.existsSync(KEYPAIRS_DIR)) {
    fs.mkdirSync(KEYPAIRS_DIR, { recursive: true });
  }

  const userFile: UserKeypairFile = {
    userId: userId,
    numOfWallets: keypairs.length,
    createdAt: new Date().toISOString(),
    wallets: keypairs.map((keypair, index) => ({
      index: index + 1,
      publicKey: keypair.publicKey.toString(),
      secretKey: Array.from(keypair.secretKey)
    }))
  };

  const filePath = getUserKeypairPath(userId);
  fs.writeFileSync(filePath, JSON.stringify(userFile, null, 2));
}

/**
 * Read user keypairs from their JSON file
 * @param userId Telegram user ID
 * @returns Array of loaded keypairs
 */
export function readUserKeypairs(userId: number): Keypair[] {
  const filePath = getUserKeypairPath(userId);
  
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const userFile: UserKeypairFile = JSON.parse(fileContent);
    
    return userFile.wallets.map(wallet => 
      Keypair.fromSecretKey(new Uint8Array(wallet.secretKey))
    );
  } catch (error) {
    console.error(`Error reading user keypairs for user ${userId}:`, error);
    return [];
  }
}

/**
 * Update user-specific pool info with wallet information
 * @param userId Telegram user ID
 * @param wallets Array of keypairs
 */
export function updateUserPoolInfo(userId: number, wallets: Keypair[]): void {
  const keyInfoPath = getUserKeyInfoPath(userId);
  let poolInfo: any = {};

  // Check if user's keyInfo file exists and read its content
  if (fs.existsSync(keyInfoPath)) {
    try {
      const data = fs.readFileSync(keyInfoPath, 'utf8');
      poolInfo = JSON.parse(data);
    } catch (error) {
      console.error(`Error reading keyInfo for user ${userId}:`, error);
      poolInfo = {};
    }
  }

  // Update wallet-related information
  poolInfo.userId = userId;
  poolInfo.numOfWallets = wallets.length;
  poolInfo.updatedAt = new Date().toISOString();
  
  wallets.forEach((wallet, index) => {
    poolInfo[`pubkey${index + 1}`] = wallet.publicKey.toString();
  });

  // Write updated data back to user's keyInfo file
  fs.writeFileSync(keyInfoPath, JSON.stringify(poolInfo, null, 2));
}

/**
 * Create new keypairs or use existing ones for a specific user
 * @param userId Telegram user ID
 * @param createNew Whether to create new keypairs
 * @param numWallets Number of wallets to create (if creating new)
 * @returns Array of keypairs
 */
export async function createOrUseUserKeypairs(userId: number, createNew: boolean, numWallets: number = MAX_WALLETS): Promise<Keypair[]> {
  let wallets: Keypair[] = [];

  if (createNew) {
    // Create backup if user already has keypairs
    const existingWallets = readUserKeypairs(userId);
    if (existingWallets.length > 0) {
      const backupPath = getUserKeypairPath(userId) + `.backup.${Date.now()}`;
      const currentPath = getUserKeypairPath(userId);
      
      if (fs.existsSync(currentPath)) {
        fs.copyFileSync(currentPath, backupPath);
        console.log(`Backed up existing keypairs to: ${backupPath}`);
      }
    }
    
    // Generate and save new wallets
    wallets = generateWallets(numWallets);
    saveUserKeypairs(userId, wallets);
  } else {
    // Use existing wallets
    wallets = readUserKeypairs(userId);
    if (wallets.length === 0) {
      throw new Error(`No existing keypairs found for user ${userId}. Please create new keypairs first.`);
    }
  }

  // Update user's pool info
  updateUserPoolInfo(userId, wallets);
  
  return wallets;
}

/**
 * Generate a keypair from a base58 private key
 * @param privateKeyBase58 Base58-encoded private key
 * @returns Keypair
 */
export function keypairFromBase58(privateKeyBase58: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
}

/**
 * Load user keypairs (alias for readUserKeypairs for backward compatibility)
 * @param userId Telegram user ID
 * @returns Array of keypairs
 */
export function loadUserKeypairs(userId: number): Keypair[] {
  return readUserKeypairs(userId);
}

/**
 * Get user wallet info
 * @param userId Telegram user ID
 * @returns Wallet information object
 */
export function getUserWalletInfo(userId: number): UserKeypairFile | null {
  const filePath = getUserKeypairPath(userId);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error) {
    console.error(`Error reading wallet info for user ${userId}:`, error);
    return null;
  }
}

/**
 * Clear user's LUT information when new keypairs are created
 * @param userId Telegram user ID
 */
export async function clearUserLUTInfo(userId: number): Promise<void> {
  const keyInfoPath = getUserKeyInfoPath(userId);
  
  if (fs.existsSync(keyInfoPath)) {
    try {
      const poolInfo = JSON.parse(fs.readFileSync(keyInfoPath, 'utf-8'));
      
      // Remove LUT-related fields
      delete poolInfo.addressLUT;
      delete poolInfo.lutCreatedAt;
      delete poolInfo.lutExtendedAt;
      delete poolInfo.vanityMint;
      delete poolInfo.randomMint;
      
      // Keep other info but mark as updated
      poolInfo.lutCleared = true;
      poolInfo.lutClearedAt = new Date().toISOString();
      poolInfo.reason = 'New keypairs created - old LUT incompatible';
      
      fs.writeFileSync(keyInfoPath, JSON.stringify(poolInfo, null, 2));
      console.log(`Cleared LUT info for user ${userId} due to new keypairs`);
    } catch (error) {
      console.error(`Error clearing LUT info for user ${userId}:`, error);
    }
  }
}

/**
 * Check if user has keypairs
 * @param userId Telegram user ID
 * @returns Whether user has keypairs
 */
export function userHasKeypairs(userId: number): boolean {
  const filePath = getUserKeypairPath(userId);
  return fs.existsSync(filePath);
}

// Legacy functions for backward compatibility - these now throw errors
export function createOrUseKeypairs(): never {
  throw new Error('createOrUseKeypairs is deprecated. Use createOrUseUserKeypairs(userId, createNew, numWallets) instead.');
}

export function loadKeypairs(): never {
  throw new Error('loadKeypairs is deprecated. Use loadUserKeypairs(userId) instead.');
}