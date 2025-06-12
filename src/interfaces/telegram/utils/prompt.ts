import TelegramBot from 'node-telegram-bot-api';
import { TelegramPrompt } from '../../shared/types';

/**
 * TelegramPromptManager - Handles interactive prompts via Telegram
 * Replaces prompt-sync for use with Telegram bot
 */
export class TelegramPromptManager implements TelegramPrompt {
  private responses: string[] = [];
  private currentIndex = 0;
  private chatId: number;
  private bot: TelegramBot;
  private pendingPromises: Array<{ resolve: (value: string) => void; reject: (reason?: any) => void }> = [];
  private originalPrompt: any = null;
  
  /**
   * Constructor
   * @param bot Telegram bot instance
   * @param chatId Chat ID to send prompts to
   */
  constructor(bot: TelegramBot, chatId: number) {
    this.bot = bot;
    this.chatId = chatId;
  }
  
  /**
   * Add a pre-filled response
   * @param response Response text
   */
  addResponse(response: string): void {
    this.responses.push(response);
    
    // Resolve any pending promises
    if (this.pendingPromises.length > 0) {
      const { resolve } = this.pendingPromises.shift()!;
      resolve(response);
    }
  }
  
  /**
   * Synchronous prompt function (compatible with prompt-sync)
   * @param message Prompt message
   * @param _default Default value
   * @returns User response or default
   */
  prompt(message?: string, _default?: string): string {
    // Use pre-stored responses if available
    if (this.responses.length > this.currentIndex) {
      return this.responses[this.currentIndex++];
    }
    
    // Return default if no response available
    return _default || '';
  }
  
  /**
   * Asynchronous prompt function
   * @param message Prompt message
   * @returns Promise resolving to user response
   */
  async promptAsync(message: string): Promise<string> {
    await this.bot.sendMessage(this.chatId, `💬 ${message}`);
    
    // Use pre-stored response if available
    if (this.responses.length > this.currentIndex) {
      return this.responses[this.currentIndex++];
    }
    
    // Otherwise, wait for user input
    return new Promise((resolve, reject) => {
      this.pendingPromises.push({ resolve, reject });
    });
  }
  
  /**
   * Install this prompt manager as the global prompt
   * Replaces the standard prompt-sync with our Telegram version
   */
  install(): void {
    // Store original prompt
    const promptSync = require('prompt-sync');
    this.originalPrompt = promptSync();
    
    // Create our mockPrompt function
    const mockPrompt = (message?: string, _default?: string): string => {
      return this.prompt(message, _default);
    };
    
    // Replace global prompt
    (global as any).prompt = mockPrompt;
    (global as any).promptSync = () => mockPrompt;
    
    // Replace require cache
    const Module = require('module');
    const originalRequire = Module.prototype.require;
    
    Module.prototype.require = function(id: string) {
      if (id === 'prompt-sync') {
        return () => mockPrompt;
      }
      return originalRequire.apply(this, arguments);
    };
  }
  
  /**
   * Uninstall this prompt manager and restore original prompt
   */
  uninstall(): void {
    if (this.originalPrompt) {
      (global as any).prompt = this.originalPrompt;
      (global as any).promptSync = require('prompt-sync');
      
      // Restore require
      const Module = require('module');
      Module._cache = {};
    }
  }
}

/**
 * Creates a TelegramPromptManager for a specific chat
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param responses Optional pre-filled responses
 * @returns Configured TelegramPromptManager
 */
export function createTelegramPrompt(
  bot: TelegramBot, 
  chatId: number, 
  responses: string[] = []
): TelegramPromptManager {
  const manager = new TelegramPromptManager(bot, chatId);
  
  // Add pre-filled responses
  responses.forEach(response => manager.addResponse(response));
  
  return manager;
}

/**
 * Setup a temporary prompt replacement for a function execution
 * @param bot Telegram bot instance
 * @param chatId Chat ID
 * @param responses Pre-filled responses
 * @param callback Function to execute with the prompt
 * @returns Promise that resolves with the callback result
 */
export async function withTelegramPrompt<T>(
  bot: TelegramBot, 
  chatId: number, 
  responses: string[],
  callback: () => Promise<T>
): Promise<T> {
  const promptManager = createTelegramPrompt(bot, chatId, responses);
  promptManager.install();
  
  try {
    return await callback();
  } finally {
    promptManager.uninstall();
  }
}

export default {
  TelegramPromptManager,
  createTelegramPrompt,
  withTelegramPrompt
};