import TelegramBot from 'node-telegram-bot-api';
import { getUserSession, clearUserSession, isWaitingForInput } from '../utils/sessions';
import { createMainMenuKeyboard, createPreLaunchKeyboard } from '../utils/keyboards';
import { MAIN_MENU_MESSAGE, PRE_LAUNCH_MESSAGE, formatMessage } from '../utils/messages';
import { ERRORS } from '../../shared/constants';
import { MENUS } from '../../shared/constants';

// Import specific handlers
import * as walletHandlers from './wallet';
import * as tradingHandlers from './trading';
import * as infoHandlers from './info';
import * as vanityHandlers from './vanity';

/**
 * Initialize all handlers
 * @param bot Telegram bot instance
 */
export function initHandlers(bot: TelegramBot): void {
  // General message handler
  bot.on('message', async (msg) => {
    if (msg.text?.startsWith('/')) return; // Skip commands
    
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    const text = msg.text || '';
    
    // Check authorization
    if (!isAuthorized(userId)) {
      await bot.sendMessage(chatId, ERRORS.UNAUTHORIZED, { parse_mode: 'MarkdownV2' });
      return;
    }
    
    const session = getUserSession(userId);
    
    try {
      // Handle active sessions with input waiting
      if (isWaitingForInput(userId)) {
        await handleWaitingInput(bot, chatId, userId, text);
        return;
      }
      
      // Handle menu selections
      await handleMenuSelection(bot, chatId, userId, text);
      
    } catch (error) {
      console.error('Error handling message:', error);
      await bot.sendMessage(chatId, `❌ Error: ${error}`);
      clearUserSession(userId);
      await showMainMenu(bot, chatId);
    }
  });
}

/**
 * Check if a user is authorized to use the bot
 * @param userId Telegram user ID
 * @returns Whether the user is authorized
 */
function isAuthorized(userId: number): boolean {
  // This function should be implemented with your authorization logic
  // For now, we'll consider all users authorized
  return true;
}

/**
 * Handle input when waiting for user response
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 */
async function handleWaitingInput(
  bot: TelegramBot, 
  chatId: number, 
  userId: number, 
  text: string
): Promise<void> {
  const session = getUserSession(userId);
  const waitingFor = session.waitingFor;
  
  // Route to appropriate handler based on what we're waiting for
  if (waitingFor?.startsWith('vanity_')) {
    await vanityHandlers.handleVanityInput(bot, chatId, userId, text, session);
  } else if (waitingFor?.startsWith('wallet_')) {
    await walletHandlers.handleWalletInput(bot, chatId, userId, text, session);
  } else if (waitingFor?.startsWith('trading_')) {
    await tradingHandlers.handleTradingInput(bot, chatId, userId, text, session);
  } else if (waitingFor?.startsWith('info_')) {
    await infoHandlers.handleInfoInput(bot, chatId, userId, text, session);
  } else {
    // Unknown waiting state
    session.waitingFor = undefined;
    await bot.sendMessage(chatId, '❓ Unexpected input. Returning to main menu.');
    await showMainMenu(bot, chatId);
  }
}

/**
 * Handle menu selection
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text Selected menu option
 */
async function handleMenuSelection(
  bot: TelegramBot, 
  chatId: number, 
  userId: number, 
  text: string
): Promise<void> {
  const session = getUserSession(userId);
  const currentMenu = session.currentFunction || MENUS.MAIN;
  
  // Main menu options
  if (currentMenu === MENUS.MAIN) {
    switch (text) {
      case '🔑 Create Keypairs':
        await walletHandlers.handleCreateKeypairs(bot, chatId, userId, session);
        break;
        
      case '📋 Pre Launch':
        session.currentFunction = MENUS.PRE_LAUNCH;
        await showPreLaunchMenu(bot, chatId);
        break;
        
      case '🚀 Create Pool':
        await tradingHandlers.handleCreatePool(bot, chatId, userId, session);
        break;
        
      case '💰 Sell Tokens':
        await tradingHandlers.handleSellTokens(bot, chatId, userId, session);
        break;
        
      case '💸 Buy Tokens':
        await tradingHandlers.handleBuyTokens(bot, chatId, userId, session);
        break;
        
      case '🧹 Cleanup All':
        await tradingHandlers.handleCleanupAll(bot, chatId, userId, session);
        break;
        
      case '📊 Export Wallets':
        await walletHandlers.handleExportWallets(bot, chatId, userId, session);
        break;
        
      case '💰 Check Balances':
        await infoHandlers.handleCheckBalances(bot, chatId, userId, session);
        break;
        
      case '🎯 Vanity Address':
        await vanityHandlers.handleVanityAddress(bot, chatId, userId, session);
        break;
        
      case '📊 Vanity Calc':
        await vanityHandlers.handleVanityDifficulty(bot, chatId, userId, session);
        break;
        
      case '❌ Exit':
        await bot.sendMessage(chatId, '👋 Session ended. Use /start to begin again.');
        clearUserSession(userId);
        break;
        
      default:
        await bot.sendMessage(chatId, '❓ Please select an option from the menu.');
        break;
    }
  }
  // Pre-launch menu options
  else if (currentMenu === MENUS.PRE_LAUNCH) {
    switch (text) {
      case '🔗 Create LUT':
        await walletHandlers.handleCreateLUT(bot, chatId, userId, session);
        break;
        
      case '📦 Extend LUT':
        await walletHandlers.handleExtendLUT(bot, chatId, userId, session);
        break;
        
      case '🎲 Simulate Buys':
        await tradingHandlers.handleSimulateBuys(bot, chatId, userId, session);
        break;
        
      case '💸 Send SOL':
        await walletHandlers.handleSendSOL(bot, chatId, userId, session);
        break;
        
      case '💰 Reclaim SOL':
        await walletHandlers.handleReclaimSOL(bot, chatId, userId, session);
        break;
        
      case '🔙 Main Menu':
        session.currentFunction = MENUS.MAIN;
        await showMainMenu(bot, chatId);
        break;
        
      default:
        await bot.sendMessage(chatId, '❓ Please select an option from the menu.');
        break;
    }
  }
  // Handle other specific menus similarly if needed
}

/**
 * Show the main menu
 * @param bot Telegram bot instance
 * @param chatId Chat ID to send menu to
 */
export async function showMainMenu(bot: TelegramBot, chatId: number): Promise<void> {
  await bot.sendMessage(
    chatId, 
    formatMessage(MAIN_MENU_MESSAGE), 
    { ...createMainMenuKeyboard(), parse_mode: MAIN_MENU_MESSAGE.parse_mode }
  );
}

/**
 * Show the pre-launch menu
 * @param bot Telegram bot instance
 * @param chatId Chat ID to send menu to
 */
export async function showPreLaunchMenu(bot: TelegramBot, chatId: number): Promise<void> {
  await bot.sendMessage(
    chatId, 
    formatMessage(PRE_LAUNCH_MESSAGE), 
    { ...createPreLaunchKeyboard(), parse_mode: PRE_LAUNCH_MESSAGE.parse_mode }
  );
}