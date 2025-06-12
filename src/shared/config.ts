import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Define paths
export const KEYPAIRS_DIR = path.join(__dirname, '..', '..', 'keypairs');
export const KEY_INFO_PATH = path.join(__dirname, '..', '..', 'keyInfo.json');

// User-specific path functions
export function getUserKeypairPath(userId: number): string {
  return path.join(KEYPAIRS_DIR, `user_${userId}.json`);
}

export function getUserKeyInfoPath(userId: number): string {
  return path.join(KEYPAIRS_DIR, `keyInfo_${userId}.json`);
}

// Ensure directories exist
if (!fs.existsSync(KEYPAIRS_DIR)) {
  fs.mkdirSync(KEYPAIRS_DIR, { recursive: true });
}

// Validate required environment variables
const requiredEnvVars = [
  'WALLET_PRIVATE_KEY', 
  'PAYER_PRIVATE_KEY', 
  'RPC_URL',
  'TELEGRAM_BOT_TOKEN'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Bot configuration
export const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
export const AUTHORIZED_TELEGRAM_USERS = process.env.AUTHORIZED_TELEGRAM_USERS?.split(',').map(id => parseInt(id)) || [];

// Wallets configuration
export const wallet = Keypair.fromSecretKey(
  bs58.decode(process.env.WALLET_PRIVATE_KEY!),
);

export const payer = Keypair.fromSecretKey(
  bs58.decode(process.env.PAYER_PRIVATE_KEY!),
);

// RPC configuration
export const rpc = process.env.RPC_URL!;
export const wsEndpoint = process.env.WS_ENDPOINT || process.env.RPC_URL!.replace('https://', 'wss://').replace('http://', 'ws://');
export const connection = new Connection(rpc, "confirmed");

// Solana program IDs
export const PUMP_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const PUMPSWAP_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const RayLiqPoolv4 = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
export const global = new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jaxnjf");
export const mintAuthority = new PublicKey("TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM");
export const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const eventAuthority = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");
export const feeRecipient = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");

// Jito configuration
export const BLOCKENGINE_URL = process.env.BLOCKENGINE_URL || 'amsterdam.mainnet.block-engine.jito.wtf';
export const JITO_TIP_DEFAULT = process.env.JITO_TIP ? parseFloat(process.env.JITO_TIP) : 0.01;

// Compute budget settings
export const COMPUTE_LIMIT_PRICE = process.env.COMPUTE_LIMIT_PRICE ? parseInt(process.env.COMPUTE_LIMIT_PRICE) : 150000;
export const COMPUTE_UNIT = process.env.COMPUTE_UNIT ? parseInt(process.env.COMPUTE_UNIT) : 200000;