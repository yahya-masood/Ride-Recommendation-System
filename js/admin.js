// admin.js - Administration component (SRS FR-08, UC-11, UC-12, FR-09).
// Create, update and deactivate user accounts, assign roles, and save recommendation settings.
// Every function takes the adminId and checks that this user really is an active Administrator
// (role check, SRS FR-01). Every change is written to the audit log.
// Settings rules are in settings.js; this file only adds the audit entry (settings.js does not write one).

import { getList, saveList } from "./storage.js";
import { createAccount, validateAccountInput, hashPassword, publicUser, MIN_PASSWORD_LENGTH } from "./auth.js";
import { updateSettings } from "./settings.js";
import { recordAudit } from "./auditLog.js";

function isAdmin(adminId) {
  return getList("users").some(u => u.userId === adminId && u.role === "Administrator" && u.active !== false);
}

const NOT_ALLOWED = { ok: false, errors: ["Only an administrator can do this"] };

// UC-11 step 2: all accounts (without password data).
export function listUsers(adminId) {
  if (!isAdmin(adminId)) return [];
  return getList("users").map(publicUser);
}

// UC-11: create an account with any role.
export async function createUser(adminId, input, now = Date.now()) {
  if (!isAdmin(adminId)) return NOT_ALLOWED;
  const result = await createAccount(input, true);
  if (result.ok) recordAudit(adminId, "User account created", result.user.userId, now);
  return result;
}

// ASSUMPTION (safety for the demo): the last active administrator cannot be deactivated or changed
// to another role, otherwise nobody could log in to the admin screens any more.
function wouldRemoveLastAdmin(users, target, changes) {
  const losesAdmin = target.role === "Administrator"
    && ((changes.active === false) || (changes.role !== undefined && changes.role !== "Administrator"));
  if (!losesAdmin) return false;
  const others = users.filter(u => u.userId !== target.userId && u.role === "Administrator" && u.active !== false);
  return others.length === 0;
}

// UC-11: update name, role, active flag, driver vehicle data, or set a new password.
// changes: { name, role, active, fuelEfficiency, vehicleSeats, password } (all optional)
export async function updateUser(adminId, userId, changes, now = Date.now()) {
  if (!isAdmin(adminId)) return NOT_ALLOWED;
  const users = getList("users");
  const target = users.find(u => u.userId === userId);
  if (!target) return { ok: false, errors: ["User not found"] };
  const data = changes && typeof changes === "object" ? changes : {};
  if (wouldRemoveLastAdmin(users, target, data)) {
    return { ok: false, errors: ["The last active administrator cannot be deactivated or changed"] };
  }
  const merged = { ...target, ...data, userId, password: data.password !== undefined ? data.password : "x".repeat(MIN_PASSWORD_LENGTH) };
  const errors = validateAccountInput(merged, users, true);
  if (errors.length > 0) return { ok: false, errors };
  target.name = merged.name.trim();
  target.role = merged.role;
  if (typeof data.active === "boolean") target.active = data.active;
  if (merged.role === "Driver") {
    target.fuelEfficiency = merged.fuelEfficiency;
    target.vehicleSeats = Number.isInteger(merged.vehicleSeats) ? merged.vehicleSeats : null;
  } else {
    delete target.fuelEfficiency;
    delete target.vehicleSeats;
  }
  if (data.password !== undefined) target.passwordHash = await hashPassword(data.password);
  if (!saveList("users", users)) return { ok: false, errors: ["The change could not be saved. Please try again."] };
  recordAudit(adminId, "User account updated", userId, now);
  return { ok: true, user: publicUser(target) };
}

export async function deactivateUser(adminId, userId, now = Date.now()) {
  const result = await updateUser(adminId, userId, { active: false }, now);
  if (result.ok) recordAudit(adminId, "User account deactivated", userId, now);
  return result;
}

// UC-12: save recommendation settings and write the audit entry.
// Returns the same object as settings.updateSettings().
export function saveRecommendationSettings(adminId, newSettings, now = Date.now()) {
  if (!isAdmin(adminId)) return { ok: false, reason: "not-allowed", settings: null, errors: NOT_ALLOWED.errors };
  const result = updateSettings(newSettings);
  if (result.ok) recordAudit(adminId, "Recommendation settings changed", "settings", now);
  return result;
}
