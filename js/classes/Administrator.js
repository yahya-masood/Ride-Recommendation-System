// Administrator.js - class Administrator of the SRS Class Diagram (Figure 7).
// The administrator who manages accounts, configures the recommendation settings and reviews the audit log
// (SRS FR-08, FR-09).
//
// UML attributes: adminId : String, name : String
// UML operations: login(), manageUsers(), configureSettings(), viewAuditLog()
// Associations: Administrator 1..* "configures" 1 Settings, Administrator "reviews" AuditLog.
// adminId is the id of the account (users table, role "Administrator"). An administrator cannot register (SRS FR-01);
// the demonstration administrator is created by auth.js ensureSeedAdmin().
// Helper that is NOT in the UML: fromUser().

import { login } from "../auth.js";
import { listUsers, createUser, updateUser, deactivateUser, saveRecommendationSettings } from "../admin.js";
import { getAuditEntries } from "../auditLog.js";

export class Administrator {
  constructor({ adminId = null, name = "" } = {}) {
    this.adminId = adminId;
    this.name = name;
  }

  // UC-01 steps 5 and 6. Returns { ok: true, user } or { ok: false, reason, error }.
  async login(password) {
    const result = await login(this.name, password, Date.now(), "Administrator");
    if (result.ok) this.adminId = result.user.userId;
    return result;
  }

  // UC-11 / FR-08: create, update and deactivate user accounts and assign roles.
  //   manageUsers("list")                          -> the accounts
  //   manageUsers("create", input)                 -> { ok, user } | { ok: false, errors }
  //   manageUsers("update", { userId, changes })   -> { ok, user } | { ok: false, errors }
  //   manageUsers("deactivate", { userId })        -> { ok, user } | { ok: false, errors }
  async manageUsers(action = "list", payload = {}) {
    if (action === "list") return listUsers(this.adminId);
    if (action === "create") return createUser(this.adminId, payload);
    if (action === "update") return updateUser(this.adminId, payload.userId, payload.changes);
    if (action === "deactivate") return deactivateUser(this.adminId, payload.userId);
    return { ok: false, errors: ["Unknown action"] };
  }

  // UC-12 / FR-08: validates and saves new settings (they apply to future recommendations only).
  // Returns { ok: true, settings, errors: [] } or { ok: false, reason, settings: null, errors }.
  configureSettings(newSettings) {
    return saveRecommendationSettings(this.adminId, newSettings);
  }

  // UC-13 / FR-09: the audit log, newest first, read-only.
  viewAuditLog() {
    return getAuditEntries();
  }

  static fromUser(user) {
    return new Administrator({ adminId: user.userId, name: user.name });
  }
}
