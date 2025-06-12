import { MessageTemplate } from '../../shared/types';
import { escapeMarkdown } from '../../shared/utils';

/**
 * Welcome message shown after /start command
 */
export const WELCOME_MESSAGE: MessageTemplate = {
  title: '🎉 Welcome to Pump.Fun Bundler Bot!',
  content: `This bot provides the same functionality as the console bundler but through Telegram.

⚠️ **Security Notice:**
- Keep your private keys secure
- Only use with trusted networks
- Some functions may direct you to console for security

🔧 **Setup Requirements:**
- Bundler files properly configured
- .env file with all required variables
- Sufficient SOL in wallets

Ready to start?`,
  parse_mode: 'MarkdownV2'
};

/**
 * Help message shown after /help command
 */
export const HELP_MESSAGE: MessageTemplate = {
  title: '📖 HELP & COMMANDS',
  content: `**Basic Commands:**
/start - Start the bot
/help - Show this help
/status - Check bot status
/cancel - Cancel current operation

**Main Functions:**
🔑 Create Keypairs - Generate up to 24 wallets
📋 Pre Launch - Complete setup checklist  
🚀 Create Pool - Launch token (console recommended)
💰 Sell/Buy - Trade tokens on Pump.fun/PumpSwap
🧹 Cleanup - Sell all tokens and return SOL

**Security:**
- Private operations use console for safety
- Only authorized users can access
- Session data is temporary

**Support:**
For issues, check the console output or contact support.`,
  parse_mode: 'MarkdownV2'
};

/**
 * Main menu message
 */
export const MAIN_MENU_MESSAGE: MessageTemplate = {
  title: '🤖 PUMP.FUN BUNDLER BOT',
  content: `Choose an option from the menu below:

🔑 **Create Keypairs** - Generate wallet keypairs
📋 **Pre Launch** - Setup before launch
🚀 **Create Pool** - Launch your token
💰 **Sell Tokens** - Sell on Pump.fun/PumpSwap
💸 **Buy Tokens** - Buy on Pump.fun/PumpSwap
🧹 **Cleanup All** - Sell all tokens & return SOL
📊 **Export Wallets** - Export all wallet keys
💰 **Check Balances** - Quick balance check
🎯 **Vanity Address** - Generate custom address
📊 **Vanity Calc** - Check difficulty
❌ **Exit** - Close the bot`,
  parse_mode: 'MarkdownV2'
};

/**
 * Pre-launch menu message
 */
export const PRE_LAUNCH_MESSAGE: MessageTemplate = {
  title: '📋 PRE LAUNCH CHECKLIST',
  content: `Complete these steps before launching:

🔗 **Create LUT** - Create Lookup Table
📦 **Extend LUT** - Extend LUT with addresses
🎲 **Simulate Buys** - Test buy configurations
💸 **Send SOL** - Fund wallets for launch
💰 **Reclaim SOL** - Return unused SOL
🔙 **Main Menu** - Return to main menu`,
  parse_mode: 'MarkdownV2'
};

/**
 * Create keypairs message
 */
export const CREATE_KEYPAIRS_MESSAGE: MessageTemplate = {
  title: '🔑 CREATE KEYPAIRS',
  content: `⚠️ **WARNING:** Creating new wallets will replace existing ones!
Ensure you don't have SOL in existing wallets.

Choose an option:`,
  parse_mode: 'MarkdownV2'
};

/**
 * Vanity address generator message
 */
export const VANITY_ADDRESS_MESSAGE: MessageTemplate = {
  title: '🎯 VANITY ADDRESS GENERATOR',
  content: `Generate custom addresses with your desired pattern!

**Examples:**
• Start: 'ABC' → ABC... (addresses starting with ABC)
• End: 'pump' → ...pump (addresses ending with pump)

⚠️ **Note:** Longer patterns take exponentially longer to find!

Choose pattern type:`,
  parse_mode: 'MarkdownV2'
};

/**
 * Vanity difficulty calculator message
 */
export const VANITY_DIFFICULTY_MESSAGE: MessageTemplate = {
  title: '📊 VANITY DIFFICULTY CALCULATOR',
  content: `Enter a pattern to check its difficulty:

Examples:
• "ABC" - 3 character pattern
• "pump" - 4 character pattern
• "123" - number pattern

Enter pattern:`,
  parse_mode: 'MarkdownV2'
};

/**
 * Console function message
 * @param functionName Function name
 * @returns Message template
 */
export function consoleRequiredMessage(functionName: string): MessageTemplate {
  return {
    title: `⚠️ ${functionName.toUpperCase()}`,
    content: `This function requires console interaction for security and complexity.

💡 **Steps:**
1. Open your terminal
2. Run: \`npm start\`
3. Select the appropriate option
4. Follow the interactive prompts

🔒 **Security:** Critical operations use console for maximum safety.`,
    parse_mode: 'MarkdownV2'
  };
}

/**
 * Format a message using the template
 * @param template Message template
 * @returns Formatted message string
 */
export function formatMessage(template: MessageTemplate): string {
  if (template.parse_mode === 'MarkdownV2') {
    const escapedTitle = escapeMarkdown(template.title);
    const escapedContent = escapeMarkdown(template.content);
    return `${escapedTitle}\n${template.title.includes('=') ? '='.repeat(template.title.length) : ''}\n\n${escapedContent}`;
  }
  
  return `${template.title}\n${template.title.includes('=') ? '='.repeat(template.title.length) : ''}\n\n${template.content}`;
}

/**
 * Creates a processing message
 * @param operation Operation name
 * @returns Message string
 */
export function processingMessage(operation: string): string {
  return `🔄 ${operation} in progress...`;
}

/**
 * Creates a success message
 * @param operation Operation name
 * @returns Message string
 */
export function successMessage(operation: string): string {
  return `✅ ${operation} completed successfully!`;
}

/**
 * Creates an error message
 * @param operation Operation name
 * @param error Error details
 * @returns Message string
 */
export function errorMessage(operation: string, error: any): string {
  return `❌ Error during ${operation}: ${error}`;
}

export default {
  WELCOME_MESSAGE,
  HELP_MESSAGE,
  MAIN_MENU_MESSAGE,
  PRE_LAUNCH_MESSAGE,
  CREATE_KEYPAIRS_MESSAGE,
  VANITY_ADDRESS_MESSAGE,
  VANITY_DIFFICULTY_MESSAGE,
  consoleRequiredMessage,
  formatMessage,
  processingMessage,
  successMessage,
  errorMessage
};