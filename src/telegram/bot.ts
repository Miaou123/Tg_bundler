import TelegramBot from 'node-telegram-bot-api';
import { BOT_TOKEN, AUTHORIZED_TELEGRAM_USERS, KEY_INFO_PATH } from '../shared/config';
import { getUserSession, clearUserSession, isWaitingForInput } from './utils/sessions';
import { createMainMenuKeyboard } from './utils/keyboards';
import { WELCOME_MESSAGE, HELP_MESSAGE, MAIN_MENU_MESSAGE, formatMessage } from './utils/messages';
import { ERRORS } from '../shared/constants';

// Create the bot instance
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Import handlers dynamically to avoid circular dependencies
import { initHandlers } from './handlers';

/**
 * Check if a user is authorized to use the bot
 * @param userId Telegram user ID
 * @returns Whether the user is authorized
 */
function isAuthorized(userId: number): boolean {
  return AUTHORIZED_TELEGRAM_USERS.length === 0 || AUTHORIZED_TELEGRAM_USERS.includes(userId);
}

/**
 * Initialize the Telegram bot with command handlers
 */
export function initBot(): void {
  // Register handlers
  initHandlers(bot);

  // Handle /start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    if (!isAuthorized(userId)) {
      await bot.sendMessage(chatId, ERRORS.UNAUTHORIZED, { parse_mode: 'MarkdownV2' });
      return;
    }
    
    // Initialize user session
    clearUserSession(userId);
    
    // Send welcome message
    await bot.sendMessage(
      chatId,
      formatMessage(WELCOME_MESSAGE),
      { parse_mode: WELCOME_MESSAGE.parse_mode }
    );
    
    // Show main menu
    await bot.sendMessage(
      chatId,
      formatMessage(MAIN_MENU_MESSAGE),
      { ...createMainMenuKeyboard(), parse_mode: MAIN_MENU_MESSAGE.parse_mode }
    );
  });

  // Handle /help command
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    if (!isAuthorized(userId)) {
      await bot.sendMessage(chatId, ERRORS.UNAUTHORIZED, { parse_mode: 'MarkdownV2' });
      return;
    }
    
    await bot.sendMessage(
      chatId,
      formatMessage(HELP_MESSAGE),
      { parse_mode: HELP_MESSAGE.parse_mode }
    );
  });

  // Handle /status command
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    if (!isAuthorized(userId)) {
      await bot.sendMessage(chatId, ERRORS.UNAUTHORIZED, { parse_mode: 'MarkdownV2' });
      return;
    }
    
    await handleStatusCommand(chatId);
  });

  // Handle /cancel command
  bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    if (!isAuthorized(userId)) {
      await bot.sendMessage(chatId, ERRORS.UNAUTHORIZED, { parse_mode: 'MarkdownV2' });
      return;
    }
    
    clearUserSession(userId);
    await bot.sendMessage(chatId, ERRORS.OPERATION_CANCELLED, { parse_mode: 'MarkdownV2' });
    
    // Show main menu
    await bot.sendMessage(
      chatId,
      formatMessage(MAIN_MENU_MESSAGE),
      { ...createMainMenuKeyboard(), parse_mode: MAIN_MENU_MESSAGE.parse_mode }
    );
  });

  // Error handlers
  bot.on('polling_error', (error) => {
    console.error('Telegram polling error:', error);
  });

  bot.on('error', (error) => {
    console.error('Telegram bot error:', error);
  });

  // Setup graceful shutdown
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
  
  console.log('🤖 Telegram bot started!');
  console.log('📱 Send /start to your bot to begin');
  console.log('🔧 Authorized users:', AUTHORIZED_TELEGRAM_USERS.length > 0 ? AUTHORIZED_TELEGRAM_USERS.join(', ') : 'All users');
}

/**
 * Handle status command
 * @param chatId Chat ID to send status to
 */
async function handleStatusCommand(chatId: number): Promise<void> {
  try {
    const fs = require('fs');
    
    let statusText = '📊 *BOT STATUS*\n\n';
    
    if (fs.existsSync(KEY_INFO_PATH)) {
      const keyInfo = JSON.parse(fs.readFileSync(KEY_INFO_PATH, 'utf-8'));
      statusText += '✅ KeyInfo file exists\n';
      statusText += `📁 Wallets: ${keyInfo.numOfWallets || 'Unknown'}\n`;
      statusText += `🔗 LUT: ${keyInfo.addressLUT ? 'Ready' : 'Missing'}\n`;
      statusText += `🪙 Mint: ${keyInfo.mint ? 'Configured' : 'Missing'}\n`;
    } else {
      statusText += '❌ KeyInfo file missing\n';
      statusText += '💡 Run Pre Launch Checklist first\n';
    }
    
    statusText += `\n🤖 Bot: Online`;
    
    await bot.sendMessage(chatId, statusText, { parse_mode: 'MarkdownV2' });
    
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Status check error: ${error}`);
  }
}

export default bot;