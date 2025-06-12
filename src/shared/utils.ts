import * as fs from 'fs';
import { getUserKeyInfoPath } from './config';

/**
 * Load user-specific pool info
 * @param userId Telegram user ID
 * @returns Pool info object
 */
export function loadUserPoolInfo(userId: number): any {
  const keyInfoPath = getUserKeyInfoPath(userId);
  
  if (!fs.existsSync(keyInfoPath)) {
    return {};
  }

  try {
    const data = fs.readFileSync(keyInfoPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error loading pool info for user ${userId}:`, error);
    return {};
  }
}

/**
 * Save user-specific pool info
 * @param userId Telegram user ID
 * @param poolInfo Pool info object to save
 */
export function saveUserPoolInfo(userId: number, poolInfo: any): void {
  const keyInfoPath = getUserKeyInfoPath(userId);
  
  try {
    // Ensure userId is always included
    poolInfo.userId = userId;
    poolInfo.updatedAt = new Date().toISOString();
    
    fs.writeFileSync(keyInfoPath, JSON.stringify(poolInfo, null, 2));
  } catch (error) {
    console.error(`Error saving pool info for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Legacy functions for backward compatibility - now require userId
 */
export function loadPoolInfo(userId?: number): any {
  if (!userId) {
    throw new Error('loadPoolInfo now requires userId parameter. Use loadUserPoolInfo(userId) instead.');
  }
  return loadUserPoolInfo(userId);
}

export function savePoolInfo(poolInfo: any, userId?: number): void {
  if (!userId) {
    throw new Error('savePoolInfo now requires userId parameter. Use saveUserPoolInfo(userId, poolInfo) instead.');
  }
  return saveUserPoolInfo(userId, poolInfo);
}

/**
 * Check if user has valid pool info
 * @param userId Telegram user ID
 * @returns Whether user has pool info
 */
export function userHasPoolInfo(userId: number): boolean {
  const keyInfoPath = getUserKeyInfoPath(userId);
  return fs.existsSync(keyInfoPath);
}

/**
 * Get user's wallet count from pool info
 * @param userId Telegram user ID
 * @returns Number of wallets or 0 if none
 */
export function getUserWalletCount(userId: number): number {
  const poolInfo = loadUserPoolInfo(userId);
  return poolInfo.numOfWallets || 0;
}

/**
 * Escape MarkdownV2 special characters
 * @param text Text to escape
 * @returns Escaped text safe for MarkdownV2
 */
export function escapeMarkdown(text: string): string {
  // MarkdownV2 special characters that need escaping
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}
/**
 * Format currency amount
 * @param amount Amount to format
 * @param currency Currency symbol (default: SOL)
 * @returns Formatted currency string
 */
export function formatCurrency(amount: number, currency: string = 'SOL'): string {
  return `${amount.toFixed(4)} ${currency}`;
}

/**
 * Format percentage
 * @param value Percentage value
 * @returns Formatted percentage string
 */
export function formatPercentage(value: number): string {
  return `${value.toFixed(2)}%`;
}

/**
 * Sleep utility function
 * @param ms Milliseconds to sleep
 * @returns Promise that resolves after delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Validate Solana address format
 * @param address Address string to validate
 * @returns Whether address is valid format
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    // Basic validation - should be base58 and correct length
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  } catch {
    return false;
  }
}

/**
 * Truncate address for display
 * @param address Full address string
 * @param startLength Characters to show at start (default: 4)
 * @param endLength Characters to show at end (default: 4)
 * @returns Truncated address with ellipsis
 */
export function truncateAddress(address: string, startLength: number = 4, endLength: number = 4): string {
  if (address.length <= startLength + endLength) {
    return address;
  }
  return `${address.slice(0, startLength)}...${address.slice(-endLength)}`;
}

export default {
  loadUserPoolInfo,
  saveUserPoolInfo,
  loadPoolInfo,
  savePoolInfo,
  userHasPoolInfo,
  getUserWalletCount,
  escapeMarkdown,
  formatCurrency,
  formatPercentage,
  sleep,
  isValidSolanaAddress,
  truncateAddress
};