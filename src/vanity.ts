import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
const promptSync = require("prompt-sync");
import fs from "fs";
import path from "path";

const prompt = promptSync();

interface VanityResult {
    keypair: Keypair;
    publicKey: string;
    privateKey: string;
    attempts: number;
    timeElapsed: number;
}

// ✅ MAIN VANITY ADDRESS GENERATOR
export async function generateVanityAddress() {
    console.log("🎯 SOLANA VANITY ADDRESS GENERATOR");
    console.log("==================================");
    console.log("Generate custom addresses with your desired pattern!");
    console.log("");
    console.log("Examples:");
    console.log("  Start: 'ABC' → ABC... (addresses starting with ABC)");
    console.log("  End: 'pump' → ...pump (addresses ending with pump)");
    console.log("  End: 'PUMP' → ...PUMP (case sensitive!)");
    console.log("");
    console.log("⚠️  Note: Longer patterns take exponentially longer to find!");

    // Choose pattern type
    console.log("\n📋 Pattern Types:");
    console.log("1. Starts with (prefix)");
    console.log("2. Ends with (suffix)");
    console.log("3. Quick pump ending (recommended for pump.fun!)");
    
    const choice = prompt("\n🎯 Choose pattern type (1/2/3): ");
    
    if (choice === "3") {
        // Quick option for pump ending
        await generatePumpEndingAddress();
        return;
    }
    
    let pattern: string;
    let isPrefix: boolean;
    
    if (choice === "1") {
        pattern = prompt("🎯 Enter prefix (what address should START with): ");
        isPrefix = true;
    } else if (choice === "2") {
        pattern = prompt("🎯 Enter suffix (what address should END with): ");
        isPrefix = false;
    } else {
        console.log("❌ Invalid choice!");
        return;
    }
    
    if (!pattern || pattern.length === 0) {
        console.log("❌ Invalid pattern!");
        return;
    }

    // Validate pattern (Solana addresses use base58)
    const validChars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    for (const char of pattern) {
        if (!validChars.includes(char)) {
            console.log(`❌ Invalid character '${char}' in pattern!`);
            console.log("📋 Valid characters: " + validChars);
            return;
        }
    }

    console.log(`\n🔍 Searching for addresses ${isPrefix ? 'starting' : 'ending'} with: "${pattern}"`);
    console.log("⏳ This may take a while... Press Ctrl+C to stop");
    
    const startTime = Date.now();
    let attempts = 0;
    let found = false;
    let result: VanityResult | null = null;

    // Show estimated difficulty
    const difficulty = Math.pow(58, pattern.length);
    console.log(`📊 Estimated attempts needed: ~${difficulty.toLocaleString()}`);
    
    // Start searching
    console.log("\n🔄 Searching...");
    const searchInterval = setInterval(() => {
        console.log(`   Attempts: ${attempts.toLocaleString()} | Time: ${Math.floor((Date.now() - startTime) / 1000)}s | Rate: ${Math.floor(attempts / ((Date.now() - startTime) / 1000)).toLocaleString()}/s`);
    }, 5000);

    while (!found) {
        const keypair = Keypair.generate();
        const publicKeyString = keypair.publicKey.toString();
        attempts++;

        const matches = isPrefix ? 
            publicKeyString.startsWith(pattern) : 
            publicKeyString.endsWith(pattern);

        if (matches) {
            found = true;
            const timeElapsed = Date.now() - startTime;
            
            result = {
                keypair: keypair,
                publicKey: publicKeyString,
                privateKey: bs58.encode(keypair.secretKey),
                attempts: attempts,
                timeElapsed: timeElapsed
            };

            clearInterval(searchInterval);
            
            console.log("\n🎉 VANITY ADDRESS FOUND!");
            console.log("========================");
            console.log(`✅ Public Key:  ${result.publicKey}`);
            console.log(`🔑 Private Key: ${result.privateKey}`);
            console.log(`📊 Attempts:    ${result.attempts.toLocaleString()}`);
            console.log(`⏱️  Time:       ${(result.timeElapsed / 1000).toFixed(2)} seconds`);
            console.log(`🚀 Rate:        ${Math.floor(result.attempts / (result.timeElapsed / 1000)).toLocaleString()} attempts/second`);

            // Ask if user wants to save
            const save = prompt("\n💾 Save this vanity address to file? (y/n): ").toLowerCase();
            if (save === 'y' || save === 'yes') {
                await saveVanityAddress(result, pattern, isPrefix);
            }

            // Ask if user wants to use for next token
            const useForToken = prompt("\n🪙 Use this address for your next token mint? (y/n): ").toLowerCase();
            if (useForToken === 'y' || useForToken === 'yes') {
                await updateKeyInfoWithVanity(result);
            }
        }

        // Safety check - don't run forever
        if (attempts > 10000000) { // 10 million attempts max
            clearInterval(searchInterval);
            console.log("\n⏹️  Search stopped after 10 million attempts");
            console.log("💡 Try a shorter pattern for better chances");
            break;
        }
    }
}

// ✅ QUICK PUMP ENDING GENERATOR
async function generatePumpEndingAddress() {
    console.log("\n🚀 GENERATING PUMP.FUN VANITY ADDRESS");
    console.log("====================================");
    console.log("🎯 Searching for addresses ending with 'pump'");
    console.log("💡 Perfect for pump.fun launches!");
    
    const pattern = "pump";
    const startTime = Date.now();
    let attempts = 0;
    let found = false;
    let result: VanityResult | null = null;

    // Show estimated difficulty for 4-character suffix
    const difficulty = Math.pow(58, 4);
    console.log(`📊 Estimated attempts needed: ~${(difficulty / 2).toLocaleString()}`);
    console.log(`⏱️  Estimated time: ~${Math.floor((difficulty / 2) / 100000 / 60)} minutes`);
    
    console.log("\n🔄 Searching for ...pump addresses...");
    const searchInterval = setInterval(() => {
        console.log(`   Attempts: ${attempts.toLocaleString()} | Time: ${Math.floor((Date.now() - startTime) / 1000)}s | Rate: ${Math.floor(attempts / ((Date.now() - startTime) / 1000)).toLocaleString()}/s`);
    }, 5000);

    while (!found) {
        const keypair = Keypair.generate();
        const publicKeyString = keypair.publicKey.toString();
        attempts++;

        if (publicKeyString.endsWith(pattern)) {
            found = true;
            const timeElapsed = Date.now() - startTime;
            
            result = {
                keypair: keypair,
                publicKey: publicKeyString,
                privateKey: bs58.encode(keypair.secretKey),
                attempts: attempts,
                timeElapsed: timeElapsed
            };

            clearInterval(searchInterval);
            
            console.log("\n🎉 PUMP VANITY ADDRESS FOUND!");
            console.log("=============================");
            console.log(`✅ Public Key:  ${result.publicKey}`);
            console.log(`🔑 Private Key: ${result.privateKey}`);
            console.log(`📊 Attempts:    ${result.attempts.toLocaleString()}`);
            console.log(`⏱️  Time:       ${(result.timeElapsed / 1000).toFixed(2)} seconds`);
            console.log(`🚀 Rate:        ${Math.floor(result.attempts / (result.timeElapsed / 1000)).toLocaleString()} attempts/second`);
            console.log(`🎯 Perfect for: pump.fun launches! 🚀`);

            // Ask if user wants to save
            const save = prompt("\n💾 Save this pump vanity address to file? (y/n): ").toLowerCase();
            if (save === 'y' || save === 'yes') {
                await saveVanityAddress(result, pattern, false);
            }

            // Ask if user wants to use for next token
            const useForToken = prompt("\n🪙 Use this address for your next pump.fun token? (y/n): ").toLowerCase();
            if (useForToken === 'y' || useForToken === 'yes') {
                await updateKeyInfoWithVanity(result);
            }
        }

        // Safety check
        if (attempts > 20000000) { // 20 million attempts max for pump
            clearInterval(searchInterval);
            console.log("\n⏹️  Search stopped after 20 million attempts");
            console.log("💡 This is taking longer than expected - you can try again");
            break;
        }
    }
}

// ✅ BATCH VANITY GENERATOR (updated for suffix support)
export async function generateMultipleVanityAddresses() {
    console.log("🎯 BATCH VANITY ADDRESS GENERATOR");
    console.log("=================================");
    
    console.log("📋 Pattern Types:");
    console.log("1. Starts with (prefix)");
    console.log("2. Ends with (suffix)");
    
    const choice = prompt("🎯 Choose pattern type (1/2): ");
    const isPrefix = choice === "1";
    
    const pattern = prompt(`🎯 Enter ${isPrefix ? 'prefix' : 'suffix'}: `);
    const count = parseInt(prompt("📊 How many addresses to generate? "));
    
    if (!pattern || isNaN(count) || count <= 0) {
        console.log("❌ Invalid input!");
        return;
    }

    console.log(`\n🔍 Searching for ${count} addresses ${isPrefix ? 'starting' : 'ending'} with: "${pattern}"`);
    
    const results: VanityResult[] = [];
    const startTime = Date.now();

    for (let i = 0; i < count; i++) {
        console.log(`\n🔄 Generating address ${i + 1}/${count}...`);
        
        let attempts = 0;
        let found = false;
        
        while (!found) {
            const keypair = Keypair.generate();
            const publicKeyString = keypair.publicKey.toString();
            attempts++;

            const matches = isPrefix ? 
                publicKeyString.startsWith(pattern) : 
                publicKeyString.endsWith(pattern);

            if (matches) {
                found = true;
                
                const result: VanityResult = {
                    keypair: keypair,
                    publicKey: publicKeyString,
                    privateKey: bs58.encode(keypair.secretKey),
                    attempts: attempts,
                    timeElapsed: Date.now() - startTime
                };

                results.push(result);
                console.log(`✅ Found: ${result.publicKey} (${attempts.toLocaleString()} attempts)`);
            }

            // Safety check per address
            if (attempts > 1000000) {
                console.log(`⏹️  Skipping after 1M attempts for address ${i + 1}`);
                break;
            }
        }
    }

    // Show results
    console.log(`\n🎉 BATCH GENERATION COMPLETE!`);
    console.log("============================");
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        console.log(`\n📍 Address ${i + 1}:`);
        console.log(`   Public:  ${result.publicKey}`);
        console.log(`   Private: ${result.privateKey}`);
        console.log(`   Attempts: ${result.attempts.toLocaleString()}`);
    }

    // Save all results
    if (results.length > 0) {
        const save = prompt("\n💾 Save all addresses to file? (y/n): ").toLowerCase();
        if (save === 'y' || save === 'yes') {
            await saveBatchVanityAddresses(results, pattern, isPrefix);
        }
    }
}

// ✅ DIFFICULTY CALCULATOR (updated for suffix support)
export async function calculateVanityDifficulty() {
    console.log("📊 VANITY ADDRESS DIFFICULTY CALCULATOR");
    console.log("=======================================");
    
    console.log("📋 Pattern Types:");
    console.log("1. Starts with (prefix)");
    console.log("2. Ends with (suffix)");
    console.log("3. Quick check: 'pump' ending");
    
    const choice = prompt("🎯 Choose pattern type (1/2/3): ");
    
    let pattern: string;
    let isPrefix: boolean;
    
    if (choice === "3") {
        pattern = "pump";
        isPrefix = false;
    } else if (choice === "1") {
        pattern = prompt("🎯 Enter prefix to check: ");
        isPrefix = true;
    } else if (choice === "2") {
        pattern = prompt("🎯 Enter suffix to check: ");
        isPrefix = false;
    } else {
        console.log("❌ Invalid choice!");
        return;
    }
    
    if (!pattern) {
        console.log("❌ Invalid pattern!");
        return;
    }

    const difficulty = Math.pow(58, pattern.length);
    const avgAttempts = difficulty / 2;
    
    // Estimate time based on typical generation rate (100k/sec)
    const estimatedSeconds = avgAttempts / 100000;
    const estimatedMinutes = estimatedSeconds / 60;
    const estimatedHours = estimatedMinutes / 60;
    const estimatedDays = estimatedHours / 24;

    console.log(`\n📊 DIFFICULTY ANALYSIS FOR: "${pattern}" (${isPrefix ? 'prefix' : 'suffix'})`);
    console.log("=====================================");
    console.log(`🎯 Pattern length: ${pattern.length} characters`);
    console.log(`🔢 Total possibilities: ${difficulty.toLocaleString()}`);
    console.log(`📈 Average attempts needed: ${avgAttempts.toLocaleString()}`);
    console.log(`\n⏱️  ESTIMATED TIME (at 100k attempts/sec):`);
    console.log(`   Seconds: ${estimatedSeconds.toLocaleString()}`);
    console.log(`   Minutes: ${estimatedMinutes.toFixed(1)}`);
    console.log(`   Hours: ${estimatedHours.toFixed(1)}`);
    console.log(`   Days: ${estimatedDays.toFixed(1)}`);

    console.log(`\n💡 RECOMMENDATIONS:`);
    if (pattern.length <= 2) {
        console.log("   ✅ Very fast - should find in seconds/minutes");
    } else if (pattern.length <= 3) {
        console.log("   ⚠️  Moderate - may take several minutes");
    } else if (pattern.length <= 4) {
        console.log("   🔥 Difficult - could take hours");
        if (pattern.toLowerCase() === "pump") {
            console.log("   🚀 But worth it for pump.fun launches!");
        }
    } else {
        console.log("   🚫 Very difficult - could take days/weeks");
        console.log("   💡 Consider using a shorter pattern");
    }
    
    if (choice === "3") {
        console.log(`\n🎯 PUMP.FUN SPECIAL:`);
        console.log(`   Perfect for pump.fun token launches!`);
        console.log(`   Address ending in 'pump' = instant branding recognition`);
        console.log(`   Worth the wait for marketing value! 🚀`);
    }
}

// ✅ SAVE VANITY ADDRESS TO FILE (updated)
async function saveVanityAddress(result: VanityResult, pattern: string, isPrefix: boolean) {
    const vanityData = {
        timestamp: new Date().toISOString(),
        pattern: pattern,
        type: isPrefix ? "prefix" : "suffix",
        publicKey: result.publicKey,
        privateKey: result.privateKey,
        attempts: result.attempts,
        timeElapsed: result.timeElapsed,
        rate: Math.floor(result.attempts / (result.timeElapsed / 1000))
    };

    const typeStr = isPrefix ? "prefix" : "suffix";
    const filename = `vanity_${typeStr}_${pattern}_${Date.now()}.json`;
    const filepath = path.join(__dirname, filename);

    try {
        fs.writeFileSync(filepath, JSON.stringify(vanityData, null, 2));
        console.log(`✅ Vanity address saved to: ${filepath}`);
    } catch (error) {
        console.error("❌ Failed to save file:", error);
    }
}

// ✅ SAVE BATCH RESULTS (updated)
async function saveBatchVanityAddresses(results: VanityResult[], pattern: string, isPrefix: boolean) {
    const batchData = {
        timestamp: new Date().toISOString(),
        pattern: pattern,
        type: isPrefix ? "prefix" : "suffix",
        count: results.length,
        addresses: results.map(result => ({
            publicKey: result.publicKey,
            privateKey: result.privateKey,
            attempts: result.attempts
        }))
    };

    const typeStr = isPrefix ? "prefix" : "suffix";
    const filename = `vanity_batch_${typeStr}_${pattern}_${Date.now()}.json`;
    const filepath = path.join(__dirname, filename);

    try {
        fs.writeFileSync(filepath, JSON.stringify(batchData, null, 2));
        console.log(`✅ Batch vanity addresses saved to: ${filepath}`);
    } catch (error) {
        console.error("❌ Failed to save file:", error);
    }
}

// ✅ UPDATE KEYINFO WITH VANITY ADDRESS
async function updateKeyInfoWithVanity(result: VanityResult) {
    const keyInfoPath = path.join(__dirname, "keyInfo.json");
    
    try {
        let keyInfo: any = {};
        if (fs.existsSync(keyInfoPath)) {
            const data = fs.readFileSync(keyInfoPath, "utf-8");
            keyInfo = JSON.parse(data);
        }

        // Update with vanity mint
        keyInfo.mint = result.publicKey;
        keyInfo.mintPk = result.privateKey;
        keyInfo.vanityGenerated = true;
        keyInfo.vanityInfo = {
            address: result.publicKey,
            type: result.publicKey.endsWith("pump") ? "pump_suffix" : "custom",
            generated: new Date().toISOString()
        };

        fs.writeFileSync(keyInfoPath, JSON.stringify(keyInfo, null, 2));
        console.log(`✅ Updated keyInfo.json with vanity address`);
        console.log(`🪙 Next token launch will use: ${result.publicKey}`);
        
        if (result.publicKey.endsWith("pump")) {
            console.log(`🚀 Perfect for pump.fun - your token will have maximum branding impact!`);
        }
    } catch (error) {
        console.error("❌ Failed to update keyInfo.json:", error);
    }
}