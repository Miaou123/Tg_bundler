// telegram-main.ts
import TelegramBot, { KeyboardButton, SendMessageOptions } from 'node-telegram-bot-api';
import * as dotenv from 'dotenv';
import { createKeypairs } from "./src/createKeys";
import { buyBundle } from "./src/jitoPool";
import { createLUT, extendLUT } from "./src/createLUT";
import { unifiedSellFunction } from "./src/sellFunc";
import { sellAllTokensAndCleanup } from "./src/sellall";
import { exportAllWallets, checkAllWalletBalances } from "./src/exportWallets";
import { unifiedBuyFunction } from "./src/buyFunc";
import { generateVanityAddress, generateMultipleVanityAddresses, calculateVanityDifficulty } from "./src/vanity";

// Load environment variables
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AUTHORIZED_USERS = process.env.AUTHORIZED_TELEGRAM_USERS?.split(',').map(id => parseInt(id)) || [];

if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN environment variable is required');
    console.log('Add this to your .env file:');
    console.log('TELEGRAM_BOT_TOKEN=your_bot_token_here');
    console.log('AUTHORIZED_TELEGRAM_USERS=your_user_id_1,your_user_id_2');
    process.exit(1);
}

// User sessions to track multi-step processes
interface UserSession {
    currentFunction?: string;
    step?: number;
    data?: any;
    waitingFor?: string;
    inputs?: string[];
}

const userSessions: Map<number, UserSession> = new Map();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Helper functions
function isAuthorized(userId: number): boolean {
    return AUTHORIZED_USERS.length === 0 || AUTHORIZED_USERS.includes(userId);
}

function getUserSession(userId: number): UserSession {
    if (!userSessions.has(userId)) {
        userSessions.set(userId, {});
    }
    return userSessions.get(userId)!;
}

function clearUserSession(userId: number) {
    userSessions.delete(userId);
}

// Fixed keyboard layouts with proper types
const mainMenuKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '🔑 Create Keypairs' }, { text: '📋 Pre Launch' }],
            [{ text: '🚀 Create Pool' }, { text: '💰 Sell Tokens' }],
            [{ text: '💸 Buy Tokens' }, { text: '🧹 Cleanup All' }],
            [{ text: '📊 Export Wallets' }, { text: '💰 Check Balances' }],
            [{ text: '🎯 Vanity Address' }, { text: '📊 Vanity Calc' }],
            [{ text: '❌ Exit' }]
        ] as KeyboardButton[][],
        resize_keyboard: true,
        one_time_keyboard: false
    }
};

const preLaunchKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '🔗 Create LUT' }, { text: '📦 Extend LUT' }],
            [{ text: '🎲 Simulate Buys' }, { text: '💸 Send SOL' }],
            [{ text: '💰 Reclaim SOL' }, { text: '🔙 Main Menu' }]
        ] as KeyboardButton[][],
        resize_keyboard: true,
        one_time_keyboard: false
    }
};

const keypairKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '📝 Create New' }, { text: '📁 Use Existing' }],
            [{ text: '🔙 Main Menu' }]
        ] as KeyboardButton[][],
        resize_keyboard: true,
        one_time_keyboard: true
    }
};

// Menu functions
async function showMainMenu(chatId: number, messageText?: string) {
    const text = messageText || `
🤖 **PUMP.FUN BUNDLER BOT**
========================

🔑 **Create Keypairs** - Generate wallet keypairs
📋 **Pre Launch** - Setup checklist
🚀 **Create Pool** - Launch your token  
💰 **Sell Tokens** - Sell on any platform
💸 **Buy Tokens** - Buy tokens smartly
🧹 **Cleanup All** - Clean all wallets
📊 **Export Wallets** - Export keys (console only)
💰 **Check Balances** - Quick balance check
🎯 **Vanity Address** - Generate custom address
📊 **Vanity Calc** - Check difficulty
❌ **Exit** - Close bot session

Choose an option:`;

    const options: SendMessageOptions = {
        parse_mode: 'Markdown',
        ...mainMenuKeyboard
    };

    await bot.sendMessage(chatId, text, options);
}

async function showPreLaunchMenu(chatId: number) {
    const text = `
📋 **PRE LAUNCH CHECKLIST**
=========================

Complete these steps in order:

🔗 **Create LUT** - Create Lookup Table
📦 **Extend LUT** - Add addresses to LUT
🎲 **Simulate Buys** - Configure buy amounts
💸 **Send SOL** - Fund wallets
💰 **Reclaim SOL** - Return unused SOL
🔙 **Main Menu** - Back to main menu

Choose an option:`;

    const options: SendMessageOptions = {
        parse_mode: 'Markdown',
        ...preLaunchKeyboard
    };

    await bot.sendMessage(chatId, text, options);
}

// Command handlers
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    if (!isAuthorized(userId)) {
        await bot.sendMessage(chatId, '❌ You are not authorized to use this bot.');
        return;
    }
    
    clearUserSession(userId);
    
    const welcomeText = `
🎉 **Welcome to Pump.Fun Bundler Bot!**

This bot provides the same functionality as the console bundler but through Telegram.

⚠️ **Security Notice:**
- Keep your private keys secure
- Only use with trusted networks
- Some functions redirect to console for security

🔧 **Setup Requirements:**
- Bundler files properly configured
- .env file with all required variables
- Sufficient SOL in wallets

Ready to start?`;

    await bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' });
    await showMainMenu(chatId);
});

bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    
    const helpText = `
📖 **HELP & COMMANDS**

**Basic Commands:**
/start - Start the bot
/help - Show this help
/status - Check bot status
/cancel - Cancel current operation

**Main Functions:**
🔑 Create Keypairs - Generate up to 24 wallets
📋 Pre Launch - Complete setup checklist  
🚀 Create Pool - Launch token (console recommended)
💰 Sell/Buy - Trade tokens on Pump.fun/PumpSwap
🧹 Cleanup - Sell all tokens and return SOL

**Security:**
- Private operations use console for safety
- Only authorized users can access
- Session data is temporary

**Support:**
For issues, check the console output or contact support.`;

    await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    if (!isAuthorized(userId)) {
        await bot.sendMessage(chatId, '❌ Unauthorized');
        return;
    }
    
    try {
        // Check if keyInfo exists
        const fs = require('fs');
        const path = require('path');
        const keyInfoPath = path.join(__dirname, 'src', 'keyInfo.json');
        
        let statusText = '📊 **BOT STATUS**\n\n';
        
        if (fs.existsSync(keyInfoPath)) {
            const keyInfo = JSON.parse(fs.readFileSync(keyInfoPath, 'utf-8'));
            statusText += '✅ KeyInfo file exists\n';
            statusText += `📁 Wallets: ${keyInfo.numOfWallets || 'Unknown'}\n`;
            statusText += `🔗 LUT: ${keyInfo.addressLUT ? 'Ready' : 'Missing'}\n`;
            statusText += `🪙 Mint: ${keyInfo.mint ? 'Configured' : 'Missing'}\n`;
        } else {
            statusText += '❌ KeyInfo file missing\n';
            statusText += '💡 Run Pre Launch Checklist first\n';
        }
        
        statusText += `\n👤 User ID: ${userId}`;
        statusText += `\n🤖 Bot: Online`;
        
        await bot.sendMessage(chatId, statusText, { parse_mode: 'Markdown' });
        
    } catch (error) {
        await bot.sendMessage(chatId, `❌ Status check error: ${error}`);
    }
});

bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    clearUserSession(userId);
    await bot.sendMessage(chatId, '✅ Operation cancelled. Returning to main menu.');
    await showMainMenu(chatId);
});

// Main message handler
bot.on('message', async (msg) => {
    if (msg.text?.startsWith('/')) return; // Skip commands
    
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    const text = msg.text || '';
    
    if (!isAuthorized(userId)) {
        await bot.sendMessage(chatId, '❌ Unauthorized');
        return;
    }
    
    const session = getUserSession(userId);
    
    try {
        // Handle active sessions with input waiting
        if (session.waitingFor) {
            await handleSessionInput(chatId, userId, text, session);
            return;
        }
        
        // Handle menu selections
        switch (text) {
            case '🔑 Create Keypairs':
                const options: SendMessageOptions = {
                    parse_mode: 'Markdown',
                    ...keypairKeyboard
                };
                await bot.sendMessage(chatId, 
                    '🔑 **Create Keypairs**\n\n' +
                    '⚠️ **WARNING:** Creating new wallets will replace existing ones!\n' +
                    'Ensure you don\'t have SOL in existing wallets.\n\n' +
                    'Choose an option:',
                    options
                );
                session.currentFunction = 'keypairs';
                break;
                
            case '📝 Create New':
                if (session.currentFunction === 'keypairs') {
                    await handleCreateKeypairs(chatId, 'create');
                }
                break;
                
            case '📁 Use Existing':
                if (session.currentFunction === 'keypairs') {
                    await handleCreateKeypairs(chatId, 'use');
                }
                break;
                
            case '📋 Pre Launch':
                await showPreLaunchMenu(chatId);
                break;
                
            case '🔗 Create LUT':
                session.currentFunction = 'createLUT';
                session.waitingFor = 'jito_tip';
                await bot.sendMessage(chatId, '💰 Enter Jito tip amount in SOL (e.g., 0.01):');
                break;
                
            case '📦 Extend LUT':
                session.currentFunction = 'extendLUT';
                session.step = 0;
                session.inputs = [];
                session.waitingFor = 'vanity_choice';
                await bot.sendMessage(chatId, 
                    '🎯 Do you want to import a custom vanity address? (y/n):'
                );
                break;
                
            case '🎲 Simulate Buys':
                await bot.sendMessage(chatId, 
                    '🎲 **Simulate Buys**\n\n' +
                    '⚠️ This function requires interactive wallet configuration.\n' +
                    'Please use the console version for buy simulation.\n\n' +
                    '💡 Console: npm start → option 2 → option 3'
                );
                break;
                
            case '💸 Send SOL':
                session.currentFunction = 'sendSOL';
                session.waitingFor = 'jito_tip';
                await bot.sendMessage(chatId, '💰 Enter Jito tip amount in SOL (e.g., 0.01):');
                break;
                
            case '💰 Reclaim SOL':
                session.currentFunction = 'reclaimSOL';
                session.waitingFor = 'jito_tip';
                await bot.sendMessage(chatId, '💰 Enter Jito tip amount in SOL (e.g., 0.01):');
                break;
                
            case '🚀 Create Pool':
                await handleCreatePool(chatId);
                break;
                
            case '💰 Sell Tokens':
                await handleSellTokens(chatId);
                break;
                
            case '💸 Buy Tokens':
                await handleBuyTokens(chatId);
                break;
                
            case '🧹 Cleanup All':
                await handleCleanupAll(chatId);
                break;
                
            case '📊 Export Wallets':
                await bot.sendMessage(chatId, 
                    '📊 **Export Wallets**\n\n' +
                    '⚠️ **SECURITY WARNING**\n' +
                    'Wallet export contains private keys and should not be done via Telegram.\n\n' +
                    '🔒 Use console version: npm start → option 7\n\n' +
                    'This ensures your keys remain secure.'
                );
                break;
                
            case '💰 Check Balances':
                await handleCheckBalances(chatId);
                break;
                
            case '🎯 Vanity Address':
                await handleVanityAddress(chatId);
                break;
                
            case '📊 Vanity Calc':
                session.currentFunction = 'vanityCalc';
                session.waitingFor = 'vanity_pattern';
                await bot.sendMessage(chatId, 
                    '📊 **Vanity Difficulty Calculator**\n\n' +
                    'Enter a pattern to check its difficulty:\n\n' +
                    'Examples: "ABC", "pump", "123"\n\n' +
                    'Enter pattern:'
                );
                break;
                
            case '🔙 Main Menu':
                clearUserSession(userId);
                await showMainMenu(chatId);
                break;
                
            case '❌ Exit':
                clearUserSession(userId);
                await bot.sendMessage(chatId, '👋 Session ended. Use /start to begin again.');
                break;
                
            default:
                await bot.sendMessage(chatId, '❓ Please select an option from the menu.');
                break;
        }
        
    } catch (error) {
        console.error('Error handling message:', error);
        await bot.sendMessage(chatId, `❌ Error: ${error}`);
        clearUserSession(userId);
        await showMainMenu(chatId);
    }
});

// Session input handler
async function handleSessionInput(chatId: number, userId: number, input: string, session: UserSession) {
    const { currentFunction, waitingFor, step } = session;
    
    try {
        switch (waitingFor) {
            case 'jito_tip':
                const tipAmount = parseFloat(input);
                if (isNaN(tipAmount) || tipAmount <= 0) {
                    await bot.sendMessage(chatId, '❌ Invalid tip amount. Please enter a valid number (e.g., 0.01):');
                    return;
                }
                
                session.waitingFor = undefined;
                
                if (currentFunction === 'createLUT') {
                    await handleCreateLUTWithTip(chatId, input);
                } else if (currentFunction === 'sendSOL') {
                    await handleSendSOLWithTip(chatId, input);
                } else if (currentFunction === 'reclaimSOL') {
                    await handleReclaimSOLWithTip(chatId, input);
                }
                break;
                
            case 'vanity_choice':
                session.inputs = session.inputs || [];
                session.inputs.push(input.toLowerCase());
                
                if (input.toLowerCase() === 'y' || input.toLowerCase() === 'yes') {
                    session.waitingFor = 'vanity_private_key';
                    await bot.sendMessage(chatId, '🔑 Enter the private key of the vanity address (bs58):');
                } else {
                    session.waitingFor = 'jito_tip';
                    await bot.sendMessage(chatId, '💰 Enter Jito tip amount in SOL (e.g., 0.01):');
                }
                break;
                
            case 'vanity_private_key':
                session.inputs = session.inputs || [];
                session.inputs.push(input);
                session.waitingFor = 'jito_tip';
                await bot.sendMessage(chatId, '💰 Enter Jito tip amount in SOL (e.g., 0.01):');
                break;
                
            case 'vanity_pattern':
                if (currentFunction === 'vanityCalc') {
                    await handleVanityDifficultyCalc(chatId, input);
                    session.waitingFor = undefined;
                }
                break;
                
            default:
                session.waitingFor = undefined;
                await bot.sendMessage(chatId, '❓ Unexpected input. Returning to main menu.');
                await showMainMenu(chatId);
                break;
        }
        
    } catch (error) {
        console.error('Error handling session input:', error);
        await bot.sendMessage(chatId, `❌ Input error: ${error}`);
        clearUserSession(userId);
        await showMainMenu(chatId);
    }
}

// Individual function handlers
async function handleCreateKeypairs(chatId: number, choice: string) {
    try {
        await bot.sendMessage(chatId, '🔄 Starting keypair creation...');
        
        if (choice === 'create') {
            // Simulate creating new keypairs
            await createKeypairs();
        }
        
        await bot.sendMessage(chatId, '✅ Keypair operation completed!');
        await showMainMenu(chatId);
    } catch (error) {
        await bot.sendMessage(chatId, `❌ Keypair error: ${error}`);
        await showMainMenu(chatId);
    }
}

async function handleCreateLUTWithTip(chatId: number, tipAmount: string) {
    try {
        await bot.sendMessage(chatId, '🔗 Creating Lookup Table...');
        
        // This would need to be adapted to work with Telegram input
        await bot.sendMessage(chatId, 
            '⚠️ LUT creation requires console interaction.\n' +
            'Please use: npm run console → option 2 → option 1'
        );
        
        await showPreLaunchMenu(chatId);
    } catch (error) {
        await bot.sendMessage(chatId, `❌ Create LUT error: ${error}`);
        await showPreLaunchMenu(chatId);
    }
}

async function handleSendSOLWithTip(chatId: number, tipAmount: string) {
    await bot.sendMessage(chatId, 
        '💸 **Send SOL Bundle**\n\n' +
        '⚠️ This function funds wallets based on simulation data.\n' +
        'Please use the console version for safety.\n\n' +
        '💡 Console: npm run console → option 2 → option 4'
    );
    await showPreLaunchMenu(chatId);
}

async function handleReclaimSOLWithTip(chatId: number, tipAmount: string) {
    await bot.sendMessage(chatId, 
        '💰 **Reclaim SOL**\n\n' +
        '⚠️ This function returns SOL from all wallets.\n' +
        'Please use the console version for safety.\n\n' +
        '💡 Console: npm run console → option 2 → option 5'
    );
    await showPreLaunchMenu(chatId);
}

async function handleCreatePool(chatId: number) {
    await bot.sendMessage(chatId, 
        '🚀 **Create Pool Bundle**\n\n' +
        '⚠️ **IMPORTANT:** Token creation requires:\n' +
        '• Interactive metadata input\n' +
        '• Image file management\n' +
        '• Real-time transaction monitoring\n\n' +
        '🔒 **Security:** Use console for token launches\n\n' +
        '💡 **Steps:**\n' +
        '1. Complete Pre Launch Checklist\n' +
        '2. Add token image to ./img folder\n' +
        '3. Run: npm run console → option 3\n\n' +
        '📊 Use Telegram for monitoring and post-launch operations.'
    );
    await showMainMenu(chatId);
}

async function handleSellTokens(chatId: number) {
    await bot.sendMessage(chatId, 
        '💰 **Sell Tokens**\n\n' +
        '⚠️ **IMPORTANT:** Selling requires:\n' +
        '• Wallet selection\n' +
        '• Platform detection (Pump.fun/PumpSwap)\n' +
        '• Real-time price calculations\n\n' +
        '🔒 **Security:** Use console for token sales\n\n' +
        '💡 **Steps:**\n' +
        '1. Run: npm run console → option 4\n' +
        '2. Follow interactive prompts\n' +
        '3. Monitor transactions\n\n' +
        '📊 Check balances here after selling.'
    );
    await showMainMenu(chatId);
}

async function handleBuyTokens(chatId: number) {
    await bot.sendMessage(chatId, 
        '💸 **Buy Tokens**\n\n' +
        '⚠️ **IMPORTANT:** Buying requires:\n' +
        '• SOL distribution strategy\n' +
        '• Platform detection\n' +
        '• Slippage configuration\n\n' +
        '🔒 **Security:** Use console for token purchases\n\n' +
        '💡 **Steps:**\n' +
        '1. Run: npm run console → option 5\n' +
        '2. Configure buy amounts\n' +
        '3. Execute purchases\n\n' +
        '📊 Check balances here after buying.'
    );
    await showMainMenu(chatId);
}

async function handleCleanupAll(chatId: number) {
    await bot.sendMessage(chatId, 
        '🧹 **Cleanup All Tokens**\n\n' +
        '⚠️ **CRITICAL OPERATION:**\n' +
        '• Sells ALL tokens in ALL wallets\n' +
        '• Transfers SOL to payer wallet\n' +
        '• Cannot be undone\n\n' +
        '🔒 **Security:** Use console for cleanup\n\n' +
        '💡 **Steps:**\n' +
        '1. Run: npm run console → option 6\n' +
        '2. Select wallet cleanup mode\n' +
        '3. Confirm critical operations\n\n' +
        '⚠️ This operation affects real funds!'
    );
    await showMainMenu(chatId);
}

async function handleCheckBalances(chatId: number) {
    try {
        await bot.sendMessage(chatId, '💰 Checking wallet balances...');
        
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
        
        // Send the captured output
        if (output.length > 4000) {
            // Split large outputs
            const chunks = output.match(/.{1,4000}/g) || [];
            for (const chunk of chunks) {
                await bot.sendMessage(chatId, `\`\`\`\n${chunk}\n\`\`\``, { parse_mode: 'Markdown' });
            }
        } else {
            await bot.sendMessage(chatId, `\`\`\`\n${output}\n\`\`\``, { parse_mode: 'Markdown' });
        }
        
        await showMainMenu(chatId);
    } catch (error) {
        await bot.sendMessage(chatId, `❌ Balance check error: ${error}`);
        await showMainMenu(chatId);
    }
}

async function handleVanityAddress(chatId: number) {
    await bot.sendMessage(chatId, 
        '🎯 **Vanity Address Generator**\n\n' +
        '⚠️ **RESOURCE INTENSIVE:**\n' +
        '• Vanity generation uses significant CPU\n' +
        '• Can take hours for long patterns\n' +
        '• Better progress tracking in console\n\n' +
        '💡 **Recommendations:**\n' +
        '• Short patterns (1-3 chars): Use Telegram\n' +
        '• Long patterns (4+ chars): Use console\n' +
        '• Batch generation: Use console only\n\n' +
        '🔧 **Console:** npm run console → option 9\n\n' +
        'Use 📊 Vanity Calc to check difficulty first!'
    );
    await showMainMenu(chatId);
}

async function handleVanityDifficultyCalc(chatId: number, pattern: string) {
    try {
        const difficulty = Math.pow(58, pattern.length);
        const avgAttempts = difficulty / 2;
        const estimatedSeconds = avgAttempts / 100000; // Assuming 100k attempts/sec
        const estimatedMinutes = estimatedSeconds / 60;
        const estimatedHours = estimatedMinutes / 60;
        const estimatedDays = estimatedHours / 24;

        let difficultyText = `📊 **DIFFICULTY ANALYSIS FOR: "${pattern}"**\n\n`;
        difficultyText += `🎯 Pattern length: ${pattern.length} characters\n`;
        difficultyText += `🔢 Total possibilities: ${difficulty.toLocaleString()}\n`;
        difficultyText += `📈 Average attempts: ${avgAttempts.toLocaleString()}\n\n`;
        
        difficultyText += `⏱️ **ESTIMATED TIME (100k attempts/sec):**\n`;
        if (estimatedSeconds < 60) {
            difficultyText += `• ${estimatedSeconds.toFixed(1)} seconds\n`;
        } else if (estimatedMinutes < 60) {
            difficultyText += `• ${estimatedMinutes.toFixed(1)} minutes\n`;
        } else if (estimatedHours < 24) {
            difficultyText += `• ${estimatedHours.toFixed(1)} hours\n`;
        } else {
            difficultyText += `• ${estimatedDays.toFixed(1)} days\n`;
        }
        
        difficultyText += `\n💡 **RECOMMENDATIONS:**\n`;
        if (pattern.length <= 2) {
            difficultyText += `✅ Very fast - should find in seconds/minutes`;
        } else if (pattern.length <= 3) {
            difficultyText += `⚠️ Moderate - may take several minutes`;
        } else if (pattern.length <= 4) {
            difficultyText += `🔥 Difficult - could take hours`;
            if (pattern.toLowerCase() === "pump") {
                difficultyText += `\n🚀 But worth it for pump.fun launches!`;
            }
        } else {
            difficultyText += `🚫 Very difficult - could take days/weeks\n`;
            difficultyText += `💡 Consider using a shorter pattern`;
        }

        await bot.sendMessage(chatId, difficultyText, { parse_mode: 'Markdown' });
        
    } catch (error) {
        await bot.sendMessage(chatId, `❌ Error calculating difficulty: ${error}`);
    }
    
    await showMainMenu(chatId);
}

// Error handling
bot.on('polling_error', (error) => {
    console.error('❌ Telegram polling error:', error);
});

bot.on('error', (error) => {
    console.error('❌ Telegram bot error:', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down Telegram bot...');
    bot.stopPolling();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down Telegram bot...');
    bot.stopPolling();
    process.exit(0);
});

// Start message
console.log('🤖 Pump.Fun Bundler Telegram Bot started!');
console.log('📱 Send /start to your bot to begin');
console.log('🔧 Authorized users:', AUTHORIZED_USERS.length > 0 ? AUTHORIZED_USERS.join(', ') : 'All users');
console.log('⚠️  Remember: Critical operations should use console for security');

export default bot;