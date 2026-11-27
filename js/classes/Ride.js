// Ride.js - class Ride of the SRS Class Diagram (Figure 7), package "Decision" / "Ride History".
// A ride exists ONLY after the driver confirmed a recommendation (SRS FR-07, CRC card Ride).
//
// UML attributes: rideId : String, detourKm : float, fuelCost : float, profit : float,
//                 status : String, confirmedAt : DateTime
// UML operations: cancel()
// Associations: Driver 1 "carries out" 0..* Ride -> driverId
//               Recommendation 1 "is confirmed as" 0..1 Ride -> recommendationId
//               Ride 0..1 "fulfils" 1 RideRequest -> requestId
// status values: "Confirmed" | "Cancelled". ASSUMPTION: the SRS does not list ride statuses; the CRC card says the
// ride is "cancelled when the passenger cancels", so a confirmed ride becomes "Cancelled".
// Helpers that are NOT in the UML: createFrom(), toRecord(), fromRecord().

import { toIso } from "../dateUtils.js";

export class Ride {
  constructor({ rideId = null, recommendationId = null, driverId = null, requestId = null, detourKm = 0, fuelCost = 0,
    profit = 0, status = "Confirmed", confirmedAt = "" } = {}) {
    this.rideId = rideId;
    this.recommendationId = recommendationId;
    this.driverId = driverId;
    this.requestId = requestId;
    this.detourKm = detourKm;
    this.fuelCost = fuelCost;
    this.profit = profit;
    this.status = status;
    this.confirmedAt = confirmedAt;
  }

  // The passenger cancelled a confirmed ride. Returns true if the status is now "Cancelled".
  cancel() {
    if (this.status !== "Confirmed") return false;
    this.status = "Cancelled";
    return true;
  }

  // Builds the Ride of a confirmed Recommendation (its detour, fuel cost and profit are copied).
  static createFrom(recommendation, rideId, now) {
    return new Ride({
      rideId,
      recommendationId: recommendation.recommendationId,
      driverId: recommendation.driverId,
      requestId: recommendation.requestId,
      detourKm: recommendation.detourKm,
      fuelCost: recommendation.fuelCost,
      profit: recommendation.profit,
      status: "Confirmed",
      confirmedAt: toIso(now)
    });
  }

  toRecord() {
    return {
      rideId: this.rideId, recommendationId: this.recommendationId, driverId: this.driverId, requestId: this.requestId,
      detourKm: this.detourKm, fuelCost: this.fuelCost, profit: this.profit, status: this.status, confirmedAt: this.confirmedAt
    };
  }

  static fromRecord(record) {
    return new Ride(record);
  }
}
