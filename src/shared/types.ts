import { Keypair, PublicKey } from "@solana/web3.js";
import TelegramBot from 'node-telegram-bot-api';

// User session types
export interface UserSession {
  currentFunction?: string;
  step?: number;
  data?: Record<string, any>;
  waitingFor?: string;
  inputs?: string[];
  [key: string]: any; // Allow any additional properties
}

// Wallet selection modes
export enum WalletSelectionMode {
  ALL_WALLETS = 1,   // All wallets (creator + bundle wallets)
  BUNDLE_ONLY = 2,   // Only bundle wallets (exclude creator)
  CREATOR_ONLY = 3   // Only creator wallet
}

// Token platform enum
export enum TokenPlatform {
  PUMP_FUN = "pump.fun",
  PUMPSWAP = "pumpswap"
}

// Pool information
export interface PoolInfo {
  [key: string]: any;
  numOfWallets?: number;
  addressLUT?: string;
  mint?: string;
  mintPk?: string;
}

// Wallet with SOL information
export interface WalletWithSOL {
  keypair: Keypair;
  solBalance: number;
  allocatedSOL: number;
  walletName: string;
}

// Wallet with token information
export interface WalletWithTokens {
  keypair: Keypair;
  tokenBalance: number;
  walletName: string;
}

// Wallet balances
export interface WalletBalances {
  keypair: Keypair;
  walletName: string;
  nativeSOL: number;
  wrappedSOL: number;
  totalSOL: number;
}

// Bundle result
export interface BundleResult {
  bundleId: string | null;
  sent: boolean;
  verified: boolean;
  bundleNumber: number;
}

// Telegram prompt interface
export interface TelegramPrompt {
  addResponse(response: string): void;
  prompt(message?: string, _default?: string): string | null;
  promptAsync(message: string): Promise<string>;
}

// Handler function type
export type CommandHandler = (
  bot: TelegramBot,
  chatId: number,
  userId: number,
  session: UserSession,
  text?: string
) => Promise<void>;

// Menu definition
export interface MenuOption {
  text: string;
  handler: CommandHandler;
}

export interface Menu {
  title: string;
  options: MenuOption[][];
}

// Message template
export interface MessageTemplate {
  title: string;
  content: string;
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
}

// Operation result
export interface OperationResult {
  success: boolean;
  message: string;
  data?: any;
}