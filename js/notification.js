// notification.js - Notification package (SRS FR-03, FR-07, UC-08). Creates and reads Notification objects
// (js/classes/Notification.js): ride confirmed (to the passenger) and ride cancelled (to the driver).
// Stored record: { notificationId, recipientId, message, createdAt }
// NFR-04: a message never contains contact details; it uses the first name only.

import { getList } from "./storage.js";
import { Notification } from "./classes/Notification.js";

// First name only (NFR-04 privacy).
export function firstName(fullName) {
  if (typeof fullName !== "string") return "";
  return fullName.trim().split(/\s+/)[0] || "";
}

// Saves one notification (Notification.send). Returns the new record, or null if it could not be saved.
export function createNotification(recipientId, message, now = Date.now()) {
  const note = new Notification({ recipientId, message });
  return note.send(now) ? note.toRecord() : null;
}

// UC-08: tell the passenger that a driver confirmed the request.
export function notifyPassengerConfirmed(passengerId, driverName, pickupName, dropOffName, now = Date.now()) {
  const message = "Your ride request from " + pickupName + " to " + dropOffName
    + " is confirmed. Driver: " + firstName(driverName) + ".";
  return createNotification(passengerId, message, now);
}

// UC-10: tell the driver that a confirmed ride was cancelled by the passenger.
export function notifyDriverCancelled(driverId, passengerName, pickupName, dropOffName, now = Date.now()) {
  const message = "The confirmed ride from " + pickupName + " to " + dropOffName
    + " was cancelled by " + firstName(passengerName) + ".";
  return createNotification(driverId, message, now);
}

// Notifications of one user, newest first.
export function getNotificationsFor(userId) {
  return getList("notifications")
    .filter(n => n.recipientId === userId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}
