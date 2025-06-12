import TelegramBot from 'node-telegram-bot-api';
import { BOT_TOKEN, AUTHORIZED_TELEGRAM_USERS } from '../shared/config';
import { getUserSession } from './utils/sessions';

// Import handlers
import * as keypairHandlers from './handlers/keypair';
import * as prelaunchHandlers from './handlers/prelaunch';
import * as tradingHandlers from './handlers/trading';
import * as infoHandlers from './handlers/info';

// Bot instance will be created in initBot
let bot: TelegramBot;

/**
 * Check if a user is authorized to use the bot
 * @param userId Telegram user ID
 * @returns Whether the user is authorized
 */
function isAuthorized(userId: number): boolean {
  return AUTHORIZED_TELEGRAM_USERS.length === 0 || AUTHORIZED_TELEGRAM_USERS.includes(userId);
}

/**
 * Start polling with retry logic for 409 conflicts
 */
async function startPollingWithRetry(botInstance: TelegramBot, maxRetries = 3, delay = 5000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Starting bot polling (attempt ${attempt}/${maxRetries})...`);
      
      // Stop any existing polling first
      if (botInstance.isPolling()) {
        await botInstance.stopPolling();
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      await botInstance.startPolling();
      console.log('✅ Bot polling started successfully!');
      return;
      
    } catch (error: any) {
      console.error(`❌ Polling attempt ${attempt} failed:`, error.message);
      
      // Type guard for Telegram error
      const isTelegramConflict = error && 
        error.code === 'ETELEGRAM' && 
        error.response?.body?.error_code === 409;
      
      if (isTelegramConflict) {
        console.log(`⏳ Waiting ${delay/1000} seconds before retry...`);
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 1.5; // Exponential backoff
        } else {
          throw new Error('Max retries reached. Another bot instance might still be running.');
        }
      } else {
        throw error;
      }
    }
  }
}

/**
 * Handle callback queries from inline buttons
 */
async function handleCallbackQuery(bot: TelegramBot, chatId: number, userId: number, data: string): Promise<void> {
  const { clearUserSession } = await import('./utils/sessions');
  const { createMainMenuKeyboard, createPreLaunchKeyboard } = await import('./utils/keyboards');
  const { MAIN_MENU_MESSAGE, PRE_LAUNCH_MESSAGE, formatMessage } = await import('./utils/messages');
  
  switch (data) {
    // Navigation
    case 'main_menu':
      clearUserSession(userId);
      await bot.sendMessage(
        chatId,
        formatMessage(MAIN_MENU_MESSAGE),
        { ...createMainMenuKeyboard(), parse_mode: MAIN_MENU_MESSAGE.parse_mode }
      );
      break;
      
    case 'pre_launch':
      await bot.sendMessage(
        chatId,
        formatMessage(PRE_LAUNCH_MESSAGE),
        { ...createPreLaunchKeyboard(), parse_mode: PRE_LAUNCH_MESSAGE.parse_mode }
      );
      break;
      
    // Keypair handlers
    case 'create_keypairs':
      await keypairHandlers.handleCreateKeypairsCheck(bot, chatId, userId);
      break;
      
    case 'keypair_new':
      await keypairHandlers.handleKeypairCreation(bot, chatId, userId, true);
      break;
      
    case 'keypair_existing':
      await keypairHandlers.handleKeypairCreation(bot, chatId, userId, false);
      break;
      
    // Pre-launch handlers
    case 'create_lut':
      await prelaunchHandlers.handleCreateLUTCheck(bot, chatId, userId);
      break;
      
    case 'confirm_create_lut':
      await prelaunchHandlers.handleCreateLUTFlow(bot, chatId, userId);
      break;
      
    case 'extend_lut':  // This is now "Set Contract Address"
      await prelaunchHandlers.handleExtendLUTFlow(bot, chatId, userId);
      break;
      
    // NEW: Contract address selection handlers
    case 'contract_vanity':
      await prelaunchHandlers.handleVanityContractFlow(bot, chatId, userId);
      break;
      
    case 'contract_random':
      await prelaunchHandlers.handleRandomContractFlow(bot, chatId, userId);
      break;
      
    case 'simulate_buys':
      await prelaunchHandlers.handleSimulateBuys(bot, chatId, userId);
      break;
      
    case 'send_sol':
      await prelaunchHandlers.handleSendSOL(bot, chatId, userId);
      break;
      
    case 'reclaim_sol':
      await prelaunchHandlers.handleReclaimSOL(bot, chatId, userId);
      break;
      
    // Trading handlers
    case 'create_pool':
      {
        const session = getUserSession(userId);
        await tradingHandlers.handleCreatePool(bot, chatId, userId, session);
      }
      break;
      
    case 'sell_tokens':
      {
        const session = getUserSession(userId);
        await tradingHandlers.handleSellTokens(bot, chatId, userId, session);
      }
      break;
      
    case 'buy_tokens':
      {
        const session = getUserSession(userId);
        await tradingHandlers.handleBuyTokens(bot, chatId, userId, session);
      }
      break;
      
    case 'cleanup_all':
      {
        const session = getUserSession(userId);
        await tradingHandlers.handleCleanupAll(bot, chatId, userId, session);
      }
      break;
      
    // Info handlers
    case 'export_wallets':
      await infoHandlers.handleExportWallets(bot, chatId, userId);
      break;
      
    case 'check_balances':
      await infoHandlers.handleCheckBalances(bot, chatId, userId);
      break;
      
    case 'vanity_address':
      await bot.sendMessage(chatId, '🎯 Vanity Address feature is coming soon...');
      break;
      
    case 'vanity_calc':
      await bot.sendMessage(chatId, '📊 Vanity Calc feature is coming soon...');
      break;
      
    case 'exit':
      clearUserSession(userId);
      await bot.sendMessage(chatId, '👋 Goodbye! Thanks for using the Pump.Fun Bundler Bot.');
      break;
      
    default:
      await bot.sendMessage(chatId, `Unknown command: ${data}`);
      break;
  }
}

/**
 * Initialize the Telegram bot with command handlers
 * @returns The bot instance for external management
 */
export async function initBot(): Promise<TelegramBot> {
  // Create bot instance with polling disabled initially
  bot = new TelegramBot(BOT_TOKEN, { polling: false });

  // Handle callback queries (inline button presses)
  bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat.id;
    const userId = query.from.id;
    const data = query.data;
    
    if (!chatId || !data) return;
    
    if (!isAuthorized(userId)) {
      await bot.answerCallbackQuery(query.id, { text: 'Unauthorized access' });
      return;
    }
    
    // Answer the callback query to remove loading state
    await bot.answerCallbackQuery(query.id);
    
    try {
      await handleCallbackQuery(bot, chatId, userId, data);
    } catch (error) {
      console.error('Error handling callback query:', error);
      const errorText = `❌ Error: ${error}`.replace(/[.!]/g, '\\$&');
      await bot.sendMessage(chatId, errorText, { parse_mode: 'MarkdownV2' });
    }
  });

  // Handle /start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    if (!isAuthorized(userId)) {
      await bot.sendMessage(chatId, 'Unauthorized access');
      return;
    }
    
    // Send welcome message
    const { createMainMenuKeyboard } = await import('./utils/keyboards');
    const { WELCOME_MESSAGE, MAIN_MENU_MESSAGE, formatMessage } = await import('./utils/messages');
    
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
      await bot.sendMessage(chatId, 'Unauthorized access');
      return;
    }
    
    const { HELP_MESSAGE, formatMessage } = await import('./utils/messages');
    
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
      await bot.sendMessage(chatId, 'Unauthorized access');
      return;
    }
    
    await infoHandlers.handleStatusCommand(bot, chatId, userId);
  });

  // Handle /cancel command
  bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    
    if (!isAuthorized(userId)) {
      await bot.sendMessage(chatId, 'Unauthorized access');
      return;
    }
    
    const { clearUserSession } = await import('./utils/sessions');
    const { createMainMenuKeyboard } = await import('./utils/keyboards');
    const { MAIN_MENU_MESSAGE, formatMessage } = await import('./utils/messages');
    
    clearUserSession(userId);
    await bot.sendMessage(chatId, '✅ Operation cancelled\\. Returning to main menu\\.', { parse_mode: 'MarkdownV2' });
    
    // Show main menu
    await bot.sendMessage(
      chatId,
      formatMessage(MAIN_MENU_MESSAGE),
      { ...createMainMenuKeyboard(), parse_mode: MAIN_MENU_MESSAGE.parse_mode }
    );
  });

  // Handle regular text messages (for when users type instead of using buttons)
  bot.on('message', async (msg) => {
    // Skip if it's a command or if we already handled it
    if (msg.text?.startsWith('/') || !msg.text) return;
    
    const chatId = msg.chat.id;
    const userId = msg.from?.id || 0;
    const text = msg.text;
    
    if (!isAuthorized(userId)) {
      await bot.sendMessage(chatId, 'Unauthorized access');
      return;
    }
    
    // Check if user is waiting for input
    const { getUserSession, clearUserSession } = await import('./utils/sessions');
    const session = getUserSession(userId);
    
    // EXISTING HANDLERS (you already have these)
    if (session.waitingFor === 'lut_tip_input') {
      clearUserSession(userId);
      await prelaunchHandlers.handleCreateLUTWithTip(bot, chatId, userId, text);
      return;
    }

    if (session.waitingFor === 'vanity_private_key_input') {
      clearUserSession(userId);
      await prelaunchHandlers.handleVanityPrivateKeyInput(bot, chatId, userId, text);
      return;
    }
    
    if (session.waitingFor === 'vanity_contract_tip_input') {
      clearUserSession(userId);
      await prelaunchHandlers.handleVanityContractWithTip(bot, chatId, userId, text);
      return;
    }
    
    if (session.waitingFor === 'random_contract_tip_input') {
      clearUserSession(userId);
      await prelaunchHandlers.handleRandomContractWithTip(bot, chatId, userId, text);
      return;
    }
    
    if (session.waitingFor === 'send_sol_tip_input') {
      clearUserSession(userId);
      await prelaunchHandlers.handleSendSOLWithTip(bot, chatId, userId, text);
      return;
    }
    
    if (session.waitingFor === 'reclaim_sol_tip_input') {
      clearUserSession(userId);
      await prelaunchHandlers.handleReclaimSOLWithTip(bot, chatId, userId, text);
      return;
    }
  
    if (session.waitingFor === 'send_sol_tip_input') {
      clearUserSession(userId);
      await prelaunchHandlers.handleSendSOLWithTip(bot, chatId, userId, text);
      return;
    }
    
    if (session.waitingFor === 'reclaim_sol_tip_input') {
      clearUserSession(userId);
      await prelaunchHandlers.handleReclaimSOLWithTip(bot, chatId, userId, text);
      return;
    }
    
    // For any other text message, show the main menu
    const { createMainMenuKeyboard } = await import('./utils/keyboards');
    const { MAIN_MENU_MESSAGE, formatMessage } = await import('./utils/messages');
    
    await bot.sendMessage(
      chatId,
      formatMessage(MAIN_MENU_MESSAGE),
      { ...createMainMenuKeyboard(), parse_mode: MAIN_MENU_MESSAGE.parse_mode }
    );
  });

  // Enhanced error handlers
  bot.on('polling_error', (error: any) => {
    console.error('📡 Telegram polling error:', error.message);
    
    // Type guard for Telegram conflict error
    const isTelegramConflict = error && 
      error.code === 'ETELEGRAM' && 
      error.response?.body?.error_code === 409;
      
    if (isTelegramConflict) {
      console.log('⚠️ Another bot instance is detected. This instance will stop.');
    }
  });

  bot.on('error', (error: any) => {
    console.error('🤖 Telegram bot error:', error);
  });
  
  // Start polling with retry logic
  await startPollingWithRetry(bot);
  
  console.log('🤖 Telegram bot started!');
  console.log('📱 Send /start to your bot to begin');
  console.log(`🔧 Authorized users: ${AUTHORIZED_TELEGRAM_USERS.length > 0 ? AUTHORIZED_TELEGRAM_USERS.join(', ') : 'All users'}`);
  
  // Return the bot instance for external management
  return bot;
}

export default bot;