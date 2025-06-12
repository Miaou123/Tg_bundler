import TelegramBot from 'node-telegram-bot-api';

/**
 * Check if user has LUT and show appropriate options
 */
export async function handleCreateLUTCheck(bot: TelegramBot, chatId: number, userId: number): Promise<void> {
  const { getUserKeyInfoPath } = await import('../../shared/config');
  const { userHasKeypairs } = await import('../../core/keys');
  const fs = require('fs');
  
  // First check if user has keypairs
  if (!userHasKeypairs(userId)) {
    await bot.sendMessage(
      chatId, 
      '❌ **NO KEYPAIRS FOUND**\n\n' +
      'You need to create keypairs first before creating a LUT\\.\n\n' +
      'Please go to: Main Menu → Create Keypairs',
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }
  
  // Check if user already has LUT
  const keyInfoPath = getUserKeyInfoPath(userId);
  let hasLUT = false;
  let lutAddress = '';
  let lutCreatedAt = '';
  
  if (fs.existsSync(keyInfoPath)) {
    try {
      const keyInfo = JSON.parse(fs.readFileSync(keyInfoPath, 'utf-8'));
      if (keyInfo.addressLUT) {
        hasLUT = true;
        lutAddress = keyInfo.addressLUT;
        lutCreatedAt = keyInfo.lutCreatedAt || 'Unknown';
      }
    } catch (error) {
      // File exists but is corrupted, proceed as if no LUT
    }
  }
  
  if (hasLUT) {
    // User already has LUT, show info and option to create new one
    await bot.sendMessage(
      chatId,
      '🔗 **EXISTING LUT FOUND**\n\n' +
      `📋 LUT Address: \`${lutAddress.slice(0, 8)}\\.\\.\\.${lutAddress.slice(-8)}\`\n` +
      `📅 Created: ${new Date(lutCreatedAt).toLocaleDateString()}\n\n` +
      '⚠️ **WARNING:** Creating a new LUT will overwrite the existing one\\.\n\n' +
      'Do you want to create a new LUT?',
      { 
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Create New LUT', callback_data: 'confirm_create_lut' },
              { text: '❌ Cancel', callback_data: 'pre_launch' }
            ]
          ]
        },
        parse_mode: 'MarkdownV2' 
      }
    );
  } else {
    // User has no LUT, proceed with creation
    await handleCreateLUTFlow(bot, chatId, userId);
  }
}

/**
 * Handle LUT creation flow
 */
export async function handleCreateLUTFlow(bot: TelegramBot, chatId: number, userId: number): Promise<void> {
  await bot.sendMessage(
    chatId,
    '🔗 **CREATE LOOKUP TABLE**\n\n' +
    'Please enter the Jito tip amount in SOL \\(e\\.g\\. 0\\.01\\):',
    { parse_mode: 'MarkdownV2' }
  );
  
  // Set user session to wait for tip input
  const { setWaitingFor } = await import('../utils/sessions');
  setWaitingFor(userId, 'lut_tip_input');
}

/**
 * Handle LUT extend flow
 */
export async function handleExtendLUTFlow(bot: TelegramBot, chatId: number, userId: number): Promise<void> {
  // Check if user has LUT first
  const { getUserKeyInfoPath } = await import('../../shared/config');
  const { userHasKeypairs } = await import('../../core/keys');
  const fs = require('fs');
  
  if (!userHasKeypairs(userId)) {
    await bot.sendMessage(chatId, '❌ You need to create keypairs first before extending LUT\\.', { parse_mode: 'MarkdownV2' });
    return;
  }
  
  const keyInfoPath = getUserKeyInfoPath(userId);
  if (!fs.existsSync(keyInfoPath)) {
    await bot.sendMessage(chatId, '❌ No keyInfo found\\. Please create LUT first\\.', { parse_mode: 'MarkdownV2' });
    return;
  }
  
  const keyInfo = JSON.parse(fs.readFileSync(keyInfoPath, 'utf-8'));
  if (!keyInfo.addressLUT) {
    await bot.sendMessage(chatId, '❌ No LUT address found\\. Please create LUT first\\.', { parse_mode: 'MarkdownV2' });
    return;
  }
  
  await bot.sendMessage(
    chatId,
    '📦 **EXTEND LOOKUP TABLE**\n\n' +
    'Please enter the Jito tip amount in SOL \\(e\\.g\\. 0\\.01\\):',
    { parse_mode: 'MarkdownV2' }
  );
  
  // Set user session to wait for tip input
  const { setWaitingFor } = await import('../utils/sessions');
  setWaitingFor(userId, 'extend_lut_tip_input');
}

/**
 * Handle LUT creation with tip
 */
export async function handleCreateLUTWithTip(bot: TelegramBot, chatId: number, userId: number, tipText: string): Promise<void> {
  try {
    const tipAmount = parseFloat(tipText);
    if (isNaN(tipAmount) || tipAmount <= 0) {
      await bot.sendMessage(chatId, '❌ Invalid tip amount\\. Please enter a valid number \\(e\\.g\\. 0\\.01\\):', { parse_mode: 'MarkdownV2' });
      return;
    }
    
    await bot.sendMessage(chatId, '⏳ Creating Lookup Table...');
    
    // Call the core LUT creation function
    const { createUserLUT } = await import('../../core/lut');
    await createUserLUT(userId, tipAmount);
    
    const tipString = tipAmount.toString().replace(/\./g, '\\.');
    await bot.sendMessage(chatId, `✅ **SUCCESS\\!**\n\n🔗 Lookup Table created successfully\n💰 Jito tip: ${tipString} SOL`, { parse_mode: 'MarkdownV2' });
    
    // Return to pre-launch menu instead of main menu
    await returnToPreLaunchMenu(bot, chatId);
    
  } catch (error: any) {
    console.error('Error in LUT creation:', error);
    const errorText = `❌ **ERROR:**\n\n${error.message || error}`.replace(/[.!]/g, '\\$&');
    await bot.sendMessage(chatId, errorText, { parse_mode: 'MarkdownV2' });
    
    // Return to pre-launch menu on error
    await returnToPreLaunchMenu(bot, chatId);
  }
}

/**
 * Handle LUT extend with tip
 */
export async function handleExtendLUTWithTip(bot: TelegramBot, chatId: number, userId: number, tipText: string): Promise<void> {
  try {
    const tipAmount = parseFloat(tipText);
    if (isNaN(tipAmount) || tipAmount <= 0) {
      await bot.sendMessage(chatId, '❌ Invalid tip amount\\. Please enter a valid number \\(e\\.g\\. 0\\.01\\):', { parse_mode: 'MarkdownV2' });
      return;
    }
    
    await bot.sendMessage(chatId, '⏳ Extending Lookup Table...');
    
    // Call the core LUT extend function
    const { extendUserLUT } = await import('../../core/lut');
    await extendUserLUT(userId, tipAmount);
    
    const tipString = tipAmount.toString().replace(/\./g, '\\.');
    await bot.sendMessage(chatId, `✅ **SUCCESS\\!**\n\n📦 Lookup Table extended successfully\n💰 Jito tip: ${tipString} SOL`, { parse_mode: 'MarkdownV2' });
    
    // Return to pre-launch menu instead of main menu
    await returnToPreLaunchMenu(bot, chatId);
    
  } catch (error: any) {
    console.error('Error in LUT extension:', error);
    const errorText = `❌ **ERROR:**\n\n${error.message || error}`.replace(/[.!]/g, '\\$&');
    await bot.sendMessage(chatId, errorText, { parse_mode: 'MarkdownV2' });
    
    // Return to pre-launch menu on error
    await returnToPreLaunchMenu(bot, chatId);
  }
}

/**
 * Handle simulate buys
 */
export async function handleSimulateBuys(bot: TelegramBot, chatId: number, userId: number): Promise<void> {
  await bot.sendMessage(chatId, '🎲 Simulate Buys feature is coming soon...', { parse_mode: 'MarkdownV2' });
  
  // Return to pre-launch menu
  await returnToPreLaunchMenu(bot, chatId);
}

/**
 * Handle send SOL
 */
export async function handleSendSOL(bot: TelegramBot, chatId: number, userId: number): Promise<void> {
  await bot.sendMessage(chatId, '💸 Send SOL feature is coming soon...', { parse_mode: 'MarkdownV2' });
  
  // Return to pre-launch menu
  await returnToPreLaunchMenu(bot, chatId);
}

/**
 * Handle reclaim SOL
 */
export async function handleReclaimSOL(bot: TelegramBot, chatId: number, userId: number): Promise<void> {
  await bot.sendMessage(chatId, '💰 Reclaim SOL feature is coming soon...', { parse_mode: 'MarkdownV2' });
  
  // Return to pre-launch menu
  await returnToPreLaunchMenu(bot, chatId);
}

/**
 * Helper function to return to pre-launch menu
 */
async function returnToPreLaunchMenu(bot: TelegramBot, chatId: number): Promise<void> {
  const { createPreLaunchKeyboard } = await import('../utils/keyboards');
  const { PRE_LAUNCH_MESSAGE, formatMessage } = await import('../utils/messages');
  
  await bot.sendMessage(
    chatId,
    formatMessage(PRE_LAUNCH_MESSAGE),
    { ...createPreLaunchKeyboard(), parse_mode: PRE_LAUNCH_MESSAGE.parse_mode }
  );
}

/**
 * Helper function to return to main menu (keep for other operations that need it)
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