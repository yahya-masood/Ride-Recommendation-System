// RoutePlan.js - class RoutePlan of the SRS Class Diagram (Figure 7), package "Route Plan".
// A Driver's route (source, destination) and preferred time window (SRS FR-02, UC-02).
//
// UML attributes (the "-" means private in the UML; here they are normal object properties):
//   planId : String, source : String, destination : String,
//   windowStart : DateTime, windowEnd : DateTime, status : String
// UML operations: validate() : boolean, isActive() : boolean, modify(), end()
// Association: Driver 1 "defines" 0..* RoutePlan, so the plan stores the owner's id in driverId.
// status values: "Active" | "Ended" | "Expired" (the SRS has no list for the plan status).
// Helpers that are NOT in the UML (needed to save and load the object): toRecord(), fromRecord(), expireIfDue(), errors.

import { toMs, isValidDate, toIso, INPUT_GRACE_MS } from "../dateUtils.js";

function isKnown(locations, id) {
  return Array.isArray(locations) && locations.some(location => location.id === id);
}

export class RoutePlan {
  constructor({ planId = null, driverId = null, source = "", destination = "", windowStart = "", windowEnd = "", status = "Active" } = {}) {
    this.planId = planId;
    this.driverId = driverId;
    this.source = source;
    this.destination = destination;
    this.windowStart = windowStart;
    this.windowEnd = windowEnd;
    this.status = status;
    this.errors = [];          // helper: the messages found by the last validate()
  }

  // UC-02 step 4: source and destination are in the location list and different, end is later than
  // start, start is not in the past, and the window does not overlap another Active window of the same driver.
  // existingPlans: the driver's stored plans (RoutePlan objects or plain records). Fills this.errors.
  validate(locations, existingPlans = [], now = Date.now()) {
    const errors = [];
    if (!isKnown(locations, this.source)) errors.push("Choose a source from the location list");
    if (!isKnown(locations, this.destination)) errors.push("Choose a destination from the location list");
    if (isKnown(locations, this.source) && this.source === this.destination) {
      errors.push("Source and destination must be different");
    }
    const startOk = isValidDate(this.windowStart);
    const endOk = isValidDate(this.windowEnd);
    if (!startOk) errors.push("Enter a valid start date and time");
    if (!endOk) errors.push("Enter a valid end date and time");
    if (startOk && endOk) {
      const start = toMs(this.windowStart);
      const end = toMs(this.windowEnd);
      if (end <= start) errors.push("The end time must be later than the start time");
      if (start < now - INPUT_GRACE_MS) errors.push("The start time must not be in the past");
      const overlaps = existingPlans.some(other =>
        other.planId !== this.planId && other.driverId === this.driverId && other.status === "Active"
        && start < toMs(other.windowEnd) && end > toMs(other.windowStart));
      if (overlaps) errors.push("This window overlaps another window of yours");
    }
    this.errors = errors;
    return errors.length === 0;
  }

  // True while the plan is Active and now is inside [windowStart, windowEnd).
  isActive(now = Date.now()) {
    return this.status === "Active" && toMs(this.windowStart) <= now && now < toMs(this.windowEnd);
  }

  // FR-02: change source, destination or window of an Active plan. changes: any of
  // { source, destination, windowStart, windowEnd }. The changed plan must pass validate();
  // if it does not, nothing is changed and false is returned (see this.errors).
  modify(changes, locations, existingPlans = [], now = Date.now()) {
    if (this.status !== "Active") {
      this.errors = ["Only an active plan can be modified"];
      return false;
    }
    const data = changes && typeof changes === "object" ? changes : {};
    const candidate = new RoutePlan({
      ...this.toRecord(),
      source: data.source ?? this.source,
      destination: data.destination ?? this.destination,
      windowStart: data.windowStart ?? this.windowStart,
      windowEnd: data.windowEnd ?? this.windowEnd
    });
    // a start time that is already in the past is fine when the start is not being changed
    const startUnchanged = toMs(candidate.windowStart) === toMs(this.windowStart);
    const checkTime = startUnchanged ? toMs(this.windowStart) : now;
    if (!candidate.validate(locations, existingPlans, checkTime)) {
      this.errors = candidate.errors;
      return false;
    }
    this.source = candidate.source;
    this.destination = candidate.destination;
    this.windowStart = toIso(toMs(candidate.windowStart));
    this.windowEnd = toIso(toMs(candidate.windowEnd));
    this.errors = [];
    return true;
  }

  // FR-02: end the window before it expires. Monitoring stops.
  end() {
    if (this.status !== "Active") {
      this.errors = ["This plan is not active"];
      return false;
    }
    this.status = "Ended";
    this.errors = [];
    return true;
  }

  // helper: an Active plan whose end time has passed becomes "Expired". Returns true if it changed.
  expireIfDue(now = Date.now()) {
    if (this.status === "Active" && toMs(this.windowEnd) <= now) {
      this.status = "Expired";
      return true;
    }
    return false;
  }

  toRecord() {
    return {
      planId: this.planId, driverId: this.driverId, source: this.source, destination: this.destination,
      windowStart: this.windowStart, windowEnd: this.windowEnd, status: this.status
    };
  }

  static fromRecord(record) {
    return new RoutePlan(record);
  }
}
