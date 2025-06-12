// src/telegram-handlers.ts
import TelegramBot from 'node-telegram-bot-api';
import { createKeypairs } from "./createKeys";
import { buyBundle } from "./jitoPool";
import { createLUT, extendLUT } from "./createLUT";
import { unifiedSellFunction } from "./sellFunc";
import { sellAllTokensAndCleanup } from "./sellall";
import { exportAllWallets, checkAllWalletBalances } from "./exportWallets";
import { unifiedBuyFunction } from "./buyFunc";
import { generateVanityAddress, generateMultipleVanityAddresses, calculateVanityDifficulty } from "./vanity";
import fs from "fs";
import path from "path";

// Telegram bot instance (passed from main bot file)
let botInstance: TelegramBot;
let currentChatId: number;

// Input simulation class to replace prompt-sync
class TelegramPrompt {
    private responses: string[] = [];
    private currentIndex = 0;
    private chatId: number;
    private bot: TelegramBot;
    private pendingPromises: Array<{ resolve: (value: string) => void; reject: (reason?: any) => void }> = [];
    
    constructor(bot: TelegramBot, chatId: number) {
        this.bot = bot;
        this.chatId = chatId;
    }
    
    // Store user responses for sequential processing
    addResponse(response: string) {
        this.responses.push(response);
        if (this.pendingPromises.length > 0) {
            const { resolve } = this.pendingPromises.shift()!;
            resolve(response);
        }
    }
    
    // Simulate prompt-sync behavior with proper signature
    prompt(message?: string, _default?: string): string | null {
        // For Telegram, we need to make this synchronous by using pre-stored responses
        if (this.responses.length > this.currentIndex) {
            return this.responses[this.currentIndex++];
        }
        
        // If no response available, return default or empty string
        return _default || '';
    }
    
    // Async version for when we need to actually prompt via Telegram
    async promptAsync(message: string): Promise<string> {
        await this.bot.sendMessage(this.chatId, `💬 ${message}`);
        
        return new Promise((resolve, reject) => {
            if (this.responses.length > this.currentIndex) {
                resolve(this.responses[this.currentIndex++]);
            } else {
                this.pendingPromises.push({ resolve, reject });
            }
        });
    }
}

// Global prompt instance
let telegramPrompt: TelegramPrompt;

// Store original prompt function
let originalPrompt: any;

// Initialize handlers
export function initTelegramHandlers(bot: TelegramBot) {
    botInstance = bot;
}

// Helper function to setup Telegram prompt
function setupTelegramPrompt(chatId: number, responses: string[] = []) {
    telegramPrompt = new TelegramPrompt(botInstance, chatId);
    responses.forEach(response => telegramPrompt.addResponse(response));
    
    // Store original and replace with our version
    const promptSync = require('prompt-sync');
    originalPrompt = promptSync();
    
    // Replace global prompt with our Telegram version
    const mockPrompt = (message?: string, _default?: string): string | null => {
        return telegramPrompt.prompt(message, _default);
    };
    
    // Replace in multiple possible locations
    (global as any).prompt = mockPrompt;
    (global as any).promptSync = () => mockPrompt;
    
    // Also replace the require cache
    const Module = require('module');
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function(id: string) {
        if (id === 'prompt-sync') {
            return () => mockPrompt;
        }
        return originalRequire.apply(this, arguments);
    };
    
    return mockPrompt;
}

// Helper function to restore original prompt
function restoreOriginalPrompt() {
    if (originalPrompt) {
        (global as any).prompt = originalPrompt;
        (global as any).promptSync = require('prompt-sync');
    }
    
    // Restore require
    const Module = require('module');
    delete Module.prototype.require;
}

// Create Keypairs handler for Telegram
export async function handleCreateKeypairsFlow(chatId: number, userChoice: string): Promise<void> {
    try {
        await botInstance.sendMessage(chatId, '🔄 Starting keypair creation process...');
        
        // Setup prompt with the user's choice
        const responses = [userChoice === 'create' ? 'c' : 'u'];
        setupTelegramPrompt(chatId, responses);
        
        // Call the original function
        await createKeypairs();
        
        await botInstance.sendMessage(chatId, '✅ Keypair operation completed!');
        
    } catch (error) {
        await botInstance.sendMessage(chatId, `❌ Error in keypair creation: ${error}`);
    } finally {
        restoreOriginalPrompt();
    }
}

// Buy Bundle handler - requires multiple inputs
export async function handleBuyBundleFlow(chatId: number): Promise<void> {
    const keyInfoPath = path.join(__dirname, "keyInfo.json");
    
    try {
        // Check prerequisites
        if (!fs.existsSync(keyInfoPath)) {
            await botInstance.sendMessage(chatId, 
                '❌ *ERROR: No keyInfo\\.json found\\!*\n\n' +
                'Please complete the Pre Launch Checklist first:\n' +
                '1\\. Create LUT\n' +
                '2\\. Extend LUT Bundle\n' +
                '3\\. Simulate Buys\n' +
                '4\\. Send Simulation SOL Bundle', 
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }
        
        const keyInfo = JSON.parse(fs.readFileSync(keyInfoPath, "utf-8"));
        
        if (!keyInfo.addressLUT || !keyInfo.mintPk) {
            await botInstance.sendMessage(chatId, 
                '❌ *ERROR: Missing LUT or mint in keyInfo\\!*\n\n' +
                'Please run the Pre Launch Checklist first\\.', 
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }
        
        await botInstance.sendMessage(chatId, 
            '🚀 *PUMP\\.FUN BUNDLER READY*\n\n' +
            '📋 *Next steps:*\n' +
            '1\\. Prepare your token metadata\n' +
            '2\\. Add your image to \\./img folder\n' +
            '3\\. Use the console version for the actual launch\n\n' +
            '⚠️ *Note:* Token creation requires interactive metadata input\n' +
            'and file operations that are best done via console\\.\n\n' +
            '💡 *Recommendation:* Use console for launch, Telegram for monitoring\\.', 
            { parse_mode: 'MarkdownV2' }
        );
        
    } catch (error) {
        await botInstance.sendMessage(chatId, `❌ Error checking bundle readiness: ${error}`);
    }
}

// Sell Function handler with user input collection
export async function handleSellFlow(chatId: number, inputs: string[]): Promise<void> {
    try {
        await botInstance.sendMessage(chatId, '🔄 Processing sell request...');
        
        // Setup prompt with all user inputs
        setupTelegramPrompt(chatId, inputs);
        
        // Call the unified sell function
        await unifiedSellFunction();
        
        await botInstance.sendMessage(chatId, '✅ Sell operation completed!');
        
    } catch (error) {
        await botInstance.sendMessage(chatId, `❌ Error in sell operation: ${error}`);
    } finally {
        restoreOriginalPrompt();
    }
}

// Buy Function handler
export async function handleBuyFlow(chatId: number, inputs: string[]): Promise<void> {
    try {
        await botInstance.sendMessage(chatId, '🔄 Processing buy request...');
        
        setupTelegramPrompt(chatId, inputs);
        
        await unifiedBuyFunction();
        
        await botInstance.sendMessage(chatId, '✅ Buy operation completed!');
        
    } catch (error) {
        await botInstance.sendMessage(chatId, `❌ Error in buy operation: ${error}`);
    } finally {
        restoreOriginalPrompt();
    }
}

// Cleanup handler
export async function handleCleanupFlow(chatId: number, inputs: string[]): Promise<void> {
    try {
        await botInstance.sendMessage(chatId, 
            '⚠️ *STARTING WALLET CLEANUP*\n\n' +
            '🧹 This will sell all tokens and return SOL to payer wallet\\.\n' +
            '⏳ This may take several minutes\\.\\.\\.', 
            { parse_mode: 'MarkdownV2' }
        );
        
        setupTelegramPrompt(chatId, inputs);
        
        await sellAllTokensAndCleanup();
        
        await botInstance.sendMessage(chatId, '✅ Cleanup operation completed!');
        
    } catch (error) {
        await botInstance.sendMessage(chatId, `❌ Error in cleanup operation: ${error}`);
    } finally {
        restoreOriginalPrompt();
    }
}

// Check balances (read-only, safe for Telegram)
export async function handleCheckBalances(chatId: number): Promise<void> {
    try {
        await botInstance.sendMessage(chatId, '💰 Checking all wallet balances...');
        
        // Capture console output
        const originalLog = console.log;
        let output = '';
        
        console.log = (...args: any[]) => {
            output += args.join(' ') + '\n';
            originalLog(...args);
        };
        
        await checkAllWalletBalances();
        
        // Restore console.log
        console.log = originalLog;
        
        // Escape special characters for MarkdownV2
        const escapedOutput = output.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
        
        // Send the captured output
        if (escapedOutput.length > 4000) {
            // Split large outputs
            const chunks = escapedOutput.match(/.{1,4000}/g) || [];
            for (const chunk of chunks) {
                await botInstance.sendMessage(chatId, `\`\`\`\n${chunk}\n\`\`\``, { parse_mode: 'MarkdownV2' });
            }
        } else {
            await botInstance.sendMessage(chatId, `\`\`\`\n${escapedOutput}\n\`\`\``, { parse_mode: 'MarkdownV2' });
        }
        
    } catch (error) {
        await botInstance.sendMessage(chatId, `❌ Error checking balances: ${error}`);
    }
}

// Vanity address generation with progress updates
export async function handleVanityGeneration(
    chatId: number, 
    pattern: string, 
    isPrefix: boolean,
    progressCallback?: (attempts: number, timeElapsed: number) => void
): Promise<void> {
    try {
        await botInstance.sendMessage(chatId, 
            `🔍 *STARTING VANITY SEARCH*\n\n` +
            `🎯 Pattern: "${pattern}" \\(${isPrefix ? 'prefix' : 'suffix'}\\)\n` +
            `⏳ This may take a while\\.\\.\\.\n\n` +
            `💡 You'll receive updates every 30 seconds\\.`,
            { parse_mode: 'MarkdownV2' }
        );
        
        let totalAttempts = 0;
        const startTime = Date.now();
        
        // Progress update interval
        const progressInterval = setInterval(async () => {
            const elapsed = Date.now() - startTime;
            const rate = Math.floor(totalAttempts / (elapsed / 1000));
            
            await botInstance.sendMessage(chatId, 
                `🔄 *SEARCH PROGRESS*\n` +
                `⏱️ Time: ${Math.floor(elapsed / 1000)}s\n` +
                `🔢 Attempts: ${totalAttempts.toLocaleString()}\n` +
                `🚀 Rate: ${rate.toLocaleString()}/s`,
                { parse_mode: 'MarkdownV2' }
            );
        }, 30000);
        
        // For now, show a message about using console
        setTimeout(async () => {
            clearInterval(progressInterval);
            await botInstance.sendMessage(chatId, 
                '⚠️ *VANITY GENERATION NOTICE*\n\n' +
                'Vanity address generation is CPU\\-intensive and may take hours\\.\n' +
                'For the best experience, please use the console version\\.\n\n' +
                '💡 The console version provides real\\-time progress and better error handling\\.',
                { parse_mode: 'MarkdownV2' }
            );
        }, 5000);
        
    } catch (error) {
        await botInstance.sendMessage(chatId, `❌ Error in vanity generation: ${error}`);
    }
}

// Pre-launch checklist handlers
export async function handleCreateLUT(chatId: number, tipAmount: string): Promise<void> {
    try {
        await botInstance.sendMessage(chatId, '🔗 Creating Lookup Table...');
        
        setupTelegramPrompt(chatId, [tipAmount]);
        
        await createLUT();
        
        await botInstance.sendMessage(chatId, '✅ Lookup Table created successfully!');
        
    } catch (error) {
        await botInstance.sendMessage(chatId, `❌ Error creating LUT: ${error}`);
    } finally {
        restoreOriginalPrompt();
    }
}

export async function handleExtendLUT(chatId: number, inputs: string[]): Promise<void> {
    try {
        await botInstance.sendMessage(chatId, '📦 Extending Lookup Table...');
        
        setupTelegramPrompt(chatId, inputs);
        
        await extendLUT();
        
        await botInstance.sendMessage(chatId, '✅ Lookup Table extended successfully!');
        
    } catch (error) {
        await botInstance.sendMessage(chatId, `❌ Error extending LUT: ${error}`);
    } finally {
        restoreOriginalPrompt();
    }
}

// Simple console interaction handler (for functions that need console)
export async function handleConsoleFunction(chatId: number, functionName: string): Promise<void> {
    await botInstance.sendMessage(chatId, 
        `⚠️ *${functionName.toUpperCase()}*\n\n` +
        'This function requires console interaction for security and complexity\\.\n\n' +
        `💡 *Steps:*\n` +
        `1\\. Open your terminal\n` +
        `2\\. Run: npm run console\n` +
        `3\\. Select the appropriate option\n` +
        `4\\. Follow the interactive prompts\n\n` +
        `🔒 *Security:* Critical operations use console for maximum safety\\.`,
        { parse_mode: 'MarkdownV2' }
    );
}

// Utility function to split long messages
export function splitMessage(text: string, maxLength: number = 4000): string[] {
    if (text.length <= maxLength) return [text];
    
    const chunks: string[] = [];
    let currentChunk = '';
    
    const lines = text.split('\n');
    
    for (const line of lines) {
        if (currentChunk.length + line.length + 1 <= maxLength) {
            currentChunk += (currentChunk ? '\n' : '') + line;
        } else {
            if (currentChunk) chunks.push(currentChunk);
            currentChunk = line;
        }
    }
    
    if (currentChunk) chunks.push(currentChunk);
    
    return chunks;
}

// Function to capture and send console output to Telegram
export function captureConsoleOutput(chatId: number, operation: () => Promise<void>): Promise<void> {
    return new Promise(async (resolve, reject) => {
        const originalLog = console.log;
        const originalError = console.error;
        let output = '';
        
        console.log = (...args: any[]) => {
            const message = args.join(' ');
            output += message + '\n';
            originalLog(...args);
            
            // Send important messages immediately
            if (message.includes('✅') || message.includes('❌') || message.includes('Bundle')) {
                botInstance.sendMessage(chatId, message.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&'), { parse_mode: 'MarkdownV2' });
            }
        };
        
        console.error = (...args: any[]) => {
            const message = args.join(' ');
            output += `ERROR: ${message}\n`;
            originalError(...args);
            botInstance.sendMessage(chatId, `❌ ${message}`, { parse_mode: 'MarkdownV2' });
        };
        
        try {
            await operation();
            
            // Send final output
            const chunks = splitMessage(output);
            for (const chunk of chunks) {
                const escapedChunk = chunk.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
                await botInstance.sendMessage(chatId, `\`\`\`\n${escapedChunk}\n\`\`\``, { parse_mode: 'MarkdownV2' });
            }
            
            resolve();
        } catch (error) {
            reject(error);
        } finally {
            // Restore original console methods
            console.log = originalLog;
            console.error = originalError;
        }
    });
}

export default {
    initTelegramHandlers,
    handleCreateKeypairsFlow,
    handleBuyBundleFlow,
    handleSellFlow,
    handleBuyFlow,
    handleCleanupFlow,
    handleCheckBalances,
    handleVanityGeneration,
    handleCreateLUT,
    handleExtendLUT,
    handleConsoleFunction,
    captureConsoleOutput,
    splitMessage
};