// telegram-bot.ts
import TelegramBot, { KeyboardButton, SendMessageOptions } from 'node-telegram-bot-api';
import * as dotenv from 'dotenv';
import { createKeypairs } from "./src/createKeys";
import { buyBundle } from "./src/jitoPool";
import { sender } from "./src/senderUI";
import { unifiedSellFunction } from "./src/sellFunc";
import { sellAllTokensAndCleanup } from "./src/sellall";
import { exportAllWallets, checkAllWalletBalances } from "./src/exportWallets";
import { unifiedBuyFunction } from "./src/buyFunc";
import { generateVanityAddress, generateMultipleVanityAddresses, calculateVanityDifficulty } from "./src/vanity";

// Load environment variables
dotenv.config();

// Environment variables
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AUTHORIZED_USERS = process.env.AUTHORIZED_TELEGRAM_USERS?.split(',').map(id => parseInt(id)) || [];

if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN environment variable is required');
    console.log('Add this to your .env file:');
    console.log('TELEGRAM_BOT_TOKEN=your_bot_token_here');
    console.log('AUTHORIZED_TELEGRAM_USERS=your_user_id_1,your_user_id_2');
    process.exit(1);
}

// User sessions to track state
interface UserSession {
    currentMenu?: string;
    currentFunction?: string;
    waitingForInput?: string;
    inputData?: any;
    step?: number;
}

const userSessions: Map<number, UserSession> = new Map();

// Create bot instance
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Helper function to check authorization
function isAuthorized(userId: number): boolean {
    return AUTHORIZED_USERS.length === 0 || AUTHORIZED_USERS.includes(userId);
}

// Helper function to get user session
function getUserSession(userId: number): UserSession {
    if (!userSessions.has(userId)) {
        userSessions.set(userId, {});
    }
    return userSessions.get(userId)!;
}

// Helper function to send keyboard with proper types
function createMainMenuKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                [{ text: '🔑 Create Keypairs' }, { text: '📋 Pre Launch Checklist' }],
                [{ text: '🚀 Create Pool Bundle' }, { text: '💰 Sell Tokens' }],
                [{ text: '💸 Buy Tokens' }, { text: '🧹 Cleanup All' }],
                [{ text: '📊 Export Wallets' }, { text: '💰 Check Balances' }],
                [{ text: '🎯 Vanity Address' }, { text: '🎯 Batch Vanity' }],
                [{ text: '📊 Vanity Difficulty' }, { text: '❌ Exit' }]
            ] as KeyboardButton[][],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    };
}

function createPreLaunchKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                [{ text: '🔗 Create LUT' }, { text: '📦 Extend LUT Bundle' }],
                [{ text: '🎲 Simulate Buys' }, { text: '💸 Send SOL Bundle' }],
                [{ text: '💰 Reclaim SOL' }, { text: '🔙 Back to Main Menu' }]
            ] as KeyboardButton[][],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    };
}

// Main menu handler
async function showMainMenu(chatId: number) {
    const menuText = `🤖 *PUMP.FUN BUNDLER BOT*
========================

Choose an option from the menu below:

🔑 *Create Keypairs* \\- Generate wallet keypairs
📋 *Pre Launch Checklist* \\- Setup before launch
🚀 *Create Pool Bundle* \\- Launch your token
💰 *Sell Tokens* \\- Sell on Pump\\.fun/PumpSwap
💸 *Buy Tokens* \\- Buy on Pump\\.fun/PumpSwap
🧹 *Cleanup All* \\- Sell all tokens & return SOL
📊 *Export Wallets* \\- Export all wallet keys
💰 *Check Balances* \\- Quick balance check
🎯 *Vanity Address* \\- Generate custom address
🎯 *Batch Vanity* \\- Generate multiple addresses
📊 *Vanity Difficulty* \\- Check difficulty
❌ *Exit* \\- Close the bot`;

    const options: SendMessageOptions = {
        parse_mode: 'MarkdownV2',
        ...createMainMenuKeyboard()
    };
    
    await bot.sendMessage(chatId, menuText, options);
}

// Pre-launch menu handler
async function showPreLaunchMenu(chatId: number) {
    const menuText = `📋 *PRE LAUNCH CHECKLIST*
=========================

Complete these steps before launching:

🔗 *Create LUT* \\- Create Lookup Table
📦 *Extend LUT Bundle* \\- Extend LUT with addresses
🎲 *Simulate Buys* \\- Test buy configurations
💸 *Send SOL Bundle* \\- Fund wallets for launch
💰 *Reclaim SOL* \\- Return unused SOL
🔙 *Back to Main Menu* \\- Return to main menu`;

    const options: SendMessageOptions = {
        parse_mode: 'MarkdownV2',
        ...createPreLaunchKeyboard()
    };

    await bot.sendMessage(chatId, menuText, options);
}

// Start command handler
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    if (!isAuthorized(userId)) {
        await bot.sendMessage(chatId, '❌ You are not authorized to use this bot\\.');
        return;
    }
    
    // Initialize user session
    userSessions.set(userId, {});
    
    const welcomeText = `🎉 *Welcome to Pump\\.Fun Bundler Bot\\!*

This bot provides the same functionality as the console bundler but through Telegram for easier access\\.

⚠️ *Security Notice:*
\\- Never share your private keys
\\- Keep your \\.env file secure
\\- This bot requires your bundler files to be properly configured

Ready to start\\? Choose an option below:`;

    await bot.sendMessage(chatId, welcomeText, { parse_mode: 'MarkdownV2' });
    await showMainMenu(chatId);
});

// Help command
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    if (!isAuthorized(userId)) {
        await bot.sendMessage(chatId, '❌ Unauthorized');
        return;
    }
    
    const helpText = `📖 *HELP & COMMANDS*

*Basic Commands:*
/start \\- Start the bot
/help \\- Show this help
/status \\- Check bot status
/cancel \\- Cancel current operation

*Main Functions:*
🔑 Create Keypairs \\- Generate up to 24 wallets
📋 Pre Launch \\- Complete setup checklist  
🚀 Create Pool \\- Launch token \\(console recommended\\)
💰 Sell/Buy \\- Trade tokens on Pump\\.fun/PumpSwap
🧹 Cleanup \\- Sell all tokens and return SOL

*Security:*
\\- Private operations use console for safety
\\- Only authorized users can access
\\- Session data is temporary`;

    await bot.sendMessage(chatId, helpText, { parse_mode: 'MarkdownV2' });
});

// Status command
bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    if (!isAuthorized(userId)) {
        await bot.sendMessage(chatId, '❌ Unauthorized');
        return;
    }
    
    try {
        const fs = require('fs');
        const path = require('path');
        const keyInfoPath = path.join(__dirname, 'src', 'keyInfo.json');
        
        let statusText = '📊 *BOT STATUS*\n\n';
        
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
        
        await bot.sendMessage(chatId, statusText, { parse_mode: 'MarkdownV2' });
        
    } catch (error) {
        await bot.sendMessage(chatId, `❌ Status check error: ${error}`);
    }
});

// Cancel command
bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    if (!isAuthorized(userId)) {
        await bot.sendMessage(chatId, '❌ Unauthorized');
        return;
    }
    
    userSessions.delete(userId);
    await bot.sendMessage(chatId, '✅ Operation cancelled\\. Returning to main menu\\.', { parse_mode: 'MarkdownV2' });
    await showMainMenu(chatId);
});

// Message handler for menu navigation
bot.on('message', async (msg) => {
    if (msg.text?.startsWith('/')) return; // Skip commands
    
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    const text = msg.text || '';
    
    if (!isAuthorized(userId)) {
        await bot.sendMessage(chatId, '❌ You are not authorized to use this bot\\.');
        return;
    }
    
    const session = getUserSession(userId);
    
    try {
        // Handle input waiting states
        if (session.waitingForInput) {
            await handleUserInput(chatId, userId, text, session);
            return;
        }
        
        // Handle menu selections
        switch (text) {
            case '🔑 Create Keypairs':
                await executeFunction(chatId, userId, 'createKeypairs');
                break;
                
            case '📋 Pre Launch Checklist':
                session.currentMenu = 'preLaunch';
                await showPreLaunchMenu(chatId);
                break;
                
            case '🚀 Create Pool Bundle':
                await executeFunction(chatId, userId, 'buyBundle');
                break;
                
            case '💰 Sell Tokens':
                await executeFunction(chatId, userId, 'unifiedSellFunction');
                break;
                
            case '💸 Buy Tokens':
                await executeFunction(chatId, userId, 'unifiedBuyFunction');
                break;
                
            case '🧹 Cleanup All':
                await executeFunction(chatId, userId, 'sellAllTokensAndCleanup');
                break;
                
            case '📊 Export Wallets':
                await executeFunction(chatId, userId, 'exportAllWallets');
                break;
                
            case '💰 Check Balances':
                await executeFunction(chatId, userId, 'checkAllWalletBalances');
                break;
                
            case '🎯 Vanity Address':
                await executeFunction(chatId, userId, 'generateVanityAddress');
                break;
                
            case '🎯 Batch Vanity':
                await executeFunction(chatId, userId, 'generateMultipleVanityAddresses');
                break;
                
            case '📊 Vanity Difficulty':
                await executeFunction(chatId, userId, 'calculateVanityDifficulty');
                break;
                
            // Pre-launch menu items
            case '🔗 Create LUT':
                await executePreLaunchFunction(chatId, userId, 'createLUT');
                break;
                
            case '📦 Extend LUT Bundle':
                await executePreLaunchFunction(chatId, userId, 'extendLUT');
                break;
                
            case '🎲 Simulate Buys':
                await executePreLaunchFunction(chatId, userId, 'simulateAndWriteBuys');
                break;
                
            case '💸 Send SOL Bundle':
                await executePreLaunchFunction(chatId, userId, 'generateATAandSOL');
                break;
                
            case '💰 Reclaim SOL':
                await executePreLaunchFunction(chatId, userId, 'createReturns');
                break;
                
            case '🔙 Back to Main Menu':
                session.currentMenu = 'main';
                await showMainMenu(chatId);
                break;
                
            case '❌ Exit':
                await bot.sendMessage(chatId, '👋 Goodbye\\! Use /start to return to the menu\\.', { parse_mode: 'MarkdownV2' });
                userSessions.delete(userId);
                break;
                
            default:
                await bot.sendMessage(chatId, '❓ Please select an option from the menu\\.');
                break;
        }
    } catch (error) {
        console.error('Error handling message:', error);
        await bot.sendMessage(chatId, `❌ An error occurred: ${error}`);
        await showMainMenu(chatId);
    }
});

// Execute main functions
async function executeFunction(chatId: number, userId: number, functionName: string) {
    const session = getUserSession(userId);
    session.currentFunction = functionName;
    
    await bot.sendMessage(chatId, `🔄 Executing ${functionName}...`);
    
    try {
        switch (functionName) {
            case 'createKeypairs':
                await handleCreateKeypairs(chatId, userId);
                break;
            case 'buyBundle':
                await handleBuyBundle(chatId, userId);
                break;
            case 'unifiedSellFunction':
                await handleUnifiedSell(chatId, userId);
                break;
            case 'unifiedBuyFunction':
                await handleUnifiedBuy(chatId, userId);
                break;
            case 'sellAllTokensAndCleanup':
                await handleSellAllCleanup(chatId, userId);
                break;
            case 'exportAllWallets':
                await handleExportWallets(chatId, userId);
                break;
            case 'checkAllWalletBalances':
                await handleCheckBalances(chatId, userId);
                break;
            case 'generateVanityAddress':
                await handleVanityAddress(chatId, userId);
                break;
            case 'generateMultipleVanityAddresses':
                await handleBatchVanity(chatId, userId);
                break;
            case 'calculateVanityDifficulty':
                await handleVanityDifficulty(chatId, userId);
                break;
        }
    } catch (error) {
        console.error(`Error executing ${functionName}:`, error);
        await bot.sendMessage(chatId, `❌ Error executing ${functionName}: ${error}`);
        await showMainMenu(chatId);
    }
}

// Execute pre-launch functions
async function executePreLaunchFunction(chatId: number, userId: number, functionName: string) {
    await bot.sendMessage(chatId, `🔄 Executing ${functionName}...`);
    
    try {
        // Note: Pre-launch functions need console interaction
        await bot.sendMessage(chatId, `⚠️ ${functionName} needs console interaction\\. Please use: npm run console → option 2`, { parse_mode: 'MarkdownV2' });
        await showPreLaunchMenu(chatId);
    } catch (error) {
        console.error(`Error executing ${functionName}:`, error);
        await bot.sendMessage(chatId, `❌ Error executing ${functionName}: ${error}`);
        await showPreLaunchMenu(chatId);
    }
}

// Handle user input for multi-step processes
async function handleUserInput(chatId: number, userId: number, input: string, session: UserSession) {
    const { waitingForInput } = session;
    
    try {
        switch (waitingForInput) {
            case 'vanity_pattern_type':
                await handleVanityPatternType(chatId, userId, input, session);
                break;
            case 'vanity_pattern':
                await handleVanityPattern(chatId, userId, input, session);
                break;
            case 'vanity_difficulty_pattern':
                await handleVanityDifficultyPattern(chatId, userId, input, session);
                break;
            default:
                session.waitingForInput = undefined;
                await bot.sendMessage(chatId, '❓ Unexpected input\\. Returning to main menu\\.', { parse_mode: 'MarkdownV2' });
                await showMainMenu(chatId);
                break;
        }
    } catch (error) {
        console.error('Error handling user input:', error);
        await bot.sendMessage(chatId, `❌ Input error: ${error}`);
        session.waitingForInput = undefined;
        await showMainMenu(chatId);
    }
}

// Individual function handlers
async function handleCreateKeypairs(chatId: number, userId: number) {
    const keyboard = {
        reply_markup: {
            keyboard: [
                [{ text: '📝 Create New Wallets' }, { text: '📁 Use Existing Wallets' }],
                [{ text: '🔙 Back to Main Menu' }]
            ] as KeyboardButton[][],
            resize_keyboard: true,
            one_time_keyboard: true
        }
    };
    
    const options: SendMessageOptions = {
        parse_mode: 'MarkdownV2',
        ...keyboard
    };
    
    await bot.sendMessage(chatId, 
        '🔑 *Create Keypairs*\n\n' +
        '⚠️ *WARNING:* If you create new ones, ensure you don\'t have SOL, OR ELSE IT WILL BE GONE\\.\n\n' +
        'Choose an option:', 
        options
    );
}

async function handleVanityAddress(chatId: number, userId: number) {
    const session = getUserSession(userId);
    session.waitingForInput = 'vanity_pattern_type';
    session.inputData = {};
    
    const keyboard = {
        reply_markup: {
            keyboard: [
                [{ text: '1️⃣ Starts with (prefix)' }, { text: '2️⃣ Ends with (suffix)' }],
                [{ text: '3️⃣ Quick pump ending' }, { text: '🔙 Back to Main Menu' }]
            ] as KeyboardButton[][],
            resize_keyboard: true,
            one_time_keyboard: true
        }
    };
    
    const options: SendMessageOptions = {
        parse_mode: 'MarkdownV2',
        ...keyboard
    };
    
    await bot.sendMessage(chatId, 
        '🎯 *VANITY ADDRESS GENERATOR*\n\n' +
        'Generate custom addresses with your desired pattern\\!\n\n' +
        '*Examples:*\n' +
        '• Start: \'ABC\' → ABC\\.\\.\\. \\(addresses starting with ABC\\)\n' +
        '• End: \'pump\' → \\.\\.\\.pump \\(addresses ending with pump\\)\n\n' +
        '⚠️ *Note:* Longer patterns take exponentially longer to find\\!\n\n' +
        'Choose pattern type:', 
        options
    );
}

async function handleVanityPatternType(chatId: number, userId: number, input: string, session: UserSession) {
    switch (input) {
        case '1️⃣ Starts with (prefix)':
        case '1':
            session.inputData.isPrefix = true;
            session.waitingForInput = 'vanity_pattern';
            await bot.sendMessage(chatId, '🎯 Enter prefix \\(what address should START with\\):', { parse_mode: 'MarkdownV2' });
            break;
            
        case '2️⃣ Ends with (suffix)':
        case '2':
            session.inputData.isPrefix = false;
            session.waitingForInput = 'vanity_pattern';
            await bot.sendMessage(chatId, '🎯 Enter suffix \\(what address should END with\\):', { parse_mode: 'MarkdownV2' });
            break;
            
        case '3️⃣ Quick pump ending':
        case '3':
            session.inputData.isPrefix = false;
            session.inputData.pattern = 'pump';
            session.waitingForInput = undefined;
            await executeVanityGeneration(chatId, userId, session);
            break;
            
        case '🔙 Back to Main Menu':
            session.waitingForInput = undefined;
            await showMainMenu(chatId);
            break;
            
        default:
            await bot.sendMessage(chatId, '❌ Invalid choice\\. Please select 1, 2, or 3\\.', { parse_mode: 'MarkdownV2' });
            break;
    }
}

async function handleVanityPattern(chatId: number, userId: number, input: string, session: UserSession) {
    if (input === '🔙 Back to Main Menu') {
        session.waitingForInput = undefined;
        await showMainMenu(chatId);
        return;
    }
    
    // Validate pattern
    const validChars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    for (const char of input) {
        if (!validChars.includes(char)) {
            await bot.sendMessage(chatId, 
                `❌ Invalid character '${char}' in pattern\\!\n\n` +
                `📋 Valid characters: ${validChars.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&')}\n\n` +
                'Please enter a valid pattern:', 
                { parse_mode: 'MarkdownV2' }
            );
            return;
        }
    }
    
    session.inputData.pattern = input;
    session.waitingForInput = undefined;
    await executeVanityGeneration(chatId, userId, session);
}

async function executeVanityGeneration(chatId: number, userId: number, session: UserSession) {
    const { pattern, isPrefix } = session.inputData;
    
    await bot.sendMessage(chatId, 
        `🔍 Searching for addresses ${isPrefix ? 'starting' : 'ending'} with: "${pattern}"\n\n` +
        '⏳ This may take a while\\.\\.\\.\n\n' +
        '💡 The bot will notify you when an address is found\\!',
        { parse_mode: 'MarkdownV2' }
    );
    
    try {
        const difficulty = Math.pow(58, pattern.length);
        const avgAttempts = difficulty / 2;
        
        await bot.sendMessage(chatId, 
            `📊 *DIFFICULTY ANALYSIS:*\n` +
            `🎯 Pattern length: ${pattern.length} characters\n` +
            `🔢 Average attempts needed: ${avgAttempts.toLocaleString()}\n\n` +
            `Starting generation process\\.\\.\\.`,
            { parse_mode: 'MarkdownV2' }
        );
        
        await bot.sendMessage(chatId, 
            '⚠️ Vanity generation is computationally intensive\\.\n' +
            'For now, please use the console version for vanity address generation\\.\n\n' +
            'Returning to main menu\\.\\.\\.',
            { parse_mode: 'MarkdownV2' }
        );
        
        await showMainMenu(chatId);
        
    } catch (error) {
        await bot.sendMessage(chatId, `❌ Error generating vanity address: ${error}`);
        await showMainMenu(chatId);
    }
    
    session.waitingForInput = undefined;
    session.inputData = {};
}

async function handleVanityDifficultyPattern(chatId: number, userId: number, input: string, session: UserSession) {
    try {
        const pattern = input.trim();
        const difficulty = Math.pow(58, pattern.length);
        const avgAttempts = difficulty / 2;
        const estimatedSeconds = avgAttempts / 100000; // Assuming 100k attempts/sec
        const estimatedMinutes = estimatedSeconds / 60;
        const estimatedHours = estimatedMinutes / 60;
        const estimatedDays = estimatedHours / 24;

        let difficultyText = `📊 *DIFFICULTY ANALYSIS FOR: "${pattern}"*\n\n`;
        difficultyText += `🎯 Pattern length: ${pattern.length} characters\n`;
        difficultyText += `🔢 Total possibilities: ${difficulty.toLocaleString()}\n`;
        difficultyText += `📈 Average attempts: ${avgAttempts.toLocaleString()}\n\n`;
        
        difficultyText += `⏱️ *ESTIMATED TIME \\(100k attempts/sec\\):*\n`;
        if (estimatedSeconds < 60) {
            difficultyText += `• ${estimatedSeconds.toFixed(1)} seconds\n`;
        } else if (estimatedMinutes < 60) {
            difficultyText += `• ${estimatedMinutes.toFixed(1)} minutes\n`;
        } else if (estimatedHours < 24) {
            difficultyText += `• ${estimatedHours.toFixed(1)} hours\n`;
        } else {
            difficultyText += `• ${estimatedDays.toFixed(1)} days\n`;
        }
        
        difficultyText += `\n💡 *RECOMMENDATIONS:*\n`;
        if (pattern.length <= 2) {
            difficultyText += `✅ Very fast \\- should find in seconds/minutes`;
        } else if (pattern.length <= 3) {
            difficultyText += `⚠️ Moderate \\- may take several minutes`;
        } else if (pattern.length <= 4) {
            difficultyText += `🔥 Difficult \\- could take hours`;
            if (pattern.toLowerCase() === "pump") {
                difficultyText += `\n🚀 But worth it for pump\\.fun launches\\!`;
            }
        } else {
            difficultyText += `🚫 Very difficult \\- could take days/weeks\n`;
            difficultyText += `💡 Consider using a shorter pattern`;
        }

        await bot.sendMessage(chatId, difficultyText, { parse_mode: 'MarkdownV2' });
        
    } catch (error) {
        await bot.sendMessage(chatId, `❌ Error calculating difficulty: ${error}`);
    }
    
    session.waitingForInput = undefined;
    await showMainMenu(chatId);
}

// Placeholder handlers for other functions
async function handleBuyBundle(chatId: number, userId: number) {
    await bot.sendMessage(chatId, 
        '🚀 *Create Pool Bundle*\n\n' +
        '⚠️ This function requires interactive input and file operations\\.\n' +
        'Please use the console version for token creation\\.\n\n' +
        'Returning to main menu\\.\\.\\.',
        { parse_mode: 'MarkdownV2' }
    );
    await showMainMenu(chatId);
}

async function handleUnifiedSell(chatId: number, userId: number) {
    await bot.sendMessage(chatId, 
        '💰 *Sell Tokens*\n\n' +
        '⚠️ This function requires interactive input and wallet selection\\.\n' +
        'Please use the console version for selling tokens\\.\n\n' +
        'Returning to main menu\\.\\.\\.',
        { parse_mode: 'MarkdownV2' }
    );
    await showMainMenu(chatId);
}

async function handleUnifiedBuy(chatId: number, userId: number) {
    await bot.sendMessage(chatId, 
        '💸 *Buy Tokens*\n\n' +
        '⚠️ This function requires interactive input and wallet management\\.\n' +
        'Please use the console version for buying tokens\\.\n\n' +
        'Returning to main menu\\.\\.\\.',
        { parse_mode: 'MarkdownV2' }
    );
    await showMainMenu(chatId);
}

async function handleSellAllCleanup(chatId: number, userId: number) {
    await bot.sendMessage(chatId, 
        '🧹 *Cleanup All Tokens*\n\n' +
        '⚠️ This function performs critical wallet operations\\.\n' +
        'Please use the console version for safety\\.\n\n' +
        'Returning to main menu\\.\\.\\.',
        { parse_mode: 'MarkdownV2' }
    );
    await showMainMenu(chatId);
}

async function handleExportWallets(chatId: number, userId: number) {
    await bot.sendMessage(chatId, 
        '📊 *Export Wallets*\n\n' +
        '⚠️ *SECURITY WARNING:*\n' +
        'Wallet export contains sensitive private keys\\.\n' +
        'This should not be done through Telegram for security reasons\\.\n\n' +
        'Please use the console version to export wallets safely\\.\n\n' +
        'Returning to main menu\\.\\.\\.',
        { parse_mode: 'MarkdownV2' }
    );
    await showMainMenu(chatId);
}

async function handleCheckBalances(chatId: number, userId: number) {
    try {
        await bot.sendMessage(chatId, '💰 Checking wallet balances\\.\\.\\.');
        
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
        
        // Send the captured output (escape special characters for MarkdownV2)
        const escapedOutput = output.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
        
        if (escapedOutput.length > 4000) {
            // Split large outputs
            const chunks = escapedOutput.match(/.{1,4000}/g) || [];
            for (const chunk of chunks) {
                await bot.sendMessage(chatId, `\`\`\`\n${chunk}\n\`\`\``, { parse_mode: 'MarkdownV2' });
            }
        } else {
            await bot.sendMessage(chatId, `\`\`\`\n${escapedOutput}\n\`\`\``, { parse_mode: 'MarkdownV2' });
        }
        
        await bot.sendMessage(chatId, 
            '✅ Balance check completed\\!\n' +
            'Returning to main menu\\.\\.\\.',
            { parse_mode: 'MarkdownV2' }
        );
    } catch (error) {
        await bot.sendMessage(chatId, `❌ Error checking balances: ${error}`);
    }
    
    await showMainMenu(chatId);
}

async function handleBatchVanity(chatId: number, userId: number) {
    await bot.sendMessage(chatId, 
        '🎯 *Batch Vanity Addresses*\n\n' +
        '⚠️ Batch vanity generation is very resource intensive\\.\n' +
        'Please use the console version for batch generation\\.\n\n' +
        'Returning to main menu\\.\\.\\.',
        { parse_mode: 'MarkdownV2' }
    );
    await showMainMenu(chatId);
}

async function handleVanityDifficulty(chatId: number, userId: number) {
    const session = getUserSession(userId);
    session.waitingForInput = 'vanity_difficulty_pattern';
    
    await bot.sendMessage(chatId, 
        '📊 *VANITY DIFFICULTY CALCULATOR*\n\n' +
        'Enter a pattern to check its difficulty:\n\n' +
        'Examples:\n' +
        '• "ABC" \\- 3 character pattern\n' +
        '• "pump" \\- 4 character pattern\n' +
        '• "1234" \\- number pattern\n\n' +
        'Enter pattern to analyze:',
        { parse_mode: 'MarkdownV2' }
    );
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

// Export bot for external usage if needed
export default bot;

console.log('🤖 Telegram bot started! Send /start to begin.');