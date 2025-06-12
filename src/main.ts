import TelegramBot from 'node-telegram-bot-api';
import { BOT_TOKEN, AUTHORIZED_TELEGRAM_USERS } from './shared/config';
import { initBot } from './telegram/bot';

// Print startup banner
console.log('┌─────────────────────────────────────────────┐');
console.log('│           PUMP.FUN BUNDLER BOT              │');
console.log('│         Telegram-only Edition                │');
console.log('└─────────────────────────────────────────────┘');
console.log(`🤖 Starting Telegram bot...`);
console.log(`🔒 Authorized users: ${AUTHORIZED_TELEGRAM_USERS.length}`);

// Create and initialize the Telegram bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
initBot();

console.log('✅ Bot is now running!');
console.log('Press Ctrl+C to stop the bot.');

// Handle unhandled promise rejections
process.on('unhandledRejection', (error: any) => {
  console.error('Unhandled promise rejection:', error);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: any) => {
  console.error('Uncaught exception:', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping bot...');
  bot.stopPolling();
  process.exit(0);
});

export default bot;