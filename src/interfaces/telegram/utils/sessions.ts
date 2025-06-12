import { UserSession } from '../../shared/types';

// Store active user sessions
const userSessions: Map<number, UserSession> = new Map();

/**
 * Get a user's session, creating a new one if it doesn't exist
 * @param userId Telegram user ID
 * @returns User session object
 */
export function getUserSession(userId: number): UserSession {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {});
  }
  return userSessions.get(userId)!;
}

/**
 * Clear a user's session
 * @param userId Telegram user ID
 */
export function clearUserSession(userId: number): void {
  userSessions.delete(userId);
}

/**
 * Update a specific field in the user's session
 * @param userId Telegram user ID
 * @param field Field to update
 * @param value New value
 */
export function updateUserSession(userId: number, field: keyof UserSession, value: any): void {
  const session = getUserSession(userId);
  session[field] = value;
}

/**
 * Set waiting state for user session
 * @param userId Telegram user ID
 * @param waitingFor What the session is waiting for
 * @param additionalData Any additional data to store
 */
export function setWaitingFor(userId: number, waitingFor: string, additionalData?: any): void {
  const session = getUserSession(userId);
  session.waitingFor = waitingFor;
  
  if (additionalData) {
    session.data = {
      ...(session.data || {}),
      ...additionalData
    };
  }
}

/**
 * Add data to the user session
 * @param userId Telegram user ID
 * @param key Data key
 * @param value Data value
 */
export function addSessionData(userId: number, key: string, value: any): void {
  const session = getUserSession(userId);
  
  if (!session.data) {
    session.data = {};
  }
  
  session.data[key] = value;
}

/**
 * Get data from user session
 * @param userId Telegram user ID
 * @param key Data key
 * @returns Data value or undefined if not found
 */
export function getSessionData(userId: number, key: string): any {
  const session = getUserSession(userId);
  
  if (!session.data) {
    return undefined;
  }
  
  return session.data[key];
}

/**
 * Check if a session is waiting for input
 * @param userId Telegram user ID
 * @returns Whether the session is waiting for input
 */
export function isWaitingForInput(userId: number): boolean {
  const session = getUserSession(userId);
  return !!session.waitingFor;
}

/**
 * Store input in the session
 * @param userId Telegram user ID
 * @param input User input
 */
export function storeInput(userId: number, input: string): void {
  const session = getUserSession(userId);
  
  if (!session.inputs) {
    session.inputs = [];
  }
  
  session.inputs.push(input);
}

/**
 * Get all stored inputs
 * @param userId Telegram user ID
 * @returns Array of inputs or empty array if none
 */
export function getAllInputs(userId: number): string[] {
  const session = getUserSession(userId);
  return session.inputs || [];
}

/**
 * Clear all inputs for a user
 * @param userId Telegram user ID
 */
export function clearInputs(userId: number): void {
  const session = getUserSession(userId);
  session.inputs = [];
}

export default {
  getUserSession,
  clearUserSession,
  updateUserSession,
  setWaitingFor,
  addSessionData,
  getSessionData,
  isWaitingForInput,
  storeInput,
  getAllInputs,
  clearInputs
};