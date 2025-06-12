# Pump.Fun Bundler Telegram Bot Reorganization Plan

## Project Structure

```
project/
├── main.ts                      # Application entry point
├── src/
│   ├── core/                    # Core bundler logic
│   │   ├── keys.ts              # Wallet management (from createKeys.ts)
│   │   ├── lut.ts               # Lookup table operations (from createLUT.ts)  
│   │   ├── buy.ts               # Buy functions (from buyFunc.ts)
│   │   ├── sell.ts              # Sell functions (from sellFunc.ts)
│   │   ├── cleanup.ts           # Cleanup functions (from sellall.ts)
│   │   ├── export.ts            # Export functions (from exportWallets.ts)
│   │   └── vanity.ts            # Vanity generation (from vanity.ts)
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
│   │   │   └── prompt.ts        # Prompt utilities for CLI replacement
│   │
│   ├── shared/                  # Shared utilities
│   │   ├── config.ts            # Configuration
│   │   ├── constants.ts         # Constants
│   │   ├── types.ts             # Type definitions
│   │   └── utils.ts             # Common utilities
│   │
│   └── clients/                 # External service clients
│       ├── jito.ts              # Jito client
│       ├── solana.ts            # Solana connection
│       └── lookupTableProvider.ts # LUT provider
│
├── .env.example                 # Environment template
└── README.md                    # Documentation
```

## Implementation Plan

### 1. Create New Directory Structure

First, create the new directory structure:

```bash
mkdir -p src/{core,telegram/{handlers,utils},shared,clients}
```

### 2. Move Core Logic

Move and refactor the core logic files:

- `createKeys.ts` -> `src/core/keys.ts`
- `createLUT.ts` -> `src/core/lut.ts`
- `buyFunc.ts` -> `src/core/buy.ts`
- `sellFunc.ts` -> `src/core/sell.ts`
- `sellall.ts` -> `src/core/cleanup.ts`
- `exportWallets.ts` -> `src/core/export.ts`
- `vanity.ts` -> `src/core/vanity.ts`

### 3. Setup Telegram Bot Structure

Create the Telegram bot structure:
- `src/telegram/bot.ts` - Main bot setup
- `src/telegram/handlers/*.ts` - Command handlers
- `src/telegram/utils/*.ts` - Utility functions

### 4. Shared Components

Create shared components:
- `src/shared/config.ts` - Configuration
- `src/shared/types.ts` - Type definitions
- `src/shared/utils.ts` - Common utilities

### 5. Client Integrations

Move client integrations:
- `src/clients/jito.ts` - Jito client
- `src/clients/solana.ts` - Solana connection
- `src/clients/lookupTableProvider.ts` - LUT provider

### 6. Create Main Entry Point

Create a new main entry point that only initializes the Telegram bot.

### 7. Update package.json

Update scripts in package.json to only include Telegram related commands and remove console scripts.

## Migration Notes

1. When moving files, ensure that imports are updated to reflect the new directory structure.
2. Remove any console-specific code and interfaces.
3. Update relative imports to use proper paths based on the new structure.
4. Ensure the Telegram bot has proper error handling and feedback mechanisms.
5. Make sure environment variables are properly loaded and validated in the config file.