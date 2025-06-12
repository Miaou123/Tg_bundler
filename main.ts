import { initBot } from './src/telegram/bot';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Main application entry point
 * Only initializes the Telegram bot
 */
function main() {
  console.log('🚀 Starting Pump.Fun Bundler Telegram Bot...');
  
  try {
    // Initialize and start the Telegram bot
    initBot();
    
    console.log('✅ Bot initialized successfully!');
  } catch (error) {
    console.error('❌ Failed to initialize bot:', error);
    process.exit(1);
  }
}

// Run the main function
main();