// src/telegram/utils/sessions.ts

interface UserSession {
  waitingFor?: string;
  currentMenu?: string;
  tempData?: any;
}

// In-memory session storage
const userSessions = new Map<number, UserSession>();

/**
 * Set what the user is waiting for input on
 * @param userId User ID
 * @param waitingFor What the user is waiting for
 */
export function setWaitingFor(userId: number, waitingFor: string): void {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {});
  }
  const session = userSessions.get(userId)!;
  session.waitingFor = waitingFor;
  userSessions.set(userId, session);
}

/**
 * Get what the user is waiting for
 * @param userId User ID
 * @returns What the user is waiting for, or null
 */
export function getWaitingFor(userId: number): string | null {
  const session = userSessions.get(userId);
  return session?.waitingFor || null;
}

/**
 * Clear what the user is waiting for
 * @param userId User ID
 */
export function clearWaitingFor(userId: number): void {
  const session = userSessions.get(userId);
  if (session) {
    delete session.waitingFor;
    userSessions.set(userId, session);
  }
}

/**
 * Set the current menu for the user
 * @param userId User ID
 * @param menu Current menu
 */
export function setCurrentMenu(userId: number, menu: string): void {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {});
  }
  const session = userSessions.get(userId)!;
  session.currentMenu = menu;
  userSessions.set(userId, session);
}

/**
 * Get the current menu for the user
 * @param userId User ID
 * @returns Current menu, or null
 */
export function getCurrentMenu(userId: number): string | null {
  const session = userSessions.get(userId);
  return session?.currentMenu || null;
}

/**
 * Store temporary data for the user
 * @param userId User ID
 * @param key Data key
 * @param value Data value
 */
export function setTempData(userId: number, key: string, value: any): void {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {});
  }
  const session = userSessions.get(userId)!;
  if (!session.tempData) {
    session.tempData = {};
  }
  session.tempData[key] = value;
  userSessions.set(userId, session);
}

/**
 * Get temporary data for the user
 * @param userId User ID
 * @param key Data key
 * @returns Temporary data, or null
 */
export function getTempData(userId: number, key: string): any | null {
  const session = userSessions.get(userId);
  return session?.tempData?.[key] || null;
}

/**
 * Clear all temporary data for the user
 * @param userId User ID
 */
export function clearTempData(userId: number): void {
  const session = userSessions.get(userId);
  if (session) {
    delete session.tempData;
    userSessions.set(userId, session);
  }
}

/**
 * Clear the entire user session
 * @param userId User ID
 */
export function clearUserSession(userId: number): void {
  userSessions.delete(userId);
}

/**
 * Get the entire user session
 * @param userId User ID
 * @returns User session, or empty object
 */
export function getUserSession(userId: number): UserSession {
  return userSessions.get(userId) || {};
}

/**
 * Check if user has an active session
 * @param userId User ID
 * @returns True if user has active session
 */
export function hasUserSession(userId: number): boolean {
  return userSessions.has(userId);
}