// Passenger.js - class Passenger of the SRS Class Diagram (Figure 7).
// The passenger who submits, views and cancels ride requests (SRS FR-01, FR-03).
//
// UML attributes: passengerId : String, name : String
// UML operations: register(), login(), submitRequest(), viewStatus(), cancelRequest()
// Associations: Passenger 1 "submits" 0..* RideRequest, Passenger "receives" 0..* Notification.
// passengerId is the id of the account (users table, role "Passenger").
// Helper that is NOT in the UML: fromUser().

import { createAccount, login } from "../auth.js";
import { submitRequest, getRequestsFor, cancelRequest } from "../rideRequest.js";

export class Passenger {
  constructor({ passengerId = null, name = "" } = {}) {
    this.passengerId = passengerId;
    this.name = name;
  }

  // UC-01 / FR-01. Returns { ok: true, user } or { ok: false, errors }.
  async register(password) {
    const result = await createAccount({ name: this.name, password, role: "Passenger" }, false);
    if (result.ok) this.passengerId = result.user.userId;
    return result;
  }

  // UC-01 steps 5 and 6. Returns { ok: true, user } or { ok: false, reason, error }.
  async login(password) {
    const result = await login(this.name, password, Date.now(), "Passenger");
    if (result.ok) this.passengerId = result.user.userId;
    return result;
  }

  // UC-03. input: { pickup, dropOff, pickupTime, passengerCount }. Returns { ok: true, request } or { ok: false, errors }.
  submitRequest(input, locations) {
    return submitRequest(this.passengerId, input, locations);
  }

  // UC-09. Returns the passenger's own requests with their status, newest first.
  viewStatus() {
    return getRequestsFor(this.passengerId);
  }

  // UC-10. Returns { ok: true, request } or { ok: false, errors }.
  cancelRequest(requestId, locations) {
    return cancelRequest(requestId, this.passengerId, locations);
  }

  static fromUser(user) {
    return new Passenger({ passengerId: user.userId, name: user.name });
  }
}
