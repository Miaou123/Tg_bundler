import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import path from 'path';
import { geyserClient as jitoGeyserClient } from 'jito-ts';
import {
  SearcherClient,
  searcherClient as jitoSearcherClient,
} from 'jito-ts/dist/sdk/block-engine/searcher.js';
import { BLOCKENGINE_URL } from '../shared/config';

// Default auth keypair path relative to project root
const AUTH_KEYPAIR_PATH = path.join(__dirname, '..', '..', 'blockengine.json');

// Load keypair from file if it exists, otherwise create a placeholder
let keypair: Keypair;

try {
  if (fs.existsSync(AUTH_KEYPAIR_PATH)) {
    const decodedKey = new Uint8Array(
      JSON.parse(fs.readFileSync(AUTH_KEYPAIR_PATH).toString()) as number[]
    );
    keypair = Keypair.fromSecretKey(decodedKey);
  } else {
    console.warn('⚠️ No blockengine.json file found. Using placeholder keypair for Jito.');
    keypair = Keypair.generate(); // Placeholder keypair
  }
} catch (error) {
  console.error('Error loading blockengine.json:', error);
  keypair = Keypair.generate(); // Fallback to placeholder
}

export const privateKey = keypair;

// Create searcher clients for the specified block engine URLs
const blockEngineUrls = [BLOCKENGINE_URL];
const searcherClients: SearcherClient[] = [];

for (const url of blockEngineUrls) {
  try {
    const client = jitoSearcherClient(url, keypair, {
      'grpc.keepalive_timeout_ms': 4000,
    });
    searcherClients.push(client);
    console.log(`✅ Connected to Jito block engine at ${url}`);
  } catch (error) {
    console.error(`❌ Failed to connect to Jito block engine at ${url}:`, error);
  }
}

// Geyser client is optional - only create if URL is provided
let geyserClient;
const GEYSER_URL = '';
const GEYSER_ACCESS_TOKEN = '';

if (GEYSER_URL && GEYSER_ACCESS_TOKEN) {
  try {
    geyserClient = jitoGeyserClient(GEYSER_URL, GEYSER_ACCESS_TOKEN, {
      'grpc.keepalive_timeout_ms': 4000,
    });
    console.log('✅ Connected to Jito geyser');
  } catch (error) {
    console.error('❌ Failed to connect to Jito geyser:', error);
  }
}

// All bundles are automatically forwarded to other regions.
// We'll use the first client (closest one) for sending bundles.
const searcherClient = searcherClients.length > 0 ? searcherClients[0] : null;

if (!searcherClient) {
  console.error('❌ No Jito searcher client available. Bundle sending will fail.');
}

export { searcherClient, searcherClients, geyserClient };