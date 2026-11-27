// Notification.js - class Notification of the SRS Class Diagram (Figure 7), package "Notification".
// An in-system message for a driver or passenger (SRS FR-03, FR-07, UC-08).
//
// UML attributes: notificationId : String, message : String, createdAt : DateTime
// UML operations: send()
// Associations: Driver 1 "receives" 0..* Notification, Passenger "receives" Notification -> recipientId
// NFR-04: a message never contains contact details.
// Helpers that are NOT in the UML: toRecord(), fromRecord().

import { getList, saveList, newId } from "../storage.js";
import { toIso } from "../dateUtils.js";

export class Notification {
  constructor({ notificationId = null, recipientId = null, message = "", createdAt = "" } = {}) {
    this.notificationId = notificationId;
    this.recipientId = recipientId;
    this.message = message;
    this.createdAt = createdAt;
  }

  // Delivers the message within the system (saves it so the recipient sees it on the Notifications screen).
  // Returns true if saved. A notification that cannot be saved never undoes the ride (UC-08 exception).
  send(now = Date.now()) {
    if (typeof this.recipientId !== "string" || this.recipientId === ""
      || typeof this.message !== "string" || this.message.trim() === "") return false;
    if (!this.notificationId) this.notificationId = newId("NTF");
    if (!this.createdAt) this.createdAt = toIso(now);
    const list = getList("notifications");
    list.push(this.toRecord());
    return saveList("notifications", list);
  }

  toRecord() {
    return { notificationId: this.notificationId, recipientId: this.recipientId, message: this.message, createdAt: this.createdAt };
  }

  static fromRecord(record) {
    return new Notification(record);
  }
}
