import { KeyboardButton, SendMessageOptions } from 'node-telegram-bot-api';
import { KEYBOARD_OPTIONS } from '../../shared/constants';

/**
 * Create main menu keyboard
 * @returns Telegram keyboard markup
 */
export function createMainMenuKeyboard(): SendMessageOptions {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🔑 Create Keypairs' }, { text: '📋 Pre Launch' }],
        [{ text: '🚀 Create Pool' }, { text: '💰 Sell Tokens' }],
        [{ text: '💸 Buy Tokens' }, { text: '🧹 Cleanup All' }],
        [{ text: '📊 Export Wallets' }, { text: '💰 Check Balances' }],
        [{ text: '🎯 Vanity Address' }, { text: '📊 Vanity Calc' }],
        [{ text: '❌ Exit' }]
      ] as KeyboardButton[][],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

/**
 * Create pre-launch menu keyboard
 * @returns Telegram keyboard markup
 */
export function createPreLaunchKeyboard(): SendMessageOptions {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🔗 Create LUT' }, { text: '📦 Extend LUT' }],
        [{ text: '🎲 Simulate Buys' }, { text: '💸 Send SOL' }],
        [{ text: '💰 Reclaim SOL' }, { text: '🔙 Main Menu' }]
      ] as KeyboardButton[][],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

/**
 * Create keypair menu keyboard
 * @returns Telegram keyboard markup
 */
export function createKeypairKeyboard(): SendMessageOptions {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '📝 Create New' }, { text: '📁 Use Existing' }],
        [{ text: '🔙 Main Menu' }]
      ] as KeyboardButton[][],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  };
}

/**
 * Create wallet selection keyboard
 * @returns Telegram keyboard markup
 */
export function createWalletSelectionKeyboard(): SendMessageOptions {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '1️⃣ All Wallets' }],
        [{ text: '2️⃣ Bundle Wallets Only' }],
        [{ text: '3️⃣ Creator Wallet Only' }],
        [{ text: '🔙 Main Menu' }]
      ] as KeyboardButton[][],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  };
}

/**
 * Create vanity pattern type keyboard
 * @returns Telegram keyboard markup
 */
export function createVanityPatternTypeKeyboard(): SendMessageOptions {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '1️⃣ Starts with (prefix)' }, { text: '2️⃣ Ends with (suffix)' }],
        [{ text: '3️⃣ Quick pump ending' }, { text: '🔙 Main Menu' }]
      ] as KeyboardButton[][],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  };
}

/**
 * Create yes/no keyboard
 * @returns Telegram keyboard markup
 */
export function createYesNoKeyboard(): SendMessageOptions {
  return {
    reply_markup: {
      keyboard: [
        [{ text: KEYBOARD_OPTIONS.YES }, { text: KEYBOARD_OPTIONS.NO }],
        [{ text: KEYBOARD_OPTIONS.BACK }]
      ] as KeyboardButton[][],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  };
}

/**
 * Create custom numeric keyboard
 * @param values Array of numeric values to display
 * @returns Telegram keyboard markup
 */
export function createNumericKeyboard(values: number[]): SendMessageOptions {
  const numericButtons: KeyboardButton[][] = [];
  
  // Group values into rows of 3
  for (let i = 0; i < values.length; i += 3) {
    const row: KeyboardButton[] = [];
    
    for (let j = 0; j < 3 && i + j < values.length; j++) {
      row.push({ text: values[i + j].toString() });
    }
    
    numericButtons.push(row);
  }
  
  // Add back button
  numericButtons.push([{ text: KEYBOARD_OPTIONS.BACK }]);
  
  return {
    reply_markup: {
      keyboard: numericButtons,
      resize_keyboard: true,
      one_time_keyboard: true
    }
  };
}

/**
 * Create a custom keyboard with specific options
 * @param options Array of options to display
 * @param addBackButton Whether to add a back button
 * @returns Telegram keyboard markup
 */
export function createCustomKeyboard(options: string[][], addBackButton = true): SendMessageOptions {
  const keyboard = options.map(row => row.map(text => ({ text }))); 
  
  if (addBackButton) {
    keyboard.push([{ text: KEYBOARD_OPTIONS.BACK }]);
  }
  
  return {
    reply_markup: {
      keyboard: keyboard as KeyboardButton[][],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  };
}

/**
 * Create a keyboard for percentage selection
 * @returns Telegram keyboard markup
 */
export function createPercentageKeyboard(): SendMessageOptions {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '10%' }, { text: '25%' }, { text: '50%' }],
        [{ text: '75%' }, { text: '100%' }, { text: 'Custom %' }],
        [{ text: '🔙 Main Menu' }]
      ] as KeyboardButton[][],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  };
}

/**
 * Create a keyboard for slippage selection
 * @returns Telegram keyboard markup
 */
export function createSlippageKeyboard(): SendMessageOptions {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '1%' }, { text: '2%' }, { text: '5%' }],
        [{ text: '10%' }, { text: '15%' }, { text: '20%' }],
        [{ text: 'Custom %' }, { text: '🔙 Main Menu' }]
      ] as KeyboardButton[][],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  };
}

export default {
  createMainMenuKeyboard,
  createPreLaunchKeyboard,
  createKeypairKeyboard,
  createWalletSelectionKeyboard,
  createVanityPatternTypeKeyboard,
  createYesNoKeyboard,
  createNumericKeyboard,
  createCustomKeyboard,
  createPercentageKeyboard,
  createSlippageKeyboard
};