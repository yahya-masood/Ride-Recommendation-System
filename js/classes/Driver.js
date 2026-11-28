// Driver.js - class Driver of the SRS Class Diagram (Figure 7).
// The driver who defines a route and time window and confirms or rejects recommendations (SRS FR-01, FR-02, FR-07, FR-10).
//
// UML attributes: driverId : String, name : String, fuelEfficiency : float, vehicleSeats : int
// UML operations: register(), login(), defineRoutePlan(), confirm(r : Recommendation), reject(r : Recommendation),
//                 viewRideHistory()
// Associations: Driver 1 "defines" 0..* RoutePlan, "receives" 0..* Notification, Recommendation "shown to" Driver,
//               Driver "carries out" 0..* Ride.
// driverId is the id of the account (users table, role "Driver"). fuelEfficiency is in km per litre (FR-01).
// Each operation calls the package that does the work: Authentication, Route Plan, Decision, Ride History.
// Helper that is NOT in the UML: fromUser().

import { createAccount, login } from "../auth.js";
import { createPlan } from "../routePlan.js";
import { confirmRecommendation, rejectRecommendation } from "../decision.js";
import { getRideHistory } from "../rideHistory.js";

export class Driver {
  constructor({ driverId = null, name = "", fuelEfficiency = null, vehicleSeats = null } = {}) {
    this.driverId = driverId;
    this.name = name;
    this.fuelEfficiency = fuelEfficiency;
    this.vehicleSeats = vehicleSeats;
  }

  // UC-01 / FR-01: creates the Driver account. Returns { ok: true, user } or { ok: false, errors }.
  async register(password) {
    const result = await createAccount({
      name: this.name, password, role: "Driver", fuelEfficiency: this.fuelEfficiency, vehicleSeats: this.vehicleSeats
    }, false);
    if (result.ok) this.driverId = result.user.userId;
    return result;
  }

  // UC-01 steps 5 and 6. Returns { ok: true, user } or { ok: false, reason, error }.
  async login(password) {
    const result = await login(this.name, password, Date.now(), "Driver");
    if (result.ok) this.driverId = result.user.userId;
    return result;
  }

  // UC-02 / FR-02. input: { source, destination, windowStart, windowEnd }. Returns { ok: true, plan } or { ok: false, errors }.
  defineRoutePlan(input, locations) {
    return createPlan(this.driverId, input, locations);
  }

  // UC-07 main flow. r: the Recommendation record shown to the driver. Returns { ok: true, ride, passengerName }
  // or { ok: false, reason } (see decision.js). Nothing is confirmed unless the driver calls this.
  confirm(r, locations) {
    return confirmRecommendation(r.recommendationId, this.driverId, locations);
  }

  // UC-07 alternative 2a. Returns { ok: true } or { ok: false, reason }.
  reject(r) {
    return rejectRecommendation(r.recommendationId, this.driverId);
  }

  // UC-14 / FR-10. Returns the driver's rides, newest first.
  viewRideHistory(locations) {
    return getRideHistory(this.driverId, locations);
  }

  static fromUser(user) {
    return new Driver({ driverId: user.userId, name: user.name, fuelEfficiency: user.fuelEfficiency ?? null, vehicleSeats: user.vehicleSeats ?? null });
  }
}
