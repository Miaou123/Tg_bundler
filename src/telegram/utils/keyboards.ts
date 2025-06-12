import { InlineKeyboardMarkup, SendMessageOptions, InlineKeyboardButton } from 'node-telegram-bot-api';

/**
 * Create the main menu inline keyboard
 * @returns Telegram inline keyboard markup
 */
export function createMainMenuKeyboard(): SendMessageOptions {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔑 Create Keypairs', callback_data: 'create_keypairs' },
          { text: '📋 Pre Launch', callback_data: 'pre_launch' }
        ],
        [
          { text: '🚀 Create Pool', callback_data: 'create_pool' },
          { text: '💰 Sell Tokens', callback_data: 'sell_tokens' }
        ],
        [
          { text: '💸 Buy Tokens', callback_data: 'buy_tokens' },
          { text: '🧹 Cleanup All', callback_data: 'cleanup_all' }
        ],
        [
          { text: '📊 Export Wallets', callback_data: 'export_wallets' },
          { text: '💰 Check Balances', callback_data: 'check_balances' }
        ],
        [
          { text: '🎯 Vanity Address', callback_data: 'vanity_address' },
          { text: '📊 Vanity Calc', callback_data: 'vanity_calc' }
        ],
        [
          { text: '❌ Exit', callback_data: 'exit' }
        ]
      ] as InlineKeyboardButton[][]
    }
  };
}

/**
 * Create the pre-launch menu inline keyboard
 * @returns Telegram inline keyboard markup
 */
export function createPreLaunchKeyboard(): SendMessageOptions {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🔗 Create LUT', callback_data: 'create_lut' },
          { text: '📦 Extend LUT', callback_data: 'extend_lut' }
        ],
        [
          { text: '🎲 Simulate Buys', callback_data: 'simulate_buys' },
          { text: '💸 Send SOL', callback_data: 'send_sol' }
        ],
        [
          { text: '💰 Reclaim SOL', callback_data: 'reclaim_sol' }
        ],
        [
          { text: '🔙 Main Menu', callback_data: 'main_menu' }
        ]
      ] as InlineKeyboardButton[][]
    }
  };
}

/**
 * Create keypair selection inline keyboard
 * @returns Telegram inline keyboard markup
 */
export function createKeypairKeyboard(): SendMessageOptions {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📝 Create New', callback_data: 'keypair_new' },
          { text: '📁 Use Existing', callback_data: 'keypair_existing' }
        ],
        [
          { text: '🔙 Main Menu', callback_data: 'main_menu' }
        ]
      ] as InlineKeyboardButton[][]
    }
  };
}

/**
 * Create wallet selection inline keyboard
 * @param walletCount Number of wallets available (optional, defaults to 10)
 * @returns Telegram inline keyboard markup
 */
export function createWalletSelectionKeyboard(walletCount: number = 10): SendMessageOptions {
  const buttons: InlineKeyboardButton[][] = [];
  
  // Add wallet selection buttons (2 per row)
  for (let i = 1; i <= walletCount; i += 2) {
    const row: InlineKeyboardButton[] = [
      { text: `Wallet ${i}`, callback_data: `wallet_${i}` }
    ];
    
    if (i + 1 <= walletCount) {
      row.push({ text: `Wallet ${i + 1}`, callback_data: `wallet_${i + 1}` });
    }
    
    buttons.push(row);
  }
  
  // Add utility buttons
  buttons.push([
    { text: '🎯 All Wallets', callback_data: 'wallet_all' },
    { text: '🎲 Random', callback_data: 'wallet_random' }
  ]);
  
  buttons.push([
    { text: '🔙 Main Menu', callback_data: 'main_menu' }
  ]);
  
  return {
    reply_markup: {
      inline_keyboard: buttons
    }
  };
}

/**
 * Create trading mode selection inline keyboard (for buy/sell operations)
 * @returns Telegram inline keyboard markup
 */
export function createTradingModeKeyboard(): SendMessageOptions {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '1️⃣ All Wallets', callback_data: 'trading_mode_1' }
        ],
        [
          { text: '2️⃣ Bundle Wallets Only', callback_data: 'trading_mode_2' }
        ],
        [
          { text: '3️⃣ Creator Wallet Only', callback_data: 'trading_mode_3' }
        ],
        [
          { text: '🔙 Main Menu', callback_data: 'main_menu' }
        ]
      ] as InlineKeyboardButton[][]
    }
  };
}

/**
 * Create percentage selection inline keyboard
 * @returns Telegram inline keyboard markup
 */
export function createPercentageKeyboard(): SendMessageOptions {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '10%', callback_data: 'percent_10' },
          { text: '25%', callback_data: 'percent_25' },
          { text: '50%', callback_data: 'percent_50' }
        ],
        [
          { text: '75%', callback_data: 'percent_75' },
          { text: '100%', callback_data: 'percent_100' }
        ],
        [
          { text: '🔢 Custom %', callback_data: 'percent_custom' }
        ],
        [
          { text: '🔙 Main Menu', callback_data: 'main_menu' }
        ]
      ] as InlineKeyboardButton[][]
    }
  };
}

/**
 * Create slippage selection inline keyboard
 * @returns Telegram inline keyboard markup
 */
export function createSlippageKeyboard(): SendMessageOptions {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '1%', callback_data: 'slippage_1' },
          { text: '2%', callback_data: 'slippage_2' },
          { text: '5%', callback_data: 'slippage_5' }
        ],
        [
          { text: '10%', callback_data: 'slippage_10' },
          { text: '15%', callback_data: 'slippage_15' },
          { text: '20%', callback_data: 'slippage_20' }
        ],
        [
          { text: '🔢 Custom %', callback_data: 'slippage_custom' }
        ],
        [
          { text: '🔙 Main Menu', callback_data: 'main_menu' }
        ]
      ] as InlineKeyboardButton[][]
    }
  };
}

/**
 * Create yes/no confirmation inline keyboard
 * @param yesCallback Callback data for yes button
 * @param noCallback Callback data for no button
 * @returns Telegram inline keyboard markup
 */
export function createYesNoKeyboard(yesCallback: string, noCallback: string): SendMessageOptions {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Yes', callback_data: yesCallback },
          { text: '❌ No', callback_data: noCallback }
        ]
      ] as InlineKeyboardButton[][]
    }
  };
}

/**
 * Create numeric input inline keyboard (0-9)
 * @param prefix Prefix for callback data
 * @returns Telegram inline keyboard markup
 */
export function createNumericKeyboard(prefix: string): SendMessageOptions {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '1', callback_data: `${prefix}_1` },
          { text: '2', callback_data: `${prefix}_2` },
          { text: '3', callback_data: `${prefix}_3` }
        ],
        [
          { text: '4', callback_data: `${prefix}_4` },
          { text: '5', callback_data: `${prefix}_5` },
          { text: '6', callback_data: `${prefix}_6` }
        ],
        [
          { text: '7', callback_data: `${prefix}_7` },
          { text: '8', callback_data: `${prefix}_8` },
          { text: '9', callback_data: `${prefix}_9` }
        ],
        [
          { text: '0', callback_data: `${prefix}_0` },
          { text: '🔙 Back', callback_data: 'main_menu' }
        ]
      ] as InlineKeyboardButton[][]
    }
  };
}

/**
 * Create vanity pattern type selection inline keyboard
 * @returns Telegram inline keyboard markup
 */
export function createVanityPatternTypeKeyboard(): SendMessageOptions {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🎯 Starts with', callback_data: 'vanity_starts' },
          { text: '🎭 Ends with', callback_data: 'vanity_ends' }
        ],
        [
          { text: '🔍 Contains', callback_data: 'vanity_contains' }
        ],
        [
          { text: '🔙 Main Menu', callback_data: 'main_menu' }
        ]
      ] as InlineKeyboardButton[][]
    }
  };
}

/**
 * Create a custom inline keyboard with specific options
 * @param options Array of button rows with text and callback_data
 * @param addBackButton Whether to add a back button
 * @returns Telegram inline keyboard markup
 */
export function createCustomInlineKeyboard(
  options: Array<Array<{text: string, callback_data: string}>>,
  addBackButton = true
): SendMessageOptions {
  const keyboard = [...options];
  
  if (addBackButton) {
    keyboard.push([{ text: '🔙 Back', callback_data: 'main_menu' }]);
  }
  
  return {
    reply_markup: {
      inline_keyboard: keyboard as InlineKeyboardButton[][]
    }
  };
}

export default {
  createMainMenuKeyboard,
  createPreLaunchKeyboard,
  createKeypairKeyboard,
  createWalletSelectionKeyboard,
  createTradingModeKeyboard,
  createPercentageKeyboard,
  createSlippageKeyboard,
  createYesNoKeyboard,
  createNumericKeyboard,
  createVanityPatternTypeKeyboard,
  createCustomInlineKeyboard
};