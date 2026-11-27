// Recommendation.js - class Recommendation of the SRS Class Diagram (Figure 7), package "Recommendation Engine"
// (created there) and "Decision" (answered there). One ranked request shown to one driver (SRS FR-06, FR-07, NFR-08).
//
// UML attributes: recommendationId : String, routeScore : float, detourKm : float, fuelCost : float,
//                 profit : float, score : float, status : String, shownAt : DateTime
// UML operations: confirm(), reject(), expire(), isExpired() : boolean
// Associations: Driver 1 "shown to" 0..* Recommendation  -> driverId
//               RecommendationEngine "creates" 0..* Recommendation, RoutePlan "generates" it -> planId
//               Recommendation 0..* "recommends" 1 RideRequest -> requestId
//               Recommendation 1 "is confirmed as" 0..1 Ride (the Ride stores recommendationId)
// status values (Recommendation state diagram): "Awaiting Decision" | "Confirmed" | "Rejected" | "Expired".
// NFR-04: no passenger data is stored here. NFR-08: routeScore, detourKm, fuelCost, profit and score are shown.
// Helpers that are NOT in the UML: toRecord(), fromRecord(), STATUS.

import { toMs, MINUTE_MS } from "../dateUtils.js";

export const STATUS = {
  AWAITING: "Awaiting Decision",
  CONFIRMED: "Confirmed",
  REJECTED: "Rejected",
  EXPIRED: "Expired"
};

export class Recommendation {
  constructor({ recommendationId = null, planId = null, requestId = null, driverId = null, routeScore = 0, detourKm = 0,
    fuelCost = 0, profit = 0, score = 0, status = STATUS.AWAITING, shownAt = "" } = {}) {
    this.recommendationId = recommendationId;
    this.planId = planId;
    this.requestId = requestId;
    this.driverId = driverId;
    this.routeScore = routeScore;
    this.detourKm = detourKm;
    this.fuelCost = fuelCost;
    this.profit = profit;
    this.score = score;
    this.status = status;
    this.shownAt = shownAt;
  }

  // FR-07: the response timeout (default 2 minutes, set by the Administrator) has passed since shownAt.
  // responseTimeoutMin comes from the Settings class.
  isExpired(now, responseTimeoutMin) {
    return now >= toMs(this.shownAt) + responseTimeoutMin * MINUTE_MS;
  }

  // The driver confirms. Only an "Awaiting Decision" recommendation that has not expired can be confirmed.
  // Returns true if the status is now "Confirmed". (The Ride is created by Ride.createFrom() in decision.js.)
  confirm(now, responseTimeoutMin) {
    if (this.status !== STATUS.AWAITING) return false;
    if (this.isExpired(now, responseTimeoutMin)) {
      this.expire();
      return false;
    }
    this.status = STATUS.CONFIRMED;
    return true;
  }

  // The driver rejects. Same rule as confirm(). The request itself stays Pending (RideRequest state diagram).
  reject(now, responseTimeoutMin) {
    if (this.status !== STATUS.AWAITING) return false;
    if (this.isExpired(now, responseTimeoutMin)) {
      this.expire();
      return false;
    }
    this.status = STATUS.REJECTED;
    return true;
  }

  // Timeout, or the request was cancelled or taken by another driver (state diagram). Returns true if it changed.
  expire() {
    if (this.status !== STATUS.AWAITING) return false;
    this.status = STATUS.EXPIRED;
    return true;
  }

  toRecord() {
    return {
      recommendationId: this.recommendationId, planId: this.planId, requestId: this.requestId, driverId: this.driverId,
      routeScore: this.routeScore, detourKm: this.detourKm, fuelCost: this.fuelCost, profit: this.profit,
      score: this.score, status: this.status, shownAt: this.shownAt
    };
  }

  static fromRecord(record) {
    return new Recommendation(record);
  }
}
