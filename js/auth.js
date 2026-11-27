// auth.js - Authentication component (SRS FR-01, UC-01, NFR-03).
// Register, login, role check and the 15-minute inactivity logout.
// User: { userId, name, role, passwordHash, active, fuelEfficiency (Driver), vehicleSeats (Driver) }
//
// HONEST LIMITS (browser demo, not real security): the password is hashed with SHA-256 (Web Crypto)
// plus a random salt, stored as "salt:hash". Anyone can read Local Storage in DevTools.
// The login name is the name given at registration (unique, not case sensitive).
// The seeded demo administrator is created by ensureSeedAdmin(): name "admin", password "Admin@123".
// SRS says administrators cannot register, so this account is the only way into the admin screens at first.

import { getList, saveList, newId, getSession, saveSession, clearSession } from "./storage.js";
import { MINUTE_MS, toMs } from "./dateUtils.js";

export const SESSION_TIMEOUT_MIN = 15;          // SRS NFR-03
export const MIN_PASSWORD_LENGTH = 6;           // ASSUMPTION: the SRS gives no password rule
export const SEED_ADMIN = { name: "admin", password: "Admin@123" };
const ROLES = ["Driver", "Passenger", "Administrator"];

function getSubtle() {
  const cryptoObject = globalThis.crypto;
  if (!cryptoObject || !cryptoObject.subtle) {
    throw new Error("Web Crypto is not available (use https or localhost)");
  }
  return cryptoObject.subtle;
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function randomSalt() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  return toHex(await getSubtle().digest("SHA-256", data));
}

// Returns "salt:hash". A salt can be given (used when checking a password).
export async function hashPassword(password, salt = randomSalt()) {
  return salt + ":" + await sha256Hex(salt + password);
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== "string" || !stored.includes(":")) return false;
  const salt = stored.split(":")[0];
  return (await hashPassword(password, salt)) === stored;
}

function sameName(a, b) {
  return typeof a === "string" && typeof b === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Checks the registration / create-account input. Returns a list of error messages.
export function validateAccountInput(input, existingUsers, allowAdministrator = false) {
  const errors = [];
  const data = input && typeof input === "object" ? input : {};
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (name === "") errors.push("Name is required");
  else if (existingUsers.some(u => sameName(u.name, name) && u.userId !== data.userId)) errors.push("This name is already used");
  const allowedRoles = allowAdministrator ? ROLES : ["Driver", "Passenger"];
  if (!allowedRoles.includes(data.role)) errors.push("Role must be " + allowedRoles.join(" or "));
  if (typeof data.password !== "string" || data.password.length < MIN_PASSWORD_LENGTH) {
    errors.push("Password must be at least " + MIN_PASSWORD_LENGTH + " characters");
  }
  if (data.role === "Driver") {
    const fuel = data.fuelEfficiency;
    if (typeof fuel !== "number" || !Number.isFinite(fuel) || fuel <= 0) {
      errors.push("Vehicle fuel efficiency (km per litre) must be a number greater than 0");
    }
    const seats = data.vehicleSeats;
    if (seats !== undefined && seats !== null && !(Number.isInteger(seats) && seats >= 1)) {
      errors.push("Vehicle seats must be a whole number of at least 1");
    }
  }
  return errors;
}

// Creates and saves a user. Used by register() and by admin.js (which may create any role).
// Returns { ok: true, user } or { ok: false, errors: [...] }. The returned user has no password data.
export async function createAccount(input, allowAdministrator = false) {
  const users = getList("users");
  const errors = validateAccountInput(input, users, allowAdministrator);
  if (errors.length > 0) return { ok: false, errors };
  const user = {
    userId: newId("USR"),
    name: input.name.trim(),
    role: input.role,
    passwordHash: await hashPassword(input.password),
    active: true
  };
  if (input.role === "Driver") {
    user.fuelEfficiency = input.fuelEfficiency;
    user.vehicleSeats = Number.isInteger(input.vehicleSeats) ? input.vehicleSeats : null;
  }
  users.push(user);
  if (!saveList("users", users)) return { ok: false, errors: ["The account could not be saved. Please try again."] };
  return { ok: true, user: publicUser(user) };
}

export function publicUser(user) {
  const copy = { ...user };
  delete copy.passwordHash;
  return copy;
}

// Self registration: only Drivers and Passengers (SRS FR-01).
export function register(input) {
  return createAccount(input, false);
}

// Makes sure the seeded demo administrator exists. Safe to call on every page load.
export async function ensureSeedAdmin() {
  const users = getList("users");
  if (users.some(u => u.role === "Administrator")) return false;
  const result = await createAccount({ name: SEED_ADMIN.name, password: SEED_ADMIN.password, role: "Administrator" }, true);
  return result.ok;
}

// UC-01 steps 5 and 6. Returns { ok: true, user } or { ok: false, reason, error }.
// reason: "invalid" (wrong name or password), "deactivated", "storage".
// expectedRole (optional): when given (Driver.login, Passenger.login, Administrator.login), an account of another
// role is refused with the same "not correct" message.
export async function login(name, password, now = Date.now(), expectedRole = null) {
  const users = getList("users");
  const user = users.find(u => sameName(u.name, name) && (expectedRole === null || u.role === expectedRole));
  const passwordOk = user ? await verifyPassword(typeof password === "string" ? password : "", user.passwordHash) : false;
  if (!user || !passwordOk) {
    return { ok: false, reason: "invalid", error: "Name or password is not correct" };
  }
  if (user.active === false) {
    return { ok: false, reason: "deactivated", error: "This account is deactivated" };
  }
  if (!saveSession({ userId: user.userId, role: user.role, lastActivityAt: now })) {
    return { ok: false, reason: "storage", error: "Could not start the session. Please try again." };
  }
  return { ok: true, user: publicUser(user) };
}

// The role of the account with this name (case does not matter), or null. Used by the login screen to pick the class
// (Driver, Passenger or Administrator) whose login() is called.
export function findRoleByName(name) {
  const user = getList("users").find(u => sameName(u.name, name));
  return user ? user.role : null;
}

export function logout() {
  return clearSession();
}

// The logged-in user (without password data), or null. Logs out and returns null after 15 idle minutes
// or if the account was deactivated or removed (UC-01 alternative flows 5a and 6a).
export function getCurrentUser(now = Date.now()) {
  const session = getSession();
  if (!session) return null;
  const last = toMs(session.lastActivityAt);
  if (!Number.isFinite(last) || now - last >= SESSION_TIMEOUT_MIN * MINUTE_MS) {
    clearSession();
    return null;
  }
  const user = getList("users").find(u => u.userId === session.userId);
  if (!user || user.active === false || user.role !== session.role) {
    clearSession();
    return null;
  }
  return publicUser(user);
}

// Marks the user as active now (called on clicks and key presses by ui.js).
export function touchSession(now = Date.now()) {
  const session = getSession();
  if (!session) return false;
  return saveSession({ ...session, lastActivityAt: now });
}

// Role check (SRS FR-01: each function only for the authorized roles).
// Returns the user if logged in with one of the allowed roles, otherwise null.
export function requireRole(allowedRoles, now = Date.now()) {
  const user = getCurrentUser(now);
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return user && roles.includes(user.role) ? user : null;
}

// Display name for a user id (used by other modules). Returns "" if unknown.
export function getUserName(userId) {
  const user = getList("users").find(u => u.userId === userId);
  return user ? user.name : "";
}

export function getUserById(userId) {
  const user = getList("users").find(u => u.userId === userId);
  return user ? publicUser(user) : null;
}
