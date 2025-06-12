import TelegramBot from 'node-telegram-bot-api';
import { UserSession } from '../../shared/types';
import { checkAllWalletBalances } from '../../core/export';
import { showMainMenu } from './index';
import { splitMessage, escapeMarkdown } from '../../shared/utils';
import { errorMessage } from '../utils/messages';

/**
 * Handle check balances command
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param session User session
 */
export async function handleCheckBalances(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  session: UserSession
): Promise<void> {
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
    if (output) {
      // Escape special characters for MarkdownV2
      const escapedOutput = escapeMarkdown(output);
      
      // Split large outputs into chunks
      const chunks = splitMessage(escapedOutput, 4000);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, `\`\`\`\n${chunk}\n\`\`\``, { parse_mode: 'MarkdownV2' });
      }
    } else {
      await bot.sendMessage(chatId, '❌ No wallet balance information available.');
    }
    
  } catch (error) {
    await bot.sendMessage(chatId, errorMessage('wallet balance check', error));
  }
  
  await showMainMenu(bot, chatId);
}

/**
 * Handle info inputs
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param userId User ID
 * @param text User input
 * @param session User session
 */
export async function handleInfoInput(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  text: string,
  session: UserSession
): Promise<void> {
  await bot.sendMessage(chatId, '❓ Unexpected info command. Returning to main menu.');
  await showMainMenu(bot, chatId);
}