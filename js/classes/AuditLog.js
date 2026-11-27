// AuditLog.js - class AuditLog of the SRS Class Diagram (Figure 7), package "Audit Log".
// One entry of the audit log (SRS FR-09, UC-13, NFR-03).
//
// UML attributes: logId : String, timestamp : DateTime, userId : String, action : String, recordRef : String
// UML operations: record()
// Association: Administrator "reviews" AuditLog (read-only, see auditLog.js getAuditEntries()).
// The log is append-only: there is no operation to edit or delete an entry (NFR-03).
// Helpers that are NOT in the UML: toRecord(), fromRecord().

import { getList, saveList, newId } from "../storage.js";
import { toIso } from "../dateUtils.js";

export class AuditLog {
  constructor({ logId = null, timestamp = "", userId = "system", action = "", recordRef = "" } = {}) {
    this.logId = logId;
    this.timestamp = timestamp;
    this.userId = typeof userId === "string" && userId !== "" ? userId : "system";
    this.action = action;
    this.recordRef = typeof recordRef === "string" ? recordRef : "";
  }

  // Appends this entry to the log. Returns true if saved.
  record(now = Date.now()) {
    if (typeof this.action !== "string" || this.action.trim() === "") return false;
    if (!this.logId) this.logId = newId("LOG");
    if (!this.timestamp) this.timestamp = toIso(now);
    const list = getList("auditLogs");
    list.push(this.toRecord());
    return saveList("auditLogs", list);
  }

  toRecord() {
    return { logId: this.logId, timestamp: this.timestamp, userId: this.userId, action: this.action, recordRef: this.recordRef };
  }

  static fromRecord(record) {
    return new AuditLog(record);
  }
}
