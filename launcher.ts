// launcher.ts
import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let consoleProcess: ChildProcess | null = null;
let telegramProcess: ChildProcess | null = null;

function showMenu() {
    console.clear();
    console.log('🚀 PUMP.FUN BUNDLER LAUNCHER');
    console.log('============================');
    console.log('');
    console.log('Choose how you want to run the bundler:');
    console.log('');
    console.log('1. 🖥️  Console Only (Original)');
    console.log('2. 📱 Telegram Only (Bot)');
    console.log('3. 🔄 Both Console + Telegram');
    console.log('4. ⚙️  Setup & Configuration');
    console.log('5. 🆘 Help & Documentation');
    console.log('6. ❌ Exit');
    console.log('');
}

function askQuestion(question: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

async function runConsoleOnly() {
    console.log('🖥️  Starting Console Bundler...');
    console.log('=====================================');
    
    consoleProcess = spawn('npx', ['ts-node', 'main.ts'], {
        stdio: 'inherit',
        cwd: process.cwd()
    });
    
    consoleProcess.on('close', (code) => {
        console.log(`\n🖥️  Console process exited with code ${code}`);
        showMenu();
        main();
    });
}

async function runTelegramOnly() {
    console.log('📱 Starting Telegram Bot...');
    console.log('=============================');
    
    // Check if required env vars exist
    if (!process.env.TELEGRAM_BOT_TOKEN) {
        console.log('❌ TELEGRAM_BOT_TOKEN not found in .env file');
        console.log('💡 Run option 4 (Setup) to configure');
        await askQuestion('\nPress Enter to continue...');
        showMenu();
        main();
        return;
    }
    
    telegramProcess = spawn('npx', ['ts-node', 'telegram-main.ts'], {
        stdio: 'inherit',
        cwd: process.cwd()
    });
    
    telegramProcess.on('close', (code) => {
        console.log(`\n📱 Telegram process exited with code ${code}`);
        showMenu();
        main();
    });
}

async function runBoth() {
    console.log('🔄 Starting Both Console + Telegram...');
    console.log('======================================');
    
    if (!process.env.TELEGRAM_BOT_TOKEN) {
        console.log('❌ TELEGRAM_BOT_TOKEN not found in .env file');
        console.log('💡 Run option 4 (Setup) to configure');
        await askQuestion('\nPress Enter to continue...');
        showMenu();
        main();
        return;
    }
    
    console.log('📱 Starting Telegram Bot...');
    telegramProcess = spawn('npx', ['ts-node', 'telegram-main.ts'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.cwd()
    });
    
    telegramProcess.stdout?.on('data', (data) => {
        console.log(`[TELEGRAM] ${data.toString().trim()}`);
    });
    
    telegramProcess.stderr?.on('data', (data) => {
        console.log(`[TELEGRAM ERROR] ${data.toString().trim()}`);
    });
    
    // Wait a moment for Telegram to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('\n🖥️  Starting Console Bundler...');
    consoleProcess = spawn('npx', ['ts-node', 'main.ts'], {
        stdio: 'inherit',
        cwd: process.cwd()
    });
    
    consoleProcess.on('close', (code) => {
        console.log(`\n🖥️  Console process exited with code ${code}`);
        if (telegramProcess) {
            telegramProcess.kill();
        }
        showMenu();
        main();
    });
    
    telegramProcess.on('close', (code) => {
        console.log(`\n📱 Telegram process exited with code ${code}`);
        if (consoleProcess) {
            consoleProcess.kill();
        }
    });
}

async function setupConfiguration() {
    console.clear();
    console.log('⚙️  SETUP & CONFIGURATION');
    console.log('=========================');
    console.log('');
    
    console.log('📋 Required for Telegram Bot:');
    console.log('');
    console.log('1. 🤖 Bot Token from @BotFather');
    console.log('   • Open Telegram');
    console.log('   • Search for @BotFather');
    console.log('   • Send /newbot');
    console.log('   • Follow instructions');
    console.log('   • Copy the token');
    console.log('');
    
    console.log('2. 👤 Your Telegram User ID');
    console.log('   • Search for @userinfobot');
    console.log('   • Send /start');
    console.log('   • Copy your ID number');
    console.log('');
    
    console.log('3. 📝 Add to your .env file:');
    console.log('');
    console.log('   TELEGRAM_BOT_TOKEN=your_bot_token_here');
    console.log('   AUTHORIZED_TELEGRAM_USERS=your_user_id_here');
    console.log('');
    
    console.log('4. 📦 Install dependencies:');
    console.log('   npm install node-telegram-bot-api @types/node-telegram-bot-api');
    console.log('');
    
    const choice = await askQuestion('🔧 Do you want help setting this up now? (y/n): ');
    
    if (choice.toLowerCase() === 'y' || choice.toLowerCase() === 'yes') {
        await interactiveSetup();
    }
    
    await askQuestion('\nPress Enter to return to main menu...');
    showMenu();
    main();
}

async function interactiveSetup() {
    console.log('\n🔧 INTERACTIVE SETUP');
    console.log('====================');
    
    const botToken = await askQuestion('\n🤖 Enter your bot token (from @BotFather): ');
    const userId = await askQuestion('👤 Enter your Telegram user ID (from @userinfobot): ');
    
    if (botToken && userId) {
        const fs = require('fs');
        const envPath = path.join(process.cwd(), '.env');
        
        try {
            let envContent = '';
            if (fs.existsSync(envPath)) {
                envContent = fs.readFileSync(envPath, 'utf8');
            }
            
            // Add or update Telegram settings
            if (!envContent.includes('TELEGRAM_BOT_TOKEN')) {
                envContent += `\n# Telegram Bot Configuration\n`;
                envContent += `TELEGRAM_BOT_TOKEN=${botToken}\n`;
                envContent += `AUTHORIZED_TELEGRAM_USERS=${userId}\n`;
            } else {
                envContent = envContent.replace(
                    /TELEGRAM_BOT_TOKEN=.*/,
                    `TELEGRAM_BOT_TOKEN=${botToken}`
                );
                envContent = envContent.replace(
                    /AUTHORIZED_TELEGRAM_USERS=.*/,
                    `AUTHORIZED_TELEGRAM_USERS=${userId}`
                );
            }
            
            fs.writeFileSync(envPath, envContent);
            console.log('\n✅ Configuration saved to .env file!');
            
            // Install dependencies
            console.log('\n📦 Installing Telegram dependencies...');
            const installProcess = spawn('npm', ['install', 'node-telegram-bot-api', '@types/node-telegram-bot-api'], {
                stdio: 'inherit',
                cwd: process.cwd()
            });
            
            installProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('\n✅ Dependencies installed successfully!');
                    console.log('\n🎉 Setup complete! You can now use the Telegram bot.');
                } else {
                    console.log('\n❌ Failed to install dependencies. Please run manually:');
                    console.log('npm install node-telegram-bot-api @types/node-telegram-bot-api');
                }
            });
            
        } catch (error) {
            console.log(`\n❌ Error updating .env file: ${error}`);
        }
    } else {
        console.log('\n❌ Setup cancelled - missing required information');
    }
}

async function showHelp() {
    console.clear();
    console.log('🆘 HELP & DOCUMENTATION');
    console.log('=======================');
    console.log('');
    
    console.log('📖 USAGE GUIDE:');
    console.log('');
    console.log('🖥️  CONSOLE MODE:');
    console.log('   • Full functionality');
    console.log('   • All critical operations');
    console.log('   • Interactive prompts');
    console.log('   • Best for: Setup, trading, critical ops');
    console.log('');
    
    console.log('📱 TELEGRAM MODE:');
    console.log('   • Balance checking');
    console.log('   • Status monitoring');
    console.log('   • Vanity calculations');
    console.log('   • Best for: Monitoring, quick checks');
    console.log('');
    
    console.log('🔄 BOTH MODES:');
    console.log('   • Console for operations');
    console.log('   • Telegram for monitoring');
    console.log('   • Best for: Active trading/monitoring');
    console.log('');
    
    console.log('🔒 SECURITY NOTES:');
    console.log('   • Critical ops always use console');
    console.log('   • Telegram for read-only operations');
    console.log('   • Private keys never sent via Telegram');
    console.log('   • User authorization required');
    console.log('');
    
    console.log('📋 REQUIREMENTS:');
    console.log('   • Working console bundler');
    console.log('   • Telegram bot token');
    console.log('   • Your Telegram user ID');
    console.log('   • Node.js 16+');
    console.log('');
    
    await askQuestion('Press Enter to return to main menu...');
    showMenu();
    main();
}

async function main() {
    showMenu();
    
    const choice = await askQuestion('Enter your choice (1-6): ');
    
    switch (choice) {
        case '1':
            await runConsoleOnly();
            break;
        case '2':
            await runTelegramOnly();
            break;
        case '3':
            await runBoth();
            break;
        case '4':
            await setupConfiguration();
            break;
        case '5':
            await showHelp();
            break;
        case '6':
            console.log('\n👋 Goodbye!');
            process.exit(0);
            break;
        default:
            console.log('\n❌ Invalid choice. Please enter 1-6.');
            await askQuestion('Press Enter to continue...');
            main();
            break;
    }
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down...');
    if (consoleProcess) consoleProcess.kill();
    if (telegramProcess) telegramProcess.kill();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\n🛑 Shutting down...');
    if (consoleProcess) consoleProcess.kill();
    if (telegramProcess) telegramProcess.kill();
    process.exit(0);
});

// Start the launcher
console.log('🚀 Pump.Fun Bundler Launcher Starting...');
main();