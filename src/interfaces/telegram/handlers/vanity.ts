import TelegramBot from 'node-telegram-bot-api';
import { UserSession } from '../../shared/types';
import { setWaitingFor, addSessionData, getSessionData } from '../utils/sessions';
import { createVanityPatternTypeKeyboard } from '../utils/keyboards';
import { VANITY_ADDRESS_MESSAGE, VANITY_DIFFICULTY_MESSAGE, formatMessage, processingMessage, successMessage, errorMessage } from '../utils/messages';
import { showMainMenu } from './index';
import { WAITING_FOR, VALID_BASE58_CHARS } from '../../shared/constants';
import { calculateVanityDifficulty, generateVanityAddress } from '../../core/vanity';
import { withTelegramPrompt } from '../utils/prompt';

/**
 * Handle vanity address command
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param session User session
 */
export async function handleVanityAddress(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  session: UserSession
): Promise<void> {
  await bot.sendMessage(
    chatId,
    formatMessage(VANITY_ADDRESS_MESSAGE),
    { ...createVanityPatternTypeKeyboard(), parse_mode: VANITY_ADDRESS_MESSAGE.parse_mode }
  );
  
  setWaitingFor(userId, WAITING_FOR.VANITY_PATTERN_TYPE);
}

/**
 * Handle vanity difficulty command
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param session User session
 */
export async function handleVanityDifficulty(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  session: UserSession
): Promise<void> {
  await bot.sendMessage(
    chatId,
    formatMessage(VANITY_DIFFICULTY_MESSAGE),
    { parse_mode: VANITY_DIFFICULTY_MESSAGE.parse_mode }
  );
  
  setWaitingFor(userId, WAITING_FOR.VANITY_DIFFICULTY_PATTERN);
}

/**
 * Handle vanity inputs
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 * @param session User session
 */
export async function handleVanityInput(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string,
  session: UserSession
): Promise<void> {
  const waitingFor = session.waitingFor;
  
  switch (waitingFor) {
    case WAITING_FOR.VANITY_PATTERN_TYPE:
      await handleVanityPatternType(bot, chatId, userId, text);
      break;
      
    case WAITING_FOR.VANITY_PATTERN:
      await handleVanityPattern(bot, chatId, userId, text);
      break;
      
    case WAITING_FOR.VANITY_DIFFICULTY_PATTERN:
      await handleVanityDifficultyPattern(bot, chatId, userId, text);
      break;
      
    default:
      await bot.sendMessage(chatId, '❓ Unexpected input. Returning to main menu.');
      await showMainMenu(bot, chatId);
  }
}

/**
 * Handle vanity pattern type
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 */
async function handleVanityPatternType(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string
): Promise<void> {
  try {
    let isPrefix: boolean;
    let pattern: string | null = null;
    
    if (text.startsWith('1️⃣') || text === '1') {
      isPrefix = true;
    } else if (text.startsWith('2️⃣') || text === '2') {
      isPrefix = false;
    } else if (text.startsWith('3️⃣') || text === '3') {
      isPrefix = false;
      pattern = 'pump';
    } else if (text === '🔙 Main Menu') {
      await showMainMenu(bot, chatId);
      return;
    } else {
      await bot.sendMessage(chatId, '❌ Invalid choice. Please select 1, 2, or 3.');
      return;
    }
    
    addSessionData(userId, 'isPrefix', isPrefix);
    
    if (pattern) {
      // Quick pump pattern
      addSessionData(userId, 'pattern', pattern);
      await executeVanityGeneration(bot, chatId, userId);
    } else {
      // Ask for pattern
      await bot.sendMessage(
        chatId, 
        `🎯 Enter ${isPrefix ? 'prefix' : 'suffix'} (what address should ${isPrefix ? 'START' : 'END'} with):`,
        { parse_mode: 'MarkdownV2' }
      );
      setWaitingFor(userId, WAITING_FOR.VANITY_PATTERN);
    }
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('vanity pattern type', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Handle vanity pattern
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 */
async function handleVanityPattern(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string
): Promise<void> {
  try {
    if (text === '🔙 Main Menu') {
      await showMainMenu(bot, chatId);
      return;
    }
    
    // Validate pattern
    for (const char of text) {
      if (!VALID_BASE58_CHARS.includes(char)) {
        await bot.sendMessage(
          chatId, 
          `❌ Invalid character '${char}' in pattern\\!\n\n` +
          `📋 Valid characters: ${VALID_BASE58_CHARS.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&')}\n\n` +
          'Please enter a valid pattern:', 
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }
    }
    
    addSessionData(userId, 'pattern', text);
    await executeVanityGeneration(bot, chatId, userId);
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('vanity pattern', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Execute vanity generation
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 */
async function executeVanityGeneration(
  bot: TelegramBot,
  chatId: number,
  userId: number
): Promise<void> {
  try {
    const pattern = getSessionData(userId, 'pattern');
    const isPrefix = getSessionData(userId, 'isPrefix');
    
    await bot.sendMessage(
      chatId,
      `🔍 Searching for addresses ${isPrefix ? 'starting' : 'ending'} with: "${pattern}"\n\n` +
      '⏳ This may take a while\\.\\.\\.\n\n' +
      '💡 The bot will notify you when an address is found\\!',
      { parse_mode: 'MarkdownV2' }
    );
    
    // Get difficulty estimate
    const { attempts, timeEstimate } = calculateVanityDifficultyEstimate(pattern);
    
    await bot.sendMessage(
      chatId,
      `📊 *DIFFICULTY ANALYSIS:*\n` +
      `🎯 Pattern length: ${pattern.length} characters\n` +
      `🔢 Average attempts needed: ${attempts.toLocaleString()}\n` +
      `⏱️ Estimated time: ${timeEstimate}\n\n` +
      `Starting generation process\\.\\.\\.`,
      { parse_mode: 'MarkdownV2' }
    );
    
    // For patterns that would take too long, show a warning
    if (pattern.length > 4 || (pattern.length === 4 && pattern !== 'pump')) {
      await bot.sendMessage(
        chatId,
        '⚠️ This pattern may take a very long time to generate\\.\n' +
        'For patterns longer than 3 characters, it\'s recommended to use the console version\\.',
        { parse_mode: 'MarkdownV2' }
      );
      await showMainMenu(bot, chatId);
      return;
    }
    
    // For manageable patterns, attempt to generate
    let progress = 0;
    const progressMsg = await bot.sendMessage(chatId, '🔍 Progress: 0%');
    
    // Update progress every 5 seconds
    const progressInterval = setInterval(async () => {
      progress += 5;
      if (progress <= 95) {
        await bot.editMessageText('🔍 Progress: ' + progress + '%', {
          chat_id: chatId,
          message_id: progressMsg.message_id
        });
      }
    }, 5000);
    
    try {
      // Execute vanity generation
      const result = await withTelegramPrompt(
        bot,
        chatId,
        [],
        async () => {
          return await generateVanityAddress(pattern, isPrefix);
        }
      );
      
      clearInterval(progressInterval);
      
      // Show result
      if (result) {
        await bot.editMessageText('🔍 Progress: 100% - Complete!', {
          chat_id: chatId,
          message_id: progressMsg.message_id
        });
        
        await bot.sendMessage(
          chatId,
          `🎉 *VANITY ADDRESS FOUND!*\n\n` +
          `🔑 Address: \`${result.publicKey}\`\n` +
          `🔐 Private Key: \`${result.privateKey}\`\n\n` +
          `⚠️ **SECURITY WARNING:** Save this private key in a secure location\\!`,
          { parse_mode: 'MarkdownV2' }
        );
      } else {
        await bot.editMessageText('❌ Failed to generate vanity address', {
          chat_id: chatId,
          message_id: progressMsg.message_id
        });
      }
    } catch (error) {
      clearInterval(progressInterval);
      await bot.editMessageText(`❌ Error: ${error}`, {
        chat_id: chatId,
        message_id: progressMsg.message_id
      });
    }
    
    await showMainMenu(bot, chatId);
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('vanity generation', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Handle vanity difficulty pattern
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 */
async function handleVanityDifficultyPattern(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string
): Promise<void> {
  try {
    const pattern = text.trim();
    
    if (pattern === '🔙 Main Menu') {
      await showMainMenu(bot, chatId);
      return;
    }
    
    // Validate pattern
    for (const char of pattern) {
      if (!VALID_BASE58_CHARS.includes(char)) {
        await bot.sendMessage(
          chatId, 
          `❌ Invalid character '${char}' in pattern\\!\n\n` +
          `📋 Valid characters: ${VALID_BASE58_CHARS.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&')}\n\n` +
          'Please enter a valid pattern:', 
          { parse_mode: 'MarkdownV2' }
        );
        return;
      }
    }
    
    // Calculate difficulty
    const { attempts, timeEstimate, difficultyRating, recommendations } = calculateVanityDifficultyEstimate(pattern);
    
    let difficultyText = `📊 *DIFFICULTY ANALYSIS FOR: "${pattern}"*\n\n`;
    difficultyText += `🎯 Pattern length: ${pattern.length} characters\n`;
    difficultyText += `🔢 Average attempts needed: ${attempts.toLocaleString()}\n`;
    difficultyText += `⏱️ Estimated time: ${timeEstimate}\n\n`;
    
    difficultyText += `💡 *RECOMMENDATIONS:*\n`;
    difficultyText += recommendations;
    
    if (pattern.toLowerCase() === "pump") {
      difficultyText += `\n🚀 But worth it for pump\\.fun launches\\!`;
    }
    
    await bot.sendMessage(chatId, difficultyText, { parse_mode: 'MarkdownV2' });
    
    await showMainMenu(bot, chatId);
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('difficulty calculation', error));
    await showMainMenu(bot, chatId);
  }
}

/**
 * Calculate vanity difficulty estimate
 * @param pattern Pattern to check
 * @returns Difficulty statistics
 */
function calculateVanityDifficultyEstimate(pattern: string): {
  attempts: number;
  timeEstimate: string;
  difficultyRating: string;
  recommendations: string;
} {
  const difficulty = Math.pow(58, pattern.length);
  const attempts = difficulty / 2;
  const estimatedSeconds = attempts / 100000; // Assuming 100k attempts/sec
  const estimatedMinutes = estimatedSeconds / 60;
  const estimatedHours = estimatedMinutes / 60;
  const estimatedDays = estimatedHours / 24;
  
  let timeEstimate: string;
  if (estimatedSeconds < 60) {
    timeEstimate = `${estimatedSeconds.toFixed(1)} seconds`;
  } else if (estimatedMinutes < 60) {
    timeEstimate = `${estimatedMinutes.toFixed(1)} minutes`;
  } else if (estimatedHours < 24) {
    timeEstimate = `${estimatedHours.toFixed(1)} hours`;
  } else {
    timeEstimate = `${estimatedDays.toFixed(1)} days`;
  }
  
  let difficultyRating: string;
  let recommendations: string;
  
  if (pattern.length <= 2) {
    difficultyRating = 'Very Easy';
    recommendations = `✅ Very fast \\- should find in seconds/minutes`;
  } else if (pattern.length === 3) {
    difficultyRating = 'Moderate';
    recommendations = `⚠️ Moderate \\- may take several minutes`;
  } else if (pattern.length === 4) {
    difficultyRating = 'Difficult';
    recommendations = `🔥 Difficult \\- could take hours`;
  } else {
    difficultyRating = 'Very Difficult';
    recommendations = `🚫 Very difficult \\- could take days/weeks\n`;
    recommendations += `💡 Consider using a shorter pattern`;
  }
  
  return {
    attempts,
    timeEstimate,
    difficultyRating,
    recommendations
  };
}