import TelegramBot from 'node-telegram-bot-api';
import { UserSession } from '../../shared/types';
import { setWaitingFor, addSessionData, getSessionData } from '../utils/sessions';
import { createWalletSelectionKeyboard, createPercentageKeyboard, createSlippageKeyboard } from '../utils/keyboards';
import { consoleRequiredMessage, formatMessage, processingMessage, successMessage, errorMessage } from '../utils/messages';
import { showMainMenu } from './index';
import { WAITING_FOR } from '../../shared/constants';
import { withTelegramPrompt } from '../utils/prompt';

// Import core functions
// Import core functions
// Note: We'll need to modify these to accept userId parameter
// import { unifiedBuy } from '../../core/buy';
// import { unifiedSell } from '../../core/sell';
// import { sellAllTokensAndCleanup } from '../../core/cleanup';

/**
 * Handle create pool command
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param session User session
 */
export async function handleCreatePool(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  session: UserSession
): Promise<void> {
  const message = `🚀 **CREATE POOL BUNDLE**

⚠️ **IMPORTANT:** Token creation requires:
• Interactive metadata input
• Image file management
• Real-time transaction monitoring

🔒 **Security:** This operation is not available via Telegram for security reasons.

Please use the original bundler console application to create pools and launch tokens.`;

  await bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
  await showMainMenu(bot, chatId);
}

/**
 * Handle simulate buys
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param session User session
 */
export async function handleSimulateBuys(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  session: UserSession
): Promise<void> {
  await bot.sendMessage(
    chatId,
    formatMessage(consoleRequiredMessage('Simulate Buys')),
    { parse_mode: 'MarkdownV2' }
  );
  await showMainMenu(bot, chatId);
}

/**
 * Handle sell tokens command
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param session User session
 */
export async function handleSellTokens(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  session: UserSession
): Promise<void> {
  session.currentFunction = 'sellToken';
  
  await bot.sendMessage(
    chatId,
    '🎯 **WALLET SELECTION OPTIONS:**\n\n' +
    '1️⃣ Sell from ALL wallets (creator + bundle wallets)\n' +
    '2️⃣ Sell from BUNDLE wallets only (exclude creator)\n' +
    '3️⃣ Sell from CREATOR wallet only\n\n' +
    'Choose wallet selection mode:',
    { ...createWalletSelectionKeyboard(), parse_mode: 'MarkdownV2' }
  );
  
  setWaitingFor(userId, WAITING_FOR.SELL_SELECTION_MODE);
}

/**
 * Handle buy tokens command
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param session User session
 */
export async function handleBuyTokens(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  session: UserSession
): Promise<void> {
  session.currentFunction = 'buyToken';
  
  await bot.sendMessage(
    chatId,
    '🎯 **WALLET SELECTION OPTIONS:**\n\n' +
    '1️⃣ Buy with ALL wallets (creator + bundle wallets)\n' +
    '2️⃣ Buy with BUNDLE wallets only (exclude creator)\n' +
    '3️⃣ Buy with CREATOR wallet only\n\n' +
    'Choose wallet selection mode:',
    { ...createWalletSelectionKeyboard(), parse_mode: 'MarkdownV2' }
  );
  
  setWaitingFor(userId, WAITING_FOR.BUY_SELECTION_MODE);
}

/**
 * Handle cleanup all command
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param session User session
 */
export async function handleCleanupAll(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  session: UserSession
): Promise<void> {
  const message = `🧹 **CLEANUP ALL TOKENS**

⚠️ **CRITICAL OPERATION:**
• Sells ALL tokens in ALL wallets
• Transfers SOL to payer wallet
• Cannot be undone

Are you sure you want to proceed? This will sell ALL tokens and reclaim ALL SOL.`;

  await bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
  
  session.currentFunction = 'sellAllTokensAndCleanup';
  setWaitingFor(userId, 'cleanup_confirm');
}

/**
 * Handle trading inputs
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 * @param session User session
 */
export async function handleTradingInput(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string,
  session: UserSession
): Promise<void> {
  const waitingFor = session.waitingFor;
  
  switch (waitingFor) {
    case WAITING_FOR.SELL_SELECTION_MODE:
      await handleSellSelectionMode(bot, chatId, userId, text);
      break;
      
    case WAITING_FOR.SELL_PERCENTAGE:
      await handleSellPercentage(bot, chatId, userId, text);
      break;
      
    case WAITING_FOR.SELL_SLIPPAGE:
      await handleSellSlippage(bot, chatId, userId, text);
      break;
      
    case WAITING_FOR.BUY_SELECTION_MODE:
      await handleBuySelectionMode(bot, chatId, userId, text);
      break;
      
    case WAITING_FOR.BUY_TOTAL_SOL:
      await handleBuyTotalSOL(bot, chatId, userId, text);
      break;
      
    case WAITING_FOR.BUY_SLIPPAGE:
      await handleBuySlippage(bot, chatId, userId, text);
      break;

    case WAITING_FOR.JITO_TIP:
      await handleJitoTip(bot, chatId, userId, text, session);
      break;
      
    case 'cleanup_confirm':
      await handleCleanupConfirm(bot, chatId, userId, text);
      break;
      
    default:
      await bot.sendMessage(chatId, '❓ Unexpected input. Returning to main menu.');
      await showMainMenu(bot, chatId);
  }
}

/**
 * Handle sell selection mode
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 */
async function handleSellSelectionMode(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string
): Promise<void> {
  try {
    let mode: number;
    
    if (text.startsWith('1️⃣')) {
      mode = 1;
    } else if (text.startsWith('2️⃣')) {
      mode = 2;
    } else if (text.startsWith('3️⃣')) {
      mode = 3;
    } else if (!isNaN(parseInt(text))) {
      mode = parseInt(text);
      if (mode < 1 || mode > 3) {
        await bot.sendMessage(chatId, '❌ Invalid mode. Please select 1, 2, or 3.');
        return;
      }
    } else {
      await bot.sendMessage(chatId, '❌ Invalid mode. Please select 1, 2, or 3.');
      return;
    }
    
    addSessionData(userId, 'selectionMode', mode);
    
    await bot.sendMessage(
      chatId,
      'Percentage to sell (Ex. 1 for 1%, 100 for 100%):',
      { ...createPercentageKeyboard() }
    );
    
    setWaitingFor(userId, WAITING_FOR.SELL_PERCENTAGE);
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('selection mode', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Handle sell percentage
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 */
async function handleSellPercentage(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string
): Promise<void> {
  try {
    // Handle predefined options
    if (text.endsWith('%')) {
      text = text.replace('%', '');
    }
    
    if (text.toLowerCase() === 'custom %') {
      await bot.sendMessage(chatId, 'Enter custom percentage (1-100):');
      return;
    }
    
    const percentage = parseFloat(text);
    if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
      await bot.sendMessage(chatId, '❌ Invalid percentage. Please enter a number between 1 and 100.');
      return;
    }
    
    addSessionData(userId, 'supplyPercent', percentage);
    
    await bot.sendMessage(
      chatId,
      'Slippage tolerance % (default 10):',
      { ...createSlippageKeyboard() }
    );
    
    setWaitingFor(userId, WAITING_FOR.SELL_SLIPPAGE);
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('sell percentage', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Handle sell slippage
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 */
async function handleSellSlippage(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string
): Promise<void> {
  try {
    // Handle predefined options
    if (text.endsWith('%')) {
      text = text.replace('%', '');
    }
    
    if (text.toLowerCase() === 'custom %') {
      await bot.sendMessage(chatId, 'Enter custom slippage (1-100):');
      return;
    }
    
    let slippage = 10; // Default
    if (text) {
      slippage = parseFloat(text);
      if (isNaN(slippage) || slippage < 0 || slippage > 100) {
        await bot.sendMessage(chatId, '❌ Invalid slippage. Using default 10%.');
        slippage = 10;
      }
    }
    
    addSessionData(userId, 'slippagePercent', slippage);
    
    await bot.sendMessage(chatId, '💰 Enter Jito tip in Sol (Ex. 0.01):');
    setWaitingFor(userId, WAITING_FOR.JITO_TIP);
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('sell slippage', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Handle buy selection mode
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 */
async function handleBuySelectionMode(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string
): Promise<void> {
  try {
    let mode: number;
    
    if (text.startsWith('1️⃣')) {
      mode = 1;
    } else if (text.startsWith('2️⃣')) {
      mode = 2;
    } else if (text.startsWith('3️⃣')) {
      mode = 3;
    } else if (!isNaN(parseInt(text))) {
      mode = parseInt(text);
      if (mode < 1 || mode > 3) {
        await bot.sendMessage(chatId, '❌ Invalid mode. Please select 1, 2, or 3.');
        return;
      }
    } else {
      await bot.sendMessage(chatId, '❌ Invalid mode. Please select 1, 2, or 3.');
      return;
    }
    
    addSessionData(userId, 'selectionMode', mode);
    
    await bot.sendMessage(chatId, 'Total SOL amount to spend (Ex. 1.5):');
    setWaitingFor(userId, WAITING_FOR.BUY_TOTAL_SOL);
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('buy mode selection', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Handle buy total SOL
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 */
async function handleBuyTotalSOL(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string
): Promise<void> {
  try {
    const totalSOL = parseFloat(text);
    if (isNaN(totalSOL) || totalSOL <= 0) {
      await bot.sendMessage(chatId, '❌ Invalid SOL amount. Please enter a valid number.');
      return;
    }
    
    addSessionData(userId, 'totalSOL', totalSOL);
    
    await bot.sendMessage(
      chatId,
      'Slippage tolerance % (default 15):',
      { ...createSlippageKeyboard() }
    );
    
    setWaitingFor(userId, WAITING_FOR.BUY_SLIPPAGE);
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('buy SOL amount', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Handle buy slippage
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 */
async function handleBuySlippage(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string
): Promise<void> {
  try {
    // Handle predefined options
    if (text.endsWith('%')) {
      text = text.replace('%', '');
    }
    
    if (text.toLowerCase() === 'custom %') {
      await bot.sendMessage(chatId, 'Enter custom slippage (1-100):');
      return;
    }
    
    let slippage = 15; // Default
    if (text) {
      slippage = parseFloat(text);
      if (isNaN(slippage) || slippage < 0 || slippage > 100) {
        await bot.sendMessage(chatId, '❌ Invalid slippage. Using default 15%.');
        slippage = 15;
      }
    }
    
    addSessionData(userId, 'slippagePercent', slippage);
    
    await bot.sendMessage(chatId, '💰 Enter Jito tip in Sol (Ex. 0.01):');
    setWaitingFor(userId, WAITING_FOR.JITO_TIP);
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('buy slippage', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Handle Jito tip input
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 * @param session User session
 */
async function handleJitoTip(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string,
  session: UserSession
): Promise<void> {
  try {
    const jitoTip = parseFloat(text);
    if (isNaN(jitoTip) || jitoTip < 0) {
      await bot.sendMessage(chatId, '❌ Invalid tip amount. Please enter a valid number (Ex. 0.01):');
      return;
    }
    
    addSessionData(userId, 'jitoTipLamports', Math.floor(jitoTip * 1e9)); // Convert to lamports
    
    // Execute the appropriate function based on currentFunction
    const currentFunction = session.currentFunction;
    
    if (currentFunction === 'sellToken') {
      await executeSellOperation(bot, chatId, userId, session);
    } else if (currentFunction === 'buyToken') {
      await executeBuyOperation(bot, chatId, userId, session);
    } else {
      await bot.sendMessage(chatId, '❌ Unknown operation. Returning to main menu.');
      await showMainMenu(bot, chatId);
    }
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('Jito tip', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Execute sell operation with collected parameters
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param session User session
 */
async function executeSellOperation(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  session: UserSession
): Promise<void> {
  try {
    await bot.sendMessage(chatId, processingMessage('Executing sell operation'));
    
    // Get mint address from poolInfo
    const { loadPoolInfo } = await import('../../shared/utils');
    const poolInfo = loadPoolInfo();
    
    if (!poolInfo.mint) {
      await bot.sendMessage(chatId, errorMessage('sell execution', 'No mint address found. Please create a token first.'));
      await showMainMenu(bot, chatId);
      return;
    }
    
    const mintAddress = poolInfo.mint;
    const selectionMode = getSessionData(userId, 'selectionMode');
    const supplyPercent = getSessionData(userId, 'supplyPercent');
    const slippagePercent = getSessionData(userId, 'slippagePercent');
    const jitoTipLamports = getSessionData(userId, 'jitoTipLamports');
    
    // For now, show what would be executed
    await bot.sendMessage(chatId, 
      `🔄 **SELL OPERATION CONFIGURED**\n\n` +
      `🎯 Token: ${mintAddress}\n` +
      `🏪 Mode: ${selectionMode === 1 ? 'All Wallets' : selectionMode === 2 ? 'Bundle Only' : 'Creator Only'}\n` +
      `📊 Amount: ${supplyPercent}% of tokens\n` +
      `⚡ Slippage: ${slippagePercent}%\n` +
      `💰 Jito Tip: ${(jitoTipLamports / 1e9).toFixed(4)} SOL\n\n` +
      `⚠️ **Note:** Core sell function needs to be updated for multi-user support.\n` +
      `Please use the console version for now.`,
      { parse_mode: 'MarkdownV2' }
    );
    
    await showMainMenu(bot, chatId);
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('sell execution', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Execute buy operation with collected parameters
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param session User session
 */
async function executeBuyOperation(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  session: UserSession
): Promise<void> {
  try {
    await bot.sendMessage(chatId, processingMessage('Executing buy operation'));
    
    // Get mint address from poolInfo
    const { loadPoolInfo } = await import('../../shared/utils');
    const poolInfo = loadPoolInfo();
    
    if (!poolInfo.mint) {
      await bot.sendMessage(chatId, errorMessage('buy execution', 'No mint address found. Please create a token first.'));
      await showMainMenu(bot, chatId);
      return;
    }
    
    const mintAddress = poolInfo.mint;
    const selectionMode = getSessionData(userId, 'selectionMode');
    const totalSOL = getSessionData(userId, 'totalSOL');
    const slippagePercent = getSessionData(userId, 'slippagePercent');
    const jitoTipLamports = getSessionData(userId, 'jitoTipLamports');
    
    // For now, show what would be executed
    await bot.sendMessage(chatId, 
      `🔄 **BUY OPERATION CONFIGURED**\n\n` +
      `🎯 Token: ${mintAddress}\n` +
      `🏪 Mode: ${selectionMode === 1 ? 'All Wallets' : selectionMode === 2 ? 'Bundle Only' : 'Creator Only'}\n` +
      `💰 Total SOL: ${totalSOL} SOL\n` +
      `⚡ Slippage: ${slippagePercent}%\n` +
      `💰 Jito Tip: ${(jitoTipLamports / 1e9).toFixed(4)} SOL\n\n` +
      `⚠️ **Note:** Core buy function needs to be updated for multi-user support.\n` +
      `Please use the console version for now.`,
      { parse_mode: 'MarkdownV2' }
    );
    
    await showMainMenu(bot, chatId);
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('buy execution', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Handle cleanup confirm
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 */
async function handleCleanupConfirm(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string
): Promise<void> {
  try {
    if (text.toLowerCase() !== 'yes' && text.toLowerCase() !== 'y') {
      await bot.sendMessage(chatId, '✅ Cleanup cancelled. Returning to main menu.');
      await showMainMenu(bot, chatId);
      return;
    }
    
    await bot.sendMessage(chatId, 
      `⚠️ **CLEANUP OPERATION**\n\n` +
      `This would sell all tokens from all wallets and return SOL to the payer wallet.\n\n` +
      `**Note:** Core cleanup function needs to be updated for multi-user support.\n` +
      `Please use the console version for now.`,
      { parse_mode: 'MarkdownV2' }
    );
    
    await showMainMenu(bot, chatId);
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('cleanup', error));
    await showMainMenu(bot, chatId);
  }
}