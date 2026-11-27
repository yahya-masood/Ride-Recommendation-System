// auditLog.js - Audit Log package (SRS FR-09, UC-13, NFR-03). Saves and reads AuditLog entries (js/classes/AuditLog.js).
// Records route plans, recommendations, driver decisions, request status changes and administrator changes.
// The log is append-only here: there is no function to edit or delete an entry.
// (Honest limit: data can still be changed in the browser DevTools.)
// Entry: { logId, timestamp, userId, action, recordRef }

import { getList } from "./storage.js";
import { AuditLog } from "./classes/AuditLog.js";

// Adds one entry (AuditLog.record). Returns true if saved, false if not (the caller decides what to do;
// a missing log entry must never undo the main action).
export function recordAudit(userId, action, recordRef, now = Date.now()) {
  return new AuditLog({ userId, action, recordRef }).record(now);
}

// All entries, newest first, as copies (read-only view for the Administrator).
export function getAuditEntries() {
  return getList("auditLogs")
    .map(entry => AuditLog.fromRecord(entry).toRecord())
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
}
