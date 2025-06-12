import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { wallet, payer, connection } from '../shared/config';
import { loadKeypairs } from './keys';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';
import { sleep } from '../shared/utils';

/**
 * Export all wallet information including keys and balances
 * @returns Object with export results
 */
export async function exportWallets(): Promise<{
  success: boolean;
  message: string;
  data?: any;
  exportPath?: string;
}> {
  try {
    // Get all wallets information
    const keypairs = loadKeypairs();
    
    // Export all wallet data (DEV, PAYER, and bundle wallets)
    const exportData = {
      timestamp: new Date().toISOString(),
      note: "Solana wallet export - KEEP SECURE!",
      devWallet: await getWalletExportData(wallet, "DEV WALLET"),
      payerWallet: await getWalletExportData(payer, "PAYER WALLET"),
      generatedWallets: await Promise.all(
        keypairs.map(async (keypair, index) => await getWalletExportData(keypair, `Wallet ${index + 1}`, index + 1))
      )
    };

    // Generate filename with timestamp
    const filename = `wallet_export_${Date.now()}.json`;
    const exportPath = path.join(process.cwd(), filename);

    // Write to file
    fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));

    return {
      success: true,
      message: `✅ Successfully exported ${keypairs.length + 2} wallets to ${filename}`,
      data: exportData,
      exportPath: exportPath
    };
  } catch (error) {
    console.error('Error exporting wallets:', error);
    return {
      success: false,
      message: `❌ Error exporting wallets: ${error.message || "Unknown error"}`,
    };
  }
}

/**
 * Get wallet information for export
 * @param keypair Wallet keypair
 * @param name Wallet name/label
 * @param index Optional wallet index (for bundle wallets)
 * @returns Wallet export data
 */
async function getWalletExportData(keypair: any, name: string, index?: number) {
  const publicKey = keypair.publicKey.toString();
  const privateKey = bs58.encode(keypair.secretKey);
  
  try {
    const balance = await connection.getBalance(keypair.publicKey);
    const balanceSOL = balance / LAMPORTS_PER_SOL;
    
    const data: any = {
      name,
      publicKey,
      privateKey,
      balanceSOL
    };
    
    if (index !== undefined) {
      data.index = index;
    }
    
    return data;
  } catch (error) {
    return {
      name,
      publicKey,
      privateKey,
      balanceSOL: 0,
      index: index
    };
  }
}

/**
 * Check balances for all wallets
 * @returns Object with wallet balance information
 */
export async function checkAllWalletBalances(): Promise<{
  success: boolean;
  message: string;
  data: {
    devWallet: { publicKey: string; balanceSOL: number };
    payerWallet: { publicKey: string; balanceSOL: number };
    bundleWallets: Array<{ index: number; publicKey: string; balanceSOL: number }>;
    totalSOL: number;
    nonEmptyWallets: number;
  };
}> {
  try {
    // Check dev wallet
    const devBalance = await connection.getBalance(wallet.publicKey);
    const devBalanceSOL = devBalance / LAMPORTS_PER_SOL;
    
    // Check payer wallet
    const payerBalance = await connection.getBalance(payer.publicKey);
    const payerBalanceSOL = payerBalance / LAMPORTS_PER_SOL;
    
    // Check all generated wallets
    const keypairs = loadKeypairs();
    let totalSOL = devBalance + payerBalance;
    let nonEmptyWallets = (devBalanceSOL > 0.001 ? 1 : 0) + (payerBalanceSOL > 0.001 ? 1 : 0);
    
    const bundleWallets = await Promise.all(
      keypairs.map(async (keypair, index) => {
        const balance = await connection.getBalance(keypair.publicKey);
        const balanceSOL = balance / LAMPORTS_PER_SOL;
        
        totalSOL += balance;
        if (balanceSOL > 0.001) {
          nonEmptyWallets++;
        }
        
        // Add a small delay to avoid rate limits
        await sleep(100);
        
        return {
          index: index + 1,
          publicKey: keypair.publicKey.toString(),
          balanceSOL
        };
      })
    );

    // Return wallet data
    return {
      success: true,
      message: `Found ${nonEmptyWallets} wallets with balance > 0.001 SOL, total: ${(totalSOL / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
      data: {
        devWallet: {
          publicKey: wallet.publicKey.toString(),
          balanceSOL: devBalanceSOL
        },
        payerWallet: {
          publicKey: payer.publicKey.toString(),
          balanceSOL: payerBalanceSOL
        },
        bundleWallets,
        totalSOL: totalSOL / LAMPORTS_PER_SOL,
        nonEmptyWallets
      }
    };
  } catch (error) {
    return {
      success: false,
      message: `Error checking wallet balances: ${error.message || "Unknown error"}`,
      data: {
        devWallet: { publicKey: wallet.publicKey.toString(), balanceSOL: 0 },
        payerWallet: { publicKey: payer.publicKey.toString(), balanceSOL: 0 },
        bundleWallets: [],
        totalSOL: 0,
        nonEmptyWallets: 0
      }
    };
  }
}