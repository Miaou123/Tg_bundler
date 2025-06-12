import TelegramBot from 'node-telegram-bot-api';

/**
 * Handle export wallets
 */
export async function handleExportWallets(bot: TelegramBot, chatId: number, userId: number): Promise<void> {
  await bot.sendMessage(
    chatId,
    '📊 **EXPORT WALLETS**\n\n' +
    'This feature will export your wallet keys to a file\\.\n\n' +
    '⚠️ **Coming Soon** \\- This feature is being implemented\\.',
    { parse_mode: 'MarkdownV2' }
  );
}

/**
 * Handle check balances
 */
export async function handleCheckBalances(bot: TelegramBot, chatId: number, userId: number): Promise<void> {
  try {
    const { userHasKeypairs, loadUserKeypairs } = await import('../../core/keys');
    const { connection } = await import('../../shared/config');
    
    if (!userHasKeypairs(userId)) {
      await bot.sendMessage(
        chatId,
        '❌ **NO KEYPAIRS FOUND**\n\n' +
        'You need to create keypairs first\\.\n\n' +
        'Please go to: Main Menu → Create Keypairs',
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }
    
    await bot.sendMessage(chatId, '⏳ Checking balances\\.\\.\\.');
    
    const wallets = loadUserKeypairs(userId);
    let totalSOL = 0;
    let message = '💰 **WALLET BALANCES**\n\n';
    
    // Check first 5 wallets
    for (let i = 0; i < Math.min(5, wallets.length); i++) {
      const wallet = wallets[i];
      try {
        const balance = await connection.getBalance(wallet.publicKey);
        const solBalance = balance / 1e9; // Convert lamports to SOL
        totalSOL += solBalance;
        
        const balanceStr = solBalance.toFixed(4).replace(/\./g, '\\.');
        message += `Wallet ${i + 1}: ${balanceStr} SOL\n`;
      } catch (error) {
        message += `Wallet ${i + 1}: Error checking balance\n`;
      }
    }
    
    if (wallets.length > 5) {
      message += `\n\\.\\.\\. and ${wallets.length - 5} more wallets\n`;
      
      // Check remaining wallets for total
      for (let i = 5; i < wallets.length; i++) {
        try {
          const balance = await connection.getBalance(wallets[i].publicKey);
          totalSOL += balance / 1e9;
        } catch (error) {
          // Skip if error
        }
      }
    }
    
    const totalStr = totalSOL.toFixed(4).replace(/\./g, '\\.');
    message += `\n**Total SOL:** ${totalStr}`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
    
  } catch (error: any) {
    console.error('Error checking balances:', error);
    const errorText = `❌ **ERROR:**\n\n${error.message || error}`.replace(/[.!]/g, '\\$&');
    await bot.sendMessage(chatId, errorText, { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Handle status command
 * @param chatId Chat ID to send status to
 * @param userId User ID for user-specific status
 */
export async function handleStatusCommand(bot: TelegramBot, chatId: number, userId: number): Promise<void> {
  try {
    const { getUserKeyInfoPath } = await import('../../shared/config');
    const { userHasKeypairs, getUserWalletInfo } = await import('../../core/keys');
    const fs = require('fs');
    
    let statusText = '📊 **BOT STATUS**\n\n';
    
    // Check user-specific keypairs
    if (userHasKeypairs(userId)) {
      const walletInfo = getUserWalletInfo(userId);
      statusText += '✅ Your keypairs exist\n';
      statusText += `📁 Wallets: ${walletInfo?.numOfWallets || 'Unknown'}\n`;
      statusText += `📅 Created: ${walletInfo?.createdAt ? new Date(walletInfo.createdAt).toLocaleDateString() : 'Unknown'}\n`;
    } else {
      statusText += '❌ No keypairs found for your account\n';
      statusText += '💡 Create keypairs first\n';
    }
    
    // Check user-specific keyInfo
    const keyInfoPath = getUserKeyInfoPath(userId);
    if (fs.existsSync(keyInfoPath)) {
      const keyInfo = JSON.parse(fs.readFileSync(keyInfoPath, 'utf-8'));
      statusText += `🔗 LUT: ${keyInfo.addressLUT ? 'Ready' : 'Missing'}\n`;
      statusText += `🪙 Mint: ${keyInfo.mint ? 'Configured' : 'Missing'}\n`;
    }
    
    statusText += `\n🤖 Bot: Online\n👤 User: ${userId}`;
    
    await bot.sendMessage(chatId, statusText.replace(/[.!]/g, '\\$&'), { parse_mode: 'MarkdownV2' });
    
  } catch (error) {
    const errorText = `❌ Status check error: ${error}`.replace(/[.!]/g, '\\$&');
    await bot.sendMessage(chatId, errorText, { parse_mode: 'MarkdownV2' });
  }
}