import { PublicKey } from "@solana/web3.js";

// Menu identifiers
export const MENUS = {
  MAIN: 'main',
  PRE_LAUNCH: 'preLaunch',
  VANITY: 'vanity',
  SELL: 'sell',
  BUY: 'buy'
};

// Input states
export const WAITING_FOR = {
  VANITY_PATTERN_TYPE: 'vanity_pattern_type',
  VANITY_PATTERN: 'vanity_pattern',
  VANITY_DIFFICULTY_PATTERN: 'vanity_difficulty_pattern',
  JITO_TIP: 'jito_tip',
  VANITY_PRIVATE_KEY: 'vanity_private_key',
  SELL_SELECTION_MODE: 'sell_selection_mode',
  SELL_PERCENTAGE: 'sell_percentage',
  SELL_SLIPPAGE: 'sell_slippage',
  BUY_SELECTION_MODE: 'buy_selection_mode',
  BUY_TOTAL_SOL: 'buy_total_sol',
  BUY_SLIPPAGE: 'buy_slippage',
  KEYPAIRS_CHOICE: 'keypairs_choice',
  VANITY_CHOICE: 'vanity_choice',
  NUM_WALLETS: 'num_wallets'
};

// Keyboard options
export const KEYBOARD_OPTIONS = {
  // Selection options
  YES: 'Yes ✅',
  NO: 'No ❌',
  BACK: '🔙 Back',
  
  // Wallet options
  CREATE_NEW: '📝 Create New',
  USE_EXISTING: '📁 Use Existing',
  
  // Vanity options
  PREFIX: '1️⃣ Starts with (prefix)',
  SUFFIX: '2️⃣ Ends with (suffix)',
  PUMP_SUFFIX: '3️⃣ Quick pump ending',
  
  // Common keyboard layouts
  BACK_TO_MAIN: '🔙 Main Menu'
};

// Default values
export const DEFAULTS = {
  SLIPPAGE: 10,
  JITO_TIP: 0.01,
  SELECTION_MODE: 1
};

// Error messages
export const ERRORS = {
  UNAUTHORIZED: '❌ You are not authorized to use this bot.',
  INVALID_AMOUNT: '❌ Invalid amount. Please enter a valid number.',
  INVALID_PERCENTAGE: '❌ Invalid percentage. Please enter a number between 0 and 100.',
  MISSING_KEYINFO: '❌ KeyInfo file not found. Please run the Pre Launch Checklist first.',
  MISSING_LUT: '❌ LUT not found in KeyInfo. Please create LUT first.',
  INVALID_PATTERN: '❌ Invalid pattern. Please use only valid base58 characters.',
  OPERATION_CANCELLED: '✅ Operation cancelled. Returning to main menu.'
};

// Success messages
export const SUCCESS = {
  OPERATION_COMPLETED: '✅ Operation completed successfully!',
  BACK_TO_MAIN: '↩️ Returning to main menu...'
};

// Valid characters for vanity address
export const VALID_BASE58_CHARS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// Max wallets
export const MAX_WALLETS = 24;

// Transaction settings
export const TX_SETTINGS = {
  WALLETS_PER_TX_PUMPFUN: 5,
  WALLETS_PER_TX_PUMPSWAP: 3,
  MAX_TX_SIZE: 1232,
  MAX_RETRY_COUNT: 3
};

// PumpSwap program ID
export const PUMPSWAP_PROGRAM_ID = new PublicKey("BRsyKJdA6keVTXMcJbwP1FJucZixZrhbYjXKHbsLY2Ec");

// Wrapped SOL mint
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");