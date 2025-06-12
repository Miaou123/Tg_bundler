import { initBot } from './telegram/bot';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Store bot instance for cleanup
let botInstance: any = null;

/**
 * Main application entry point
 * Only initializes the Telegram bot
 */
async function main() {
  // Print startup banner
  console.log('┌─────────────────────────────────────────────┐');
  console.log('│           PUMP.FUN BUNDLER BOT              │');
  console.log('│         Telegram-only Edition                │');
  console.log('└─────────────────────────────────────────────┘');
  
  console.log('🚀 Starting Pump.Fun Bundler Telegram Bot...');
  
  try {
    // Initialize and start the Telegram bot
    botInstance = await initBot();
    
    console.log('✅ Bot initialized successfully!');
    console.log('Press Ctrl+C to stop the bot.');
  } catch (error: any) {
    console.error('❌ Failed to initialize bot:', error.message);
    
    if (error.code === 'ETELEGRAM' && error.response?.body?.error_code === 409) {
      console.log('💡 Another bot instance is running. Please:');
      console.log('   1. Kill any existing bot processes');
      console.log('   2. Wait 30-60 seconds');
      console.log('   3. Try again');
    }
    
    process.exit(1);
  }
}

/**
 * Graceful shutdown function
 */
async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}, shutting down Telegram bot...`);
  
  if (botInstance && typeof botInstance.stopPolling === 'function') {
    try {
      if (botInstance.isPolling()) {
        await botInstance.stopPolling();
        console.log('✅ Bot polling stopped');
      }
    } catch (error) {
      console.error('⚠️ Error stopping bot polling:', error);
    }
  }
  
  console.log('👋 Goodbye!');
  process.exit(0);
}

// Setup graceful shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// Run the main function
main().catch((error) => {
  console.error('💥 Fatal error in main:', error);
  process.exit(1);
});