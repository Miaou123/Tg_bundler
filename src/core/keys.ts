import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import path from 'path';
import bs58 from 'bs58';
import { KEYPAIRS_DIR, KEY_INFO_PATH } from '../shared/config';
import { MAX_WALLETS } from '../shared/constants';
import { savePoolInfo, loadPoolInfo } from '../shared/utils';

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
 * Save a keypair to a file
 * @param keypair Keypair to save
 * @param index Wallet index (1-based)
 */
export function saveKeypairToFile(keypair: Keypair, index: number): void {
  const keypairPath = path.join(KEYPAIRS_DIR, `keypair${index + 1}.json`);
  fs.writeFileSync(keypairPath, JSON.stringify(Array.from(keypair.secretKey)));
}

/**
 * Read all keypairs from the keypairs directory
 * @returns Array of loaded keypairs
 */
export function readKeypairs(): Keypair[] {
  if (!fs.existsSync(KEYPAIRS_DIR)) {
    return [];
  }

  const files = fs.readdirSync(KEYPAIRS_DIR)
    .filter(file => file.startsWith('keypair') && file.endsWith('.json'))
    .sort((a, b) => {
      // Extract numbers from filenames and sort numerically
      const numA = parseInt(a.replace('keypair', '').replace('.json', ''));
      const numB = parseInt(b.replace('keypair', '').replace('.json', ''));
      return numA - numB;
    });

  return files.map(file => {
    const filePath = path.join(KEYPAIRS_DIR, file);
    const secretKey = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Keypair.fromSecretKey(new Uint8Array(secretKey));
  });
}

/**
 * Update pool info with wallet information
 * @param wallets Array of keypairs
 */
export function updatePoolInfoWithWallets(wallets: Keypair[]): void {
  const poolInfo = loadPoolInfo();
  
  // Update wallet-related information
  poolInfo.numOfWallets = wallets.length;
  wallets.forEach((wallet, index) => {
    poolInfo[`pubkey${index + 1}`] = wallet.publicKey.toString();
  });
  
  savePoolInfo(poolInfo);
}

/**
 * Create new keypairs or use existing ones
 * @param createNew Whether to create new keypairs
 * @param numWallets Number of wallets to create (if creating new)
 * @returns Array of keypairs
 */
export async function createOrUseKeypairs(createNew: boolean, numWallets: number = MAX_WALLETS): Promise<Keypair[]> {
  let wallets: Keypair[] = [];

  if (createNew) {
    // Create backup directory if it doesn't exist
    const backupDir = path.join(KEYPAIRS_DIR, 'backup', new Date().toISOString().replace(/:/g, '-'));
    
    // Backup existing keypairs if any
    if (fs.existsSync(KEYPAIRS_DIR)) {
      const existingFiles = fs.readdirSync(KEYPAIRS_DIR).filter(file => file.endsWith('.json'));
      
      if (existingFiles.length > 0) {
        fs.mkdirSync(backupDir, { recursive: true });
        
        existingFiles.forEach(file => {
          const sourcePath = path.join(KEYPAIRS_DIR, file);
          const destPath = path.join(backupDir, file);
          fs.copyFileSync(sourcePath, destPath);
        });
      }
    }
    
    // Create keypairs directory if it doesn't exist
    if (!fs.existsSync(KEYPAIRS_DIR)) {
      fs.mkdirSync(KEYPAIRS_DIR, { recursive: true });
    }
    
    // Generate and save new wallets
    wallets = generateWallets(numWallets);
    wallets.forEach((wallet, index) => {
      saveKeypairToFile(wallet, index);
    });
  } else {
    // Use existing wallets
    wallets = readKeypairs();
  }

  // Update pool info with wallets
  updatePoolInfoWithWallets(wallets);
  
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
 * Load keypairs from the keypairs directory
 * @returns Array of keypairs
 */
export function loadKeypairs(): Keypair[] {
  // Define a regular expression to match filenames like 'keypair1.json', 'keypair2.json', etc.
  const keypairRegex = /^keypair\d+\.json$/;

  return fs.readdirSync(KEYPAIRS_DIR)
    .filter(file => keypairRegex.test(file)) // Use the regex to test each filename
    .map(file => {
      const filePath = path.join(KEYPAIRS_DIR, file);
      const secretKeyString = fs.readFileSync(filePath, { encoding: 'utf8' });
      const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
      return Keypair.fromSecretKey(secretKey);
    });
}