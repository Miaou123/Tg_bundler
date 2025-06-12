import { PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Use predefined config values to simplify
export const BLOCKENGINE_URL = process.env.BLOCKENGINE_URL || 'amsterdam.mainnet.block-engine.jito.wtf';
export const AUTH_KEYPAIR_PATH = './blockengine.json';
export const GEYSER_URL = '';
export const GEYSER_ACCESS_TOKEN = '';

// Jito tip accounts
export const TIP_ACCOUNTS = [
  'HD5L3vZRbYWFqk7MHfpNT9jZB1HnAqmNpZ87K2fgQs1z',
  '7oFazqk9pCJGcFLnTMvxgeVfRqfJHvnEWJM1q4S1erLA',
  '3FkxQkPUnrEMdwrRXbYpsdpTpJRwPXXd4EAYeCTGEhVw',
  '7vsyVQ7kYGazdJPZwQYK5rSCfCfXYVWSbgtffvNCCGef',
];

// Tip account helper
export function getRandomTipAccount(): PublicKey {
  const randomIndex = Math.floor(Math.random() * TIP_ACCOUNTS.length);
  return new PublicKey(TIP_ACCOUNTS[randomIndex]);
}