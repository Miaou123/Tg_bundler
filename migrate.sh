#!/bin/bash

# Pump.Fun Bundler Telegram Bot Migration Script
# This script helps migrate from the old structure to the new structure

echo "🚀 Starting Pump.Fun Bundler Telegram Bot migration..."

# Backup original files
echo "📦 Creating backup..."
BACKUP_DIR="backup_$(date +"%Y%m%d%H%M%S")"
mkdir -p $BACKUP_DIR
cp -r src console-main.ts launcher.ts telegram-main.ts telegram-bot.ts config.ts $BACKUP_DIR/
echo "✅ Backup created in $BACKUP_DIR"

# Create necessary directories if they don't exist
echo "📂 Creating new directory structure..."
mkdir -p src/{core,telegram/{handlers,utils},shared,clients,keypairs}

# Move client files
echo "🔄 Moving client files..."
cp -n src/clients/* src/clients/ 2>/dev/null || :

# Ensure proper .env file exists
if [ ! -f .env ]; then
  echo "⚠️ No .env file found. Creating from .env.example..."
  cp .env.example .env
  echo "⚠️ Please update .env with your configuration"
fi

# Create keyInfo.json if it doesn't exist
if [ ! -f keyInfo.json ]; then
  echo "⚠️ Creating empty keyInfo.json..."
  echo "{}" > keyInfo.json
fi

echo "
🎉 Migration preparation complete!

Next steps:
1. Update .env file with your configuration
2. Run npm install to ensure all dependencies are up to date
3. Start the bot with: npm run start

For more information, see the README.md file.
"