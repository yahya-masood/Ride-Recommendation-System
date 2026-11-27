// RideRequest.js - class RideRequest of the SRS Class Diagram (Figure 7), package "Ride Request".
// A passenger's request for a ride (SRS FR-03, UC-03, UC-09, UC-10).
//
// UML attributes: requestId : String, pickup : String, dropOff : String, pickupTime : DateTime,
//                 passengerCount : int, status : String
// UML operations: validate() : boolean, cancel(), lock(), markExpired()
// Association: Passenger 1 "submits" 0..* RideRequest, so the request stores passengerId.
// status values (SRS FR-03 and the RideRequest state diagram): "Pending" | "Confirmed" | "Cancelled" | "Expired".
// lock() = the transition Pending -> Confirmed (SRS FR-07: after the driver confirms, the request is locked so that
// it cannot be recommended to or confirmed by any other driver). A request that is Confirmed IS the locked one.
// Helpers that are NOT in the UML: toRecord(), fromRecord(), errors.

import { toMs, isValidDate, INPUT_GRACE_MS } from "../dateUtils.js";

function isKnown(locations, id) {
  return Array.isArray(locations) && locations.some(location => location.id === id);
}

export class RideRequest {
  constructor({ requestId = null, passengerId = null, pickup = "", dropOff = "", pickupTime = "", passengerCount = 1, status = "Pending" } = {}) {
    this.requestId = requestId;
    this.passengerId = passengerId;
    this.pickup = pickup;
    this.dropOff = dropOff;
    this.pickupTime = pickupTime;
    this.passengerCount = passengerCount;
    this.status = status;
    this.errors = [];
  }

  // UC-03 step 5: mandatory fields, locations from the list, pickup differs from drop-off,
  // pickup time valid and not in the past, passenger count a whole number of at least 1. Fills this.errors.
  validate(locations, now = Date.now()) {
    const errors = [];
    if (!isKnown(locations, this.pickup)) errors.push("Choose a pickup location from the list");
    if (!isKnown(locations, this.dropOff)) errors.push("Choose a drop-off location from the list");
    if (isKnown(locations, this.pickup) && this.pickup === this.dropOff) {
      errors.push("Pickup and drop-off must be different");
    }
    if (!isValidDate(this.pickupTime)) errors.push("Enter a valid pickup date and time");
    else if (toMs(this.pickupTime) < now - INPUT_GRACE_MS) errors.push("The pickup time must not be in the past");
    if (!Number.isInteger(this.passengerCount) || this.passengerCount < 1) {
      errors.push("Number of passengers must be a whole number of at least 1");
    }
    this.errors = errors;
    return errors.length === 0;
  }

  // UC-10: a Pending or Confirmed request can be cancelled before pickup. Returns true if it is now "Cancelled".
  cancel(now = Date.now()) {
    if (this.status !== "Pending" && this.status !== "Confirmed") {
      this.errors = ["This request is already " + String(this.status).toLowerCase() + " and cannot be cancelled"];
      return false;
    }
    if (toMs(this.pickupTime) <= now) {
      this.errors = ["Pickup time has passed, so the request cannot be cancelled"];
      return false;
    }
    this.status = "Cancelled";
    this.errors = [];
    return true;
  }

  // FR-07: lock the request for the driver who confirmed it. Only a Pending request can be locked
  // (never twice: NFR-05 a request is assigned to only one driver). Returns true if it is now "Confirmed".
  lock() {
    if (this.status !== "Pending") return false;
    this.status = "Confirmed";
    return true;
  }

  // FR-03: a Pending request whose preferred pickup time has passed becomes "Expired". Returns true if it changed.
  markExpired(now = Date.now()) {
    if (this.status === "Pending" && toMs(this.pickupTime) <= now) {
      this.status = "Expired";
      return true;
    }
    return false;
  }

  toRecord() {
    return {
      requestId: this.requestId, passengerId: this.passengerId, pickup: this.pickup, dropOff: this.dropOff,
      pickupTime: this.pickupTime, passengerCount: this.passengerCount, status: this.status
    };
  }

  static fromRecord(record) {
    return new RideRequest(record);
  }
}
