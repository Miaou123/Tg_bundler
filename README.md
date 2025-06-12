# Pump.Fun Bundler Telegram Bot

The ultimate Telegram bot solution for efficient token bundling on Pump.Fun with advanced profile creation and anti-bubble map features.

Discord community: https://discord.gg/solana-scripts

![Pump.Fun Bundler](https://img.shields.io/badge/PumpFun-Bundler-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Version](https://img.shields.io/badge/version-3.0-orange)

## 🔥 Pump.Fun Bundler - Telegram Edition

Welcome to the **Pump.Fun Bundler Telegram Bot** – the most accessible version of our popular bundling tool for Solana token launches. This Telegram-only implementation brings all the power of the Pump.Fun Bundler to your mobile device, allowing you to manage token launches and trading from anywhere.

## 💎 Features

- **Fully Mobile** – Control your token launches from your phone
- **Secure Design** – Critical operations use encrypted methods
- **Simple Interface** – Intuitive Telegram commands and menus
- **Anti-Sniper Protection** – Keep the bots and front-runners at bay
- **Jito Integration** – Optimized bundle execution
- **Multi-Wallet Management** – Handle all your wallets from one interface

## 🚀 Core Functionality

- **Wallet Management** - Create, fund, and manage keypairs
- **LUT Operations** - Create and extend Lookup Tables for efficient transactions
- **Buy Functions** - Bundle buys with customizable slippage and wallet selection
- **Sell Functions** - Smart selling with percentage-based exits
- **Vanity Addresses** - Generate custom addresses with your desired pattern
- **Cleanup Utilities** - Easily sell all tokens and recover SOL

## 💾 Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/pumpfun-bundler-tg.git

# Navigate to project directory
cd pumpfun-bundler-tg

# Install dependencies
npm install

# Configure environment variables
# Create a .env file with your settings (see ENV Setup section)

# Start the Telegram bot
npm run start
```

## ⚙️ ENV Setup

Your `.env` file is the control center for the bot. Here's what you need:

```
# Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
AUTHORIZED_TELEGRAM_USERS=your_user_id_1,your_user_id_2

# Wallet Configuration
WALLET_PRIVATE_KEY=your_wallet_private_key_in_base58
PAYER_PRIVATE_KEY=your_payer_private_key_in_base58

# RPC Configuration
RPC_URL=your_preferred_solana_rpc_url
WS_ENDPOINT=your_websocket_endpoint_optional

# Jito Configuration
BLOCKENGINE_URL=amsterdam.mainnet.block-engine.jito.wtf
JITO_TIP=0.01

# Compute Budget Settings
COMPUTE_LIMIT_PRICE=150000
COMPUTE_UNIT=200000
```

### Getting a Telegram Bot Token

1. Talk to [@BotFather](https://t.me/botfather) on Telegram
2. Use the `/newbot` command and follow instructions
3. Copy the token provided by BotFather to your `.env` file

### Finding Your Telegram User ID

1. Talk to [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your user ID
3. Add this ID to the `AUTHORIZED_TELEGRAM_USERS` variable in your `.env` file

## 📋 Bot Commands

The bot supports the following commands:

- `/start` - Start the bot and show the main menu
- `/help` - Display help information
- `/status` - Check bot status and configuration
- `/cancel` - Cancel the current operation

## 🔧 Project Structure

```
project/
├── src/                         # Source code
│   ├── main.ts                  # Application entry point
│   ├── core/                    # Core bundler logic
│   │   ├── keys.ts              # Wallet management
│   │   ├── lut.ts               # Lookup table operations 
│   │   ├── buy.ts               # Buy functions
│   │   ├── sell.ts              # Sell functions
│   │   ├── cleanup.ts           # Cleanup functions
│   │   ├── export.ts            # Export functions
│   │   ├── trading.ts           # Trading functions
│   │   └── vanity.ts            # Vanity generation
│   │   
│   ├── telegram/                # Telegram interface
│   │   ├── bot.ts               # Main bot setup
│   │   ├── handlers/            # Command handlers
│   │   │   ├── wallet.ts        # Wallet commands
│   │   │   ├── trading.ts       # Trading commands
│   │   │   ├── info.ts          # Info commands 
│   │   │   └── vanity.ts        # Vanity commands
│   │   │
│   │   ├── utils/
│   │   │   ├── sessions.ts      # Session management
│   │   │   ├── keyboards.ts     # Keyboard layouts
│   │   │   ├── messages.ts      # Message templates
│   │   │   └── prompt.ts        # Prompt utilities
│   │
│   ├── shared/                  # Shared utilities
│   │   ├── config.ts            # Configuration
│   │   ├── constants.ts         # Constants
│   │   ├── types.ts             # Type definitions
│   │   └── utils.ts             # Common utilities
│   │
│   └── clients/                 # External service clients
│       ├── jito.ts              # Jito client
│       ├── config.ts            # Client configuration
│       ├── poolKeysReassigned.ts # Pool key utilities
│       └── LookupTableProvider.ts # LUT provider
```

## 🔒 Security Best Practices

- **Never** share your .env file or private keys
- Use a dedicated hardware device for storing seed phrases
- Regularly check wallet balances to ensure no unauthorized access
- Disconnect from public WiFi when using the bot for critical operations
- Consider using a VPN for additional security

## 🤝 Community and Support

Join our thriving community of traders and launchers:

- **Discord**: [discord.gg/solana-scripts](https://discord.gg/solana-scripts)
- **Telegram**: @benorizz0

## 📜 License & Attribution

This project is provided under the MIT License. You're free to use, modify, and distribute it, but we appreciate attribution to the original creators.

---

*Remember: Always operate within legal boundaries and respect the rules of the platforms you interact with. This tool is provided for educational and legitimate trading purposes only.*