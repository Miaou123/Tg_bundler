import TelegramBot from 'node-telegram-bot-api';
import { getUserSession, clearUserSession, isWaitingForInput } from '../utils/sessions';
import { createMainMenuKeyboard, createPreLaunchKeyboard } from '../utils/keyboards';
import { MAIN_MENU_MESSAGE, PRE_LAUNCH_MESSAGE, formatMessage } from '../utils/messages';
import { ERRORS } from '../../shared/constants';
import { MENUS } from '../../shared/constants';

// Import specific handlers - remove the wallet import since it doesn't exist
// import * as walletHandlers from './wallet';  // Remove this line
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
  } else if (waitingFor?.startsWith('trading_') || waitingFor?.includes('_selection_mode')) {
    // Handle trading inputs (buy/sell selection modes)
    await tradingHandlers.handleTradingInput(bot, chatId, userId, text, session);
  } else {
    // Unknown waiting state
    session.waitingFor = undefined;
    await bot.sendMessage(chatId, '❓ Unexpected input. Returning to main menu...');
    await showMainMenu(bot, chatId);
  }
}

/**
 * Handle menu selection
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text Menu selection text
 */
async function handleMenuSelection(
  bot: TelegramBot,
  chatId: number, 
  userId: number, 
  text: string
): Promise<void> {
  const session = getUserSession(userId);
  
  switch (text) {
    // Main menu options
    case '🔑 Create Keypairs':
      // Handle keypair creation - you'll need to implement this
      await bot.sendMessage(chatId, '🔑 Keypair creation functionality coming soon...');
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
      await infoHandlers.handleExportWallets(bot, chatId, userId);
      break;
      
    case '💰 Check Balances':
      await infoHandlers.handleCheckBalances(bot, chatId, userId);
      break;
      
    case '🎯 Vanity Address':
      await vanityHandlers.handleVanityAddress(bot, chatId, userId, session);
      break;
      
    case '📊 Vanity Calc':
      await vanityHandlers.handleVanityDifficulty(bot, chatId, userId, session);
      break;
      
    case '🔙 Main Menu':
      await showMainMenu(bot, chatId);
      break;
      
    default:
      await bot.sendMessage(chatId, '❓ Unknown option. Please use the keyboard buttons.');
      await showMainMenu(bot, chatId);
      break;
  }
}

/**
 * Show main menu
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 */
export async function showMainMenu(bot: TelegramBot, chatId: number): Promise<void> {
  await bot.sendMessage(
    chatId,
    formatMessage(MAIN_MENU_MESSAGE),
    { ...createMainMenuKeyboard(), parse_mode: MAIN_MENU_MESSAGE.parse_mode }
  );
}

/**
 * Show pre-launch menu
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 */
export async function showPreLaunchMenu(bot: TelegramBot, chatId: number): Promise<void> {
  await bot.sendMessage(
    chatId,
    formatMessage(PRE_LAUNCH_MESSAGE),
    { ...createPreLaunchKeyboard(), parse_mode: PRE_LAUNCH_MESSAGE.parse_mode }
  );
}