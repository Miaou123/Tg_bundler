import TelegramBot from 'node-telegram-bot-api';

/**
 * Check if user has keypairs and show appropriate options
 */
export async function handleCreateKeypairsCheck(bot: TelegramBot, chatId: number, userId: number): Promise<void> {
  const { userHasKeypairs, getUserWalletInfo } = await import('../../core/keys');
  
  if (userHasKeypairs(userId)) {
    // User already has keypairs, show them and options
    const walletInfo = getUserWalletInfo(userId);
    const { createKeypairKeyboard } = await import('../utils/keyboards');
    
    let message = '🔑 **EXISTING KEYPAIRS FOUND**\n\n';
    message += `📁 You already have ${walletInfo?.numOfWallets || 0} keypairs\n`;
    message += `📅 Created: ${walletInfo?.createdAt ? new Date(walletInfo.createdAt).toLocaleDateString() : 'Unknown'}\n\n`;
    message += '**First 5 wallet addresses:**\n\n';
    
    if (walletInfo?.wallets) {
      walletInfo.wallets.slice(0, 5).forEach((wallet: any, index: number) => {
        message += `Wallet ${index + 1}: \`${wallet.publicKey}\`\n`;
      });
      
      if (walletInfo.wallets.length > 5) {
        message += `\n\\.\\.\\. and ${walletInfo.wallets.length - 5} more wallets\n`;
      }
    }
    
    message += '\n**Choose an option:**';
    
    await bot.sendMessage(chatId, message, { 
      ...createKeypairKeyboard(), 
      parse_mode: 'MarkdownV2' 
    });
  } else {
    // User has no keypairs, only show create option
    await bot.sendMessage(
      chatId,
      '🔑 **CREATE KEYPAIRS**\n\n' +
      'You don\'t have any keypairs yet\\.\n\n' +
      '⚠️ **WARNING:** This will create 24 new wallet keypairs\\.',
      { parse_mode: 'MarkdownV2' }
    );
    
    // Directly create new keypairs
    await handleKeypairCreation(bot, chatId, userId, true);
  }
}

/**
 * Handle keypair creation (new or existing)
 */
export async function handleKeypairCreation(bot: TelegramBot, chatId: number, userId: number, createNew: boolean): Promise<void> {
  try {
    const { createOrUseUserKeypairs } = await import('../../core/keys');
    
    const operationType = createNew ? 'Creating new keypairs' : 'Loading existing keypairs';
    await bot.sendMessage(chatId, `⏳ ${operationType}...`);
    
    // Call the core function to create/load user-specific keypairs
    const wallets = await createOrUseUserKeypairs(userId, createNew, 24);
    
    // If creating new keypairs, clear any existing LUT info
    if (createNew) {
      const { clearUserLUTInfo } = await import('../../core/keys');
      await clearUserLUTInfo(userId);
    }
    
    const successMessage = createNew 
      ? `✅ **SUCCESS\\!**\n\n🔑 Created ${wallets.length} new keypairs\n📁 Saved to user_${userId}\\.json\n📋 Updated keyInfo_${userId}\\.json\n\n⚠️ **Note:** Previous LUT cleared \\- you need to create a new LUT for these wallets`
      : `✅ **SUCCESS\\!**\n\n📁 Loaded ${wallets.length} existing keypairs\n📋 Updated keyInfo_${userId}\\.json`;
    
    await bot.sendMessage(chatId, successMessage, { parse_mode: 'MarkdownV2' });
    
    // Show wallet info
    let walletInfo = '\n**WALLET INFO:**\n\n';
    wallets.slice(0, 5).forEach((wallet, index) => {
      walletInfo += `Wallet ${index + 1}: \`${wallet.publicKey.toString()}\`\n`;
    });
    
    if (wallets.length > 5) {
      walletInfo += `\n\\.\\.\\. and ${wallets.length - 5} more wallets`;
    }
    
    await bot.sendMessage(chatId, walletInfo, { parse_mode: 'MarkdownV2' });
    
    // Return to main menu
    await returnToMainMenu(bot, chatId);
    
  } catch (error: any) {
    console.error('Error in keypair creation:', error);
    const errorText = `❌ **ERROR:**\n\n${error.message || error}`.replace(/[.!]/g, '\\$&');
    await bot.sendMessage(chatId, errorText, { parse_mode: 'MarkdownV2' });
    
    // Return to main menu on error
    await returnToMainMenu(bot, chatId);
  }
}

/**
 * Helper function to return to main menu
 */
async function returnToMainMenu(bot: TelegramBot, chatId: number): Promise<void> {
  const { createMainMenuKeyboard } = await import('../utils/keyboards');
  const { MAIN_MENU_MESSAGE, formatMessage } = await import('../utils/messages');
  
  await bot.sendMessage(
    chatId,
    formatMessage(MAIN_MENU_MESSAGE),
    { ...createMainMenuKeyboard(), parse_mode: MAIN_MENU_MESSAGE.parse_mode }
  );
}