// src/telegram/handlers/prelaunch.ts

import TelegramBot from 'node-telegram-bot-api';
import { extendUserLUT } from '../../core/lut';
import { simulateUserBuys, writeBuysToUserFile } from '../../core/simulation';
import { sendSimulationSOL, reclaimUserSOL } from '../../core/funding';

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
 * Handle contract address setup flow
 */
export async function handleExtendLUTFlow(bot: TelegramBot, chatId: number, userId: number): Promise<void> {
  // Check if user has LUT first
  const { getUserKeyInfoPath } = await import('../../shared/config');
  const { userHasKeypairs } = await import('../../core/keys');
  const fs = require('fs');
  
  if (!userHasKeypairs(userId)) {
    await bot.sendMessage(chatId, '❌ You need to create keypairs first\\.', { parse_mode: 'MarkdownV2' });
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
    '📦 **SET CONTRACT ADDRESS**\n\n' +
    'Choose how to set your token contract address:\n\n' +
    '🎯 **Vanity Address:** Import your custom private key\n' +
    '🎲 **Random Address:** Generate a new random address\n\n' +
    'Which option do you prefer?',
    { 
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🎯 Use Vanity Address', callback_data: 'contract_vanity' },
            { text: '🎲 Generate Random', callback_data: 'contract_random' }
          ],
          [
            { text: '🔙 Back', callback_data: 'pre_launch' }
          ]
        ]
      },
      parse_mode: 'MarkdownV2' 
    }
  );
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
 * Handle vanity contract address flow
 */
export async function handleVanityContractFlow(bot: TelegramBot, chatId: number, userId: number): Promise<void> {
  await bot.sendMessage(
    chatId,
    '🎯 **VANITY CONTRACT ADDRESS**\n\n' +
    'Please enter your vanity private key \\(in base58 format\\):\n\n' +
    '⚠️ **Important:** Make sure this is a valid base58 private key\\!',
    { parse_mode: 'MarkdownV2' }
  );
  
  // Set user session to wait for private key input
  const { setWaitingFor } = await import('../utils/sessions');
  setWaitingFor(userId, 'vanity_private_key_input');
}

/**
 * Handle random contract address flow
 */
export async function handleRandomContractFlow(bot: TelegramBot, chatId: number, userId: number): Promise<void> {
  await bot.sendMessage(
    chatId,
    '🎲 **RANDOM CONTRACT ADDRESS**\n\n' +
    'Please enter the Jito tip amount in SOL \\(e\\.g\\. 0\\.01\\):',
    { parse_mode: 'MarkdownV2' }
  );
  
  // Set user session to wait for tip input
  const { setWaitingFor } = await import('../utils/sessions');
  setWaitingFor(userId, 'random_contract_tip_input');
}

/**
 * Handle vanity private key input
 */
export async function handleVanityPrivateKeyInput(bot: TelegramBot, chatId: number, userId: number, privateKey: string): Promise<void> {
  try {
    // Validate the private key format
    const bs58 = require('bs58');
    
    try {
      const decoded = bs58.decode(privateKey);
      if (decoded.length !== 64) {
        throw new Error('Invalid key length');
      }
    } catch (error) {
      await bot.sendMessage(chatId, '❌ Invalid private key format\\. Please enter a valid base58 private key:', { parse_mode: 'MarkdownV2' });
      return;
    }
    
    await bot.sendMessage(
      chatId,
      '✅ **VALID PRIVATE KEY**\n\n' +
      'Please enter the Jito tip amount in SOL \\(e\\.g\\. 0\\.01\\):',
      { parse_mode: 'MarkdownV2' }
    );
    
    // Store the private key temporarily and wait for tip input
    const { setTempData, setWaitingFor } = await import('../utils/sessions');
    setTempData(userId, 'vanity_private_key', privateKey);
    setWaitingFor(userId, 'vanity_contract_tip_input');
    
  } catch (error: any) {
    console.error('Error validating private key:', error);
    await bot.sendMessage(chatId, '❌ Error validating private key\\. Please try again:', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Handle vanity contract with tip
 */
export async function handleVanityContractWithTip(bot: TelegramBot, chatId: number, userId: number, tipText: string): Promise<void> {
  try {
    const tipAmount = parseFloat(tipText);
    if (isNaN(tipAmount) || tipAmount <= 0) {
      await bot.sendMessage(chatId, '❌ Invalid tip amount\\. Please enter a valid number \\(e\\.g\\. 0\\.01\\):', { parse_mode: 'MarkdownV2' });
      return;
    }
    
    // Get the stored private key
    const { getTempData, clearTempData } = await import('../utils/sessions');
    const vanityPrivateKey = getTempData(userId, 'vanity_private_key');
    
    if (!vanityPrivateKey) {
      await bot.sendMessage(chatId, '❌ Private key not found\\. Please start over\\.', { parse_mode: 'MarkdownV2' });
      await returnToPreLaunchMenu(bot, chatId);
      return;
    }
    
    await bot.sendMessage(chatId, '⏳ Setting up contract with vanity address...');
    
    // Call the core LUT extend function with vanity key
    await extendUserLUT(userId, tipAmount, vanityPrivateKey);
    
    // Clear temporary data
    clearTempData(userId);
    
    const tipString = tipAmount.toString().replace(/\./g, '\\.');
    await bot.sendMessage(chatId, `✅ **SUCCESS\\!**\n\n🎯 Contract address set with vanity key\n💰 Jito tip: ${tipString} SOL`, { parse_mode: 'MarkdownV2' });
    
    // Return to pre-launch menu
    await returnToPreLaunchMenu(bot, chatId);
    
  } catch (error: any) {
    console.error('Error in vanity contract setup:', error);
    const errorText = `❌ **ERROR:**\n\n${error.message || error}`.replace(/[.!]/g, '\\$&');
    await bot.sendMessage(chatId, errorText, { parse_mode: 'MarkdownV2' });
    
    // Return to pre-launch menu on error
    await returnToPreLaunchMenu(bot, chatId);
  }
}

/**
 * Handle random contract with tip
 */
export async function handleRandomContractWithTip(bot: TelegramBot, chatId: number, userId: number, tipText: string): Promise<void> {
  try {
    const tipAmount = parseFloat(tipText);
    if (isNaN(tipAmount) || tipAmount <= 0) {
      await bot.sendMessage(chatId, '❌ Invalid tip amount\\. Please enter a valid number \\(e\\.g\\. 0\\.01\\):', { parse_mode: 'MarkdownV2' });
      return;
    }
    
    await bot.sendMessage(chatId, '⏳ Setting up contract with random address...');
    
    // Call the core LUT extend function without vanity key (null = random)
    await extendUserLUT(userId, tipAmount, null);
    
    const tipString = tipAmount.toString().replace(/\./g, '\\.');
    await bot.sendMessage(chatId, `✅ **SUCCESS\\!**\n\n🎲 Contract address set with random key\n💰 Jito tip: ${tipString} SOL`, { parse_mode: 'MarkdownV2' });
    
    // Return to pre-launch menu
    await returnToPreLaunchMenu(bot, chatId);
    
  } catch (error: any) {
    console.error('Error in random contract setup:', error);
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
  try {
    // Check if user has keypairs and LUT
    const { userHasKeypairs } = await import('../../core/keys');
    const { getUserKeyInfoPath } = await import('../../shared/config');
    const fs = require('fs');
    
    if (!userHasKeypairs(userId)) {
      await bot.sendMessage(chatId, '❌ You need to create keypairs first\\.', { parse_mode: 'MarkdownV2' });
      return;
    }
    
    const keyInfoPath = getUserKeyInfoPath(userId);
    if (!fs.existsSync(keyInfoPath)) {
      await bot.sendMessage(chatId, '❌ No keyInfo found\\. Please create and extend LUT first\\.', { parse_mode: 'MarkdownV2' });
      return;
    }
    
    const keyInfo = JSON.parse(fs.readFileSync(keyInfoPath, 'utf-8'));
    if (!keyInfo.addressLUT) {
      await bot.sendMessage(chatId, '❌ No LUT found\\. Please create and extend LUT first\\.', { parse_mode: 'MarkdownV2' });
      return;
    }
    
    await bot.sendMessage(chatId, '🎲 **SIMULATE BUYS**\n\nStarting buy simulation\\.\\.\\.\n\n⚠️ **Note:** This will use sample buy amounts\\. In a full implementation, you would configure individual wallet amounts\\.', { parse_mode: 'MarkdownV2' });
    
    // Run simulation
    const { buys, isValid } = await simulateUserBuys(userId);
    
    if (!isValid) {
      await bot.sendMessage(
        chatId,
        '🚨 **SIMULATION FAILED**\n\n' +
        'Your buy configuration violates Pump\\.fun constraints\\.\n' +
        'The pool creation will fail with these amounts\\.\n\n' +
        'Please reduce buy amounts and try again\\.',
        { parse_mode: 'MarkdownV2' }
      );
      await returnToPreLaunchMenu(bot, chatId);
      return;
    }
    
    // Write buys to file
    await writeBuysToUserFile(userId, buys);
    
    const totalSOL = buys.reduce((sum, buy) => sum + buy.solAmount, 0);
    const totalWallets = buys.length;
    
    await bot.sendMessage(
      chatId,
      `✅ **SIMULATION SUCCESS\\!**\n\n` +
      `📊 **Summary:**\n` +
      `• Wallets configured: ${totalWallets}\n` +
      `• Total SOL needed: ${totalSOL.toFixed(4)} SOL\n` +
      `• Simulation data saved\n\n` +
      `💡 **Next step:** Send SOL to fund wallets`,
      { parse_mode: 'MarkdownV2' }
    );
    
    await returnToPreLaunchMenu(bot, chatId);
    
  } catch (error: any) {
    console.error('Error in simulation:', error);
    const errorText = `❌ **ERROR:**\n\n${error.message || error}`.replace(/[.!]/g, '\\$&');
    await bot.sendMessage(chatId, errorText, { parse_mode: 'MarkdownV2' });
    
    await returnToPreLaunchMenu(bot, chatId);
  }
}

/**
 * Handle send SOL
 */
export async function handleSendSOL(bot: TelegramBot, chatId: number, userId: number): Promise<void> {
  try {
    // Check prerequisites
    const { userHasKeypairs } = await import('../../core/keys');
    const { getUserKeyInfoPath } = await import('../../shared/config');
    const fs = require('fs');
    
    if (!userHasKeypairs(userId)) {
      await bot.sendMessage(chatId, '❌ You need to create keypairs first\\.', { parse_mode: 'MarkdownV2' });
      return;
    }
    
    const keyInfoPath = getUserKeyInfoPath(userId);
    if (!fs.existsSync(keyInfoPath)) {
      await bot.sendMessage(chatId, '❌ No simulation data found\\. Please run simulation first\\.', { parse_mode: 'MarkdownV2' });
      return;
    }
    
    const keyInfo = JSON.parse(fs.readFileSync(keyInfoPath, 'utf-8'));
    if (!keyInfo.addressLUT) {
      await bot.sendMessage(chatId, '❌ No LUT found\\. Please create LUT first\\.', { parse_mode: 'MarkdownV2' });
      return;
    }
    
    // Check if simulation data exists
    const hasSimulationData = Object.keys(keyInfo).some(key => 
      key !== 'addressLUT' && key !== 'lutCreatedAt' && key !== 'numOfWallets' && 
      keyInfo[key].solAmount
    );
    
    if (!hasSimulationData) {
      await bot.sendMessage(chatId, '❌ No simulation data found\\. Please run simulation first\\.', { parse_mode: 'MarkdownV2' });
      return;
    }
    
    await bot.sendMessage(
      chatId,
      '💸 **SEND SOL TO WALLETS**\n\n' +
      'Please enter the Jito tip amount in SOL \\(e\\.g\\. 0\\.01\\):',
      { parse_mode: 'MarkdownV2' }
    );
    
    // Set user session to wait for tip input
    const { setWaitingFor } = await import('../utils/sessions');
    setWaitingFor(userId, 'send_sol_tip_input');
    
  } catch (error: any) {
    console.error('Error in send SOL preparation:', error);
    const errorText = `❌ **ERROR:**\n\n${error.message || error}`.replace(/[.!]/g, '\\$&');
    await bot.sendMessage(chatId, errorText, { parse_mode: 'MarkdownV2' });
    
    await returnToPreLaunchMenu(bot, chatId);
  }
}

/**
 * Handle send SOL with tip
 */
export async function handleSendSOLWithTip(bot: TelegramBot, chatId: number, userId: number, tipText: string): Promise<void> {
  try {
    const tipAmount = parseFloat(tipText);
    if (isNaN(tipAmount) || tipAmount <= 0) {
      await bot.sendMessage(chatId, '❌ Invalid tip amount\\. Please enter a valid number \\(e\\.g\\. 0\\.01\\):', { parse_mode: 'MarkdownV2' });
      return;
    }
    
    await bot.sendMessage(chatId, '⏳ Sending SOL to simulation wallets...');
    
    // Call the core send SOL function
    await sendSimulationSOL(userId, tipAmount);
    
    const tipString = tipAmount.toString().replace(/\./g, '\\.');
    await bot.sendMessage(chatId, `✅ **SUCCESS\\!**\n\n💸 SOL sent to all simulation wallets\n💰 Jito tip: ${tipString} SOL\n\n💡 **Ready for launch\\!**`, { parse_mode: 'MarkdownV2' });
    
    await returnToPreLaunchMenu(bot, chatId);
    
  } catch (error: any) {
    console.error('Error in send SOL:', error);
    const errorText = `❌ **ERROR:**\n\n${error.message || error}`.replace(/[.!]/g, '\\$&');
    await bot.sendMessage(chatId, errorText, { parse_mode: 'MarkdownV2' });
    
    await returnToPreLaunchMenu(bot, chatId);
  }
}

/**
 * Handle reclaim SOL
 */
export async function handleReclaimSOL(bot: TelegramBot, chatId: number, userId: number): Promise<void> {
  try {
    // Check if user has keypairs
    const { userHasKeypairs } = await import('../../core/keys');
    
    if (!userHasKeypairs(userId)) {
      await bot.sendMessage(chatId, '❌ You need to create keypairs first\\.', { parse_mode: 'MarkdownV2' });
      return;
    }
    
    await bot.sendMessage(
      chatId,
      '💰 **RECLAIM SOL**\n\n' +
      'This will return all SOL from your wallets back to the main wallet\\.\n\n' +
      'Please enter the Jito tip amount in SOL \\(e\\.g\\. 0\\.01\\):',
      { parse_mode: 'MarkdownV2' }
    );
    
    // Set user session to wait for tip input
    const { setWaitingFor } = await import('../utils/sessions');
    setWaitingFor(userId, 'reclaim_sol_tip_input');
    
  } catch (error: any) {
    console.error('Error in reclaim SOL preparation:', error);
    const errorText = `❌ **ERROR:**\n\n${error.message || error}`.replace(/[.!]/g, '\\$&');
    await bot.sendMessage(chatId, errorText, { parse_mode: 'MarkdownV2' });
    
    await returnToPreLaunchMenu(bot, chatId);
  }
}

/**
 * Handle reclaim SOL with tip
 */
export async function handleReclaimSOLWithTip(bot: TelegramBot, chatId: number, userId: number, tipText: string): Promise<void> {
  try {
    const tipAmount = parseFloat(tipText);
    if (isNaN(tipAmount) || tipAmount <= 0) {
      await bot.sendMessage(chatId, '❌ Invalid tip amount\\. Please enter a valid number \\(e\\.g\\. 0\\.01\\):', { parse_mode: 'MarkdownV2' });
      return;
    }
    
    await bot.sendMessage(chatId, '⏳ Reclaiming SOL from all wallets...');
    
    // Call the core reclaim SOL function
    await reclaimUserSOL(userId, tipAmount);
    
    const tipString = tipAmount.toString().replace(/\./g, '\\.');
    await bot.sendMessage(chatId, `✅ **SUCCESS\\!**\n\n💰 All SOL reclaimed from wallets\n💰 Jito tip: ${tipString} SOL`, { parse_mode: 'MarkdownV2' });
    
    await returnToPreLaunchMenu(bot, chatId);
    
  } catch (error: any) {
    console.error('Error in reclaim SOL:', error);
    const errorText = `❌ **ERROR:**\n\n${error.message || error}`.replace(/[.!]/g, '\\$&');
    await bot.sendMessage(chatId, errorText, { parse_mode: 'MarkdownV2' });
    
    await returnToPreLaunchMenu(bot, chatId);
  }
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