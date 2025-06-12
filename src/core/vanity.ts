import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { VALID_BASE58_CHARS } from '../shared/constants';

/**
 * Generate a vanity Solana address with specified pattern
 * @param pattern Pattern to match in the address
 * @param isPrefix Whether the pattern should be at the start of the address
 * @param progressCallback Optional callback for progress updates
 * @returns Generated keypair with matching address or null if cancelled
 */
export async function generateVanityAddress(
  pattern: string,
  isPrefix: boolean = true,
  progressCallback?: (attempts: number, timeElapsed: number) => void
): Promise<{publicKey: string, privateKey: string} | null> {
  // Validate pattern only contains valid Base58 characters
  for (const char of pattern) {
    if (!VALID_BASE58_CHARS.includes(char)) {
      throw new Error(`Invalid character in pattern: '${char}'`);
    }
  }

  const startTime = Date.now();
  let attempts = 0;
  let lastProgressUpdate = 0;
  const progressInterval = 1000; // Update progress every second

  // Estimate difficulty
  const difficulty = Math.pow(58, pattern.length);
  console.log(`Estimated difficulty: 1 in ${Math.round(difficulty).toLocaleString()} addresses`);
  console.log(`Searching for address ${isPrefix ? 'starting' : 'ending'} with: "${pattern}"`);
  console.log('This may take a while...');

  try {
    while (true) {
      attempts++;
      
      // Generate a new keypair
      const keypair = Keypair.generate();
      const address = keypair.publicKey.toBase58();
      
      // Check if the address matches the pattern
      const matched = isPrefix 
        ? address.startsWith(pattern) 
        : address.endsWith(pattern);
      
      // Report progress periodically
      const now = Date.now();
      if (now - lastProgressUpdate > progressInterval) {
        const elapsedSeconds = (now - startTime) / 1000;
        const rate = attempts / elapsedSeconds;
        console.log(`Tried ${attempts.toLocaleString()} addresses (${Math.round(rate).toLocaleString()}/sec)`);
        lastProgressUpdate = now;
        
        if (progressCallback) {
          progressCallback(attempts, now - startTime);
        }
      }
      
      // If matched, return the keypair
      if (matched) {
        const elapsedTime = (Date.now() - startTime) / 1000;
        console.log(`✅ Found matching address after ${attempts.toLocaleString()} attempts (${elapsedTime.toFixed(2)} seconds)`);
        console.log(`📋 Address: ${address}`);
        console.log(`🔑 Private key: ${bs58.encode(keypair.secretKey)}`);
        
        return {
          publicKey: address,
          privateKey: bs58.encode(keypair.secretKey)
        };
      }
      
      // Check for cancellation every 1000 attempts
      if (attempts % 1000 === 0) {
        // Add a small delay to allow for cooperative multitasking
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  } catch (error) {
    console.error('Error generating vanity address:', error);
    return null;
  }
}

/**
 * Generate multiple vanity Solana addresses
 * @param pattern Pattern to match in the address
 * @param isPrefix Whether the pattern should be at the start of the address
 * @param count Number of addresses to generate
 * @param progressCallback Optional callback for progress updates
 * @returns Array of generated keypairs with matching addresses
 */
export async function generateMultipleVanityAddresses(
  pattern: string,
  isPrefix: boolean = true,
  count: number = 1,
  progressCallback?: (attempts: number, timeElapsed: number, found: number) => void
): Promise<{publicKey: string, privateKey: string}[]> {
  const results: {publicKey: string, privateKey: string}[] = [];
  const startTime = Date.now();
  let attempts = 0;
  let lastProgressUpdate = 0;
  const progressInterval = 1000; // Update progress every second

  // Estimate difficulty
  const difficulty = Math.pow(58, pattern.length);
  console.log(`Estimated difficulty: 1 in ${Math.round(difficulty).toLocaleString()} addresses`);
  console.log(`Searching for ${count} addresses ${isPrefix ? 'starting' : 'ending'} with: "${pattern}"`);
  console.log('This may take a while...');

  try {
    while (results.length < count) {
      attempts++;
      
      // Generate a new keypair
      const keypair = Keypair.generate();
      const address = keypair.publicKey.toBase58();
      
      // Check if the address matches the pattern
      const matched = isPrefix 
        ? address.startsWith(pattern) 
        : address.endsWith(pattern);
      
      // Report progress periodically
      const now = Date.now();
      if (now - lastProgressUpdate > progressInterval) {
        const elapsedSeconds = (now - startTime) / 1000;
        const rate = attempts / elapsedSeconds;
        console.log(`Tried ${attempts.toLocaleString()} addresses (${Math.round(rate).toLocaleString()}/sec), found ${results.length}/${count}`);
        lastProgressUpdate = now;
        
        if (progressCallback) {
          progressCallback(attempts, now - startTime, results.length);
        }
      }
      
      // If matched, add to results
      if (matched) {
        const elapsedTime = (Date.now() - startTime) / 1000;
        console.log(`✅ Found matching address after ${attempts.toLocaleString()} attempts (${elapsedTime.toFixed(2)} seconds)`);
        console.log(`📋 Address: ${address}`);
        console.log(`🔑 Private key: ${bs58.encode(keypair.secretKey)}`);
        
        results.push({
          publicKey: address,
          privateKey: bs58.encode(keypair.secretKey)
        });
        
        if (results.length === count) {
          break;
        }
      }
      
      // Check for cancellation every 1000 attempts
      if (attempts % 1000 === 0) {
        // Add a small delay to allow for cooperative multitasking
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    return results;
    
  } catch (error) {
    console.error('Error generating vanity addresses:', error);
    return results; // Return any results found so far
  }
}

/**
 * Calculate the difficulty of finding a vanity address with a specific pattern
 * @param pattern Pattern to match
 * @returns Difficulty statistics
 */
export function calculateVanityDifficulty(pattern: string): {
  pattern: string;
  possibleChars: number;
  totalPossibilities: number;
  averageAttempts: number;
  estimatedTimeSeconds: number;
  timeEstimateString: string;
} {
  // Base58 has 58 possible characters
  const possibleChars = 58;
  
  // Calculate total possibilities (58^length)
  const totalPossibilities = Math.pow(possibleChars, pattern.length);
  
  // Average attempts needed is half of total possibilities
  const averageAttempts = totalPossibilities / 2;
  
  // Estimate time in seconds (assuming 100,000 attempts per second)
  const attemptsPerSecond = 100000;
  const estimatedTimeSeconds = averageAttempts / attemptsPerSecond;
  
  // Convert to human-readable time
  let timeEstimateString: string;
  if (estimatedTimeSeconds < 60) {
    timeEstimateString = `${estimatedTimeSeconds.toFixed(1)} seconds`;
  } else if (estimatedTimeSeconds < 3600) {
    timeEstimateString = `${(estimatedTimeSeconds / 60).toFixed(1)} minutes`;
  } else if (estimatedTimeSeconds < 86400) {
    timeEstimateString = `${(estimatedTimeSeconds / 3600).toFixed(1)} hours`;
  } else {
    timeEstimateString = `${(estimatedTimeSeconds / 86400).toFixed(1)} days`;
  }
  
  return {
    pattern,
    possibleChars,
    totalPossibilities,
    averageAttempts,
    estimatedTimeSeconds,
    timeEstimateString
  };
}