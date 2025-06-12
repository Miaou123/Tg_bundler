import { initBot } from './src/telegram/bot';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Store bot instance for cleanup
let botInstance: any = null;

/**
 * Main application entry point
 * Only initializes the Telegram bot
 */
function main() {
  console.log('🚀 Starting Pump.Fun Bundler Telegram Bot...');
  
  try {
    // Initialize and start the Telegram bot
    botInstance = initBot();
    
    console.log('✅ Bot initialized successfully!');
  } catch (error) {
    console.error('❌ Failed to initialize bot:', error);
    process.exit(1);
  }
}

/**
 * Graceful shutdown function
 */
function gracefulShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}, shutting down Telegram bot...`);
  
  if (botInstance && typeof botInstance.stopPolling === 'function') {
    try {
      botInstance.stopPolling();
      console.log('✅ Bot polling stopped');
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
main();