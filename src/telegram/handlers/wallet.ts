import TelegramBot from 'node-telegram-bot-api';
import { UserSession } from '../../shared/types';
import { setWaitingFor, addSessionData } from '../utils/sessions';
import { createKeypairKeyboard } from '../utils/keyboards';
import { CREATE_KEYPAIRS_MESSAGE, formatMessage, processingMessage, successMessage, errorMessage, consoleRequiredMessage } from '../utils/messages';
import { showMainMenu } from './index';
import { WAITING_FOR } from '../../shared/constants';
import { withTelegramPrompt } from '../utils/prompt';
import { createOrUseKeypairs, loadKeypairs } from '../../core/keys';
import { createLUT as coreLUT, extendLUT as coreExtendLUT } from '../../core/lut';

/**
 * Handle create keypairs command
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param session User session
 */
export async function handleCreateKeypairs(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  session: UserSession
): Promise<void> {
  await bot.sendMessage(
    chatId,
    formatMessage(CREATE_KEYPAIRS_MESSAGE),
    { ...createKeypairKeyboard(), parse_mode: CREATE_KEYPAIRS_MESSAGE.parse_mode }
  );
  
  setWaitingFor(userId, WAITING_FOR.KEYPAIRS_CHOICE);
}

/**
 * Handle wallet input
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 * @param session User session
 */
export async function handleWalletInput(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string,
  session: UserSession
): Promise<void> {
  const waitingFor = session.waitingFor;
  
  switch (waitingFor) {
    case WAITING_FOR.KEYPAIRS_CHOICE:
      await handleKeypairsChoice(bot, chatId, userId, text);
      break;
      
    case WAITING_FOR.JITO_TIP:
      if (session.currentFunction === 'createLUT') {
        await handleCreateLUTWithTip(bot, chatId, userId, text);
      } else if (session.currentFunction === 'extendLUT') {
        await handleExtendLUTWithTip(bot, chatId, userId, text);
      }
      break;
      
    case WAITING_FOR.VANITY_CHOICE:
      await handleVanityChoice(bot, chatId, userId, text);
      break;
      
    case WAITING_FOR.VANITY_PRIVATE_KEY:
      await handleVanityPrivateKey(bot, chatId, userId, text);
      break;
      
    default:
      await bot.sendMessage(chatId, '❓ Unexpected input. Returning to main menu.');
      await showMainMenu(bot, chatId);
  }
}

/**
 * Handle keypairs choice
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 */
async function handleKeypairsChoice(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string
): Promise<void> {
  try {
    await bot.sendMessage(chatId, processingMessage('Creating keypairs'));
    
    const createNew = text === '📝 Create New' || text.toLowerCase() === 'create new';
    
    // Execute the operation
    await withTelegramPrompt(
      bot,
      chatId,
      [createNew ? 'c' : 'u'],
      async () => {
        const wallets = await createOrUseKeypairs(createNew);
        return wallets;
      }
    );
    
    // Format success message based on operation
    const operationMsg = createNew 
      ? 'Created new keypairs' 
      : 'Loaded existing keypairs';
    
    await bot.sendMessage(chatId, successMessage(operationMsg));
    await showMainMenu(bot, chatId);
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('keypair operation', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Handle create LUT with tip
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text Tip amount
 */
async function handleCreateLUTWithTip(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string
): Promise<void> {
  try {
    const tipAmount = parseFloat(text);
    if (isNaN(tipAmount) || tipAmount <= 0) {
      await bot.sendMessage(chatId, '❌ Invalid tip amount. Please enter a valid number (e.g., 0.01):');
      return;
    }
    
    await bot.sendMessage(chatId, processingMessage('Creating Lookup Table'));
    
    // Execute the operation
    await withTelegramPrompt(
      bot,
      chatId,
      [text], // Pass the tip amount as input
      async () => {
        await coreLUT();
      }
    );
    
    await bot.sendMessage(chatId, successMessage('Lookup Table created'));
    await showMainMenu(bot, chatId);
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('LUT creation', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Handle extend LUT with tip
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text Tip amount
 */
async function handleExtendLUTWithTip(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string
): Promise<void> {
  // Logic for extending LUT with tip amount
  try {
    const tipAmount = parseFloat(text);
    if (isNaN(tipAmount) || tipAmount <= 0) {
      await bot.sendMessage(chatId, '❌ Invalid tip amount. Please enter a valid number (e.g., 0.01):');
      return;
    }
    
    await bot.sendMessage(chatId, processingMessage('Extending Lookup Table'));
    
    // Execute the operation
    await withTelegramPrompt(
      bot,
      chatId,
      [text], // Pass the tip amount as input
      async () => {
        await coreExtendLUT();
      }
    );
    
    await bot.sendMessage(chatId, successMessage('Lookup Table extended'));
    await showMainMenu(bot, chatId);
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('LUT extension', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Handle vanity choice
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 */
async function handleVanityChoice(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string
): Promise<void> {
  try {
    const useVanity = text.toLowerCase() === 'y' || text.toLowerCase() === 'yes';
    
    if (useVanity) {
      setWaitingFor(userId, WAITING_FOR.VANITY_PRIVATE_KEY);
      await bot.sendMessage(chatId, '🔑 Enter the private key of the vanity address (bs58):');
    } else {
      setWaitingFor(userId, WAITING_FOR.JITO_TIP);
      await bot.sendMessage(chatId, '💰 Enter Jito tip amount in SOL (e.g., 0.01):');
    }
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('vanity choice', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Handle vanity private key
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 */
async function handleVanityPrivateKey(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string
): Promise<void> {
  try {
    // Store the private key in session data
    addSessionData(userId, 'vanityPrivateKey', text);
    
    // Ask for Jito tip
    setWaitingFor(userId, WAITING_FOR.JITO_TIP);
    await bot.sendMessage(chatId, '💰 Enter Jito tip amount in SOL (e.g., 0.01):');
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('vanity key processing', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Handle create LUT
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param session User session
 */
export async function handleCreateLUT(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  session: UserSession
): Promise<void> {
  session.currentFunction = 'createLUT';
  setWaitingFor(userId, WAITING_FOR.JITO_TIP);
  await bot.sendMessage(chatId, '💰 Enter Jito tip amount in SOL (e.g., 0.01):');
}

/**
 * Handle extend LUT
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param session User session
 */
export async function handleExtendLUT(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  session: UserSession
): Promise<void> {
  session.currentFunction = 'extendLUT';
  setWaitingFor(userId, WAITING_FOR.VANITY_CHOICE);
  await bot.sendMessage(chatId, '🎯 Do you want to import a custom vanity address? (y/n):');
}

/**
 * Handle send SOL
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param session User session
 */
export async function handleSendSOL(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  session: UserSession
): Promise<void> {
  await bot.sendMessage(
    chatId,
    formatMessage(consoleRequiredMessage('Send SOL')),
    { parse_mode: 'MarkdownV2' }
  );
  await showMainMenu(bot, chatId);
}

/**
 * Handle reclaim SOL
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param session User session
 */
export async function handleReclaimSOL(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  session: UserSession
): Promise<void> {
  await bot.sendMessage(
    chatId,
    formatMessage(consoleRequiredMessage('Reclaim SOL')),
    { parse_mode: 'MarkdownV2' }
  );
  await showMainMenu(bot, chatId);
}

/**
 * Handle export wallets
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param session User session
 */
export async function handleExportWallets(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  session: UserSession
): Promise<void> {
  await bot.sendMessage(
    chatId,
    '📊 **Export Wallets**\n\n' +
    '⚠️ **SECURITY WARNING**\n' +
    'Wallet export contains private keys and should not be done via Telegram.\n\n' +
    '🔒 For security reasons, wallet export is disabled in the Telegram interface.',
    { parse_mode: 'MarkdownV2' }
  );
  await showMainMenu(bot, chatId);
}