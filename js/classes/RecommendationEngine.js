// RecommendationEngine.js - class RecommendationEngine of the SRS Class Diagram (Figure 7), package "Recommendation Engine".
// Filters, evaluates and ranks pending requests and creates the recommendation (SRS FR-04, FR-05, FR-06, UC-04, UC-05, UC-06).
//
// UML attributes: none
// UML operations: filterRequests(plan), calculateDetour(req), estimateFuelCost(req), estimateProfit(req),
//                 rankRequests(), createRecommendation()
// Associations: "uses" RoutePlan, "uses" Settings, "calls" RideRequest, "creates" 0..* Recommendation.
//
// The SRS gives the weights (25/25/20/30) but not the scoring formulas. The formulas used here are the team's
// assumptions, written in docs/architecture-and-data-schema.md (sections 7 and 8). With S = driver source,
// D = destination, P = request pickup, Q = request drop-off and d(X,Y) from the distance table:
//   via(X)   = d(S,X) + d(X,D) - d(S,D)                    (never below 0)
//   along or near the route: via(P) <= max detour, via(Q) <= max detour, d(S,P) <= d(S,Q)
//   detour   = d(S,P) + d(P,Q) + d(Q,D) - d(S,D)           (never below 0); above the maximum detour = excluded (FR-05)
//   fuel cost = detour / km per litre x fuel price;  fare = d(P,Q) x fare per km;  profit = fare - fuel cost
//   criteria 0..100: route 100(1-(via(P)+via(Q))/(2 max)), detour 100(1-detour/max),
//                    fuel efficiency 100(1-fuel cost/fare), profitability 100 x profit / best profit in the list
//   score = sum(weight x criterion) / 100; equal scores: earlier pickup time first.
// The class is pure: it reads no storage. The caller (js/recommendationEngine.js) gives it the data.
// Helpers that are NOT in the UML: excluded, skipped, plan (the plan given to filterRequests).

import { Settings } from "./Settings.js";
import { Recommendation, STATUS } from "./Recommendation.js";
import { toMs, toIso } from "../dateUtils.js";

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function round(value, digits) {
  const factor = Math.pow(10, digits);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

// d(from, to) from the distance table, or null if the pair is missing.
function distance(table, from, to) {
  if (from === to) return 0;
  const row = table && table[from];
  const value = row ? row[to] : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class RecommendationEngine {
  // settings: a Settings object (or plain values), driver: object with fuelEfficiency (km per litre),
  // distances: the distance table of data/distances.json
  constructor({ settings, driver, distances }) {
    this.settings = settings instanceof Settings ? settings : new Settings(settings || {});
    this.fuelEfficiency = driver ? driver.fuelEfficiency : undefined;
    this.distances = distances;
    this.plan = null;
    this.excluded = [];     // [{ requestId, reason }] requests removed by the filters
    this.skipped = [];      // [{ requestId, reason }] requests that could not be calculated (data missing)
    this.errors = [];       // data problems (UC-05 exception: calculation or data error)
  }

  // Are settings, driver fuel efficiency and the route distance usable? Fills this.errors.
  checkData(plan) {
    this.errors = [];
    if (!this.settings.validate()) this.errors.push("Settings are invalid: " + this.settings.errors.join("; "));
    if (typeof this.fuelEfficiency !== "number" || !(this.fuelEfficiency > 0)) {
      this.errors.push("Driver fuel efficiency (km per litre) must be greater than 0");
    }
    const routeKm = plan ? distance(this.distances, plan.source, plan.destination) : null;
    if (!routeKm || routeKm <= 0) this.errors.push("Distance of the driver's route is not available");
    return this.errors.length === 0;
  }

  // UC-04: keeps only the Pending requests whose pickup time is inside the plan's window and whose pickup and
  // drop-off lie along or near the route. plan: a RoutePlan. requests: RideRequest objects or plain records.
  // Requests removed here are listed in this.excluded; requests with missing distance data in this.skipped.
  filterRequests(plan, requests = []) {
    this.plan = plan;
    this.excluded = [];
    this.skipped = [];
    const kept = [];
    const S = plan.source;
    const D = plan.destination;
    const dSD = distance(this.distances, S, D);
    const windowStart = toMs(plan.windowStart);
    const windowEnd = toMs(plan.windowEnd);
    for (const request of requests) {
      if (request.status !== "Pending") continue;
      const P = request.pickup;
      const Q = request.dropOff;
      const km = [distance(this.distances, S, P), distance(this.distances, P, D), distance(this.distances, S, Q),
        distance(this.distances, Q, D), distance(this.distances, P, Q)];
      if (km.some(value => value === null)) {
        this.skipped.push({ requestId: request.requestId, reason: "distance data missing" });
        continue;
      }
      const pickupMs = toMs(request.pickupTime);
      if (!(pickupMs >= windowStart && pickupMs <= windowEnd)) {
        this.excluded.push({ requestId: request.requestId, reason: "pickup time outside the window" });
        continue;
      }
      const [dSP, dPD, dSQ, dQD] = km;
      const viaP = Math.max(0, dSP + dPD - dSD);
      const viaQ = Math.max(0, dSQ + dQD - dSD);
      if (viaP > this.settings.maxDetourKm || viaQ > this.settings.maxDetourKm || dSP > dSQ) {
        this.excluded.push({ requestId: request.requestId, reason: "not along or near the route" });
        continue;
      }
      kept.push(request);
    }
    return kept;
  }

  // FR-05: the extra distance (km) needed to serve the request: S -> P -> Q -> D compared with S -> D.
  calculateDetour(req) {
    const S = this.plan.source;
    const D = this.plan.destination;
    const km = distance(this.distances, S, req.pickup) + distance(this.distances, req.pickup, req.dropOff)
      + distance(this.distances, req.dropOff, D) - distance(this.distances, S, D);
    return Math.max(0, km);
  }

  // FR-05: fuel cost of the detour = detour km / km per litre x fuel price.
  estimateFuelCost(req) {
    return this.calculateDetour(req) / this.fuelEfficiency * this.settings.fuelPrice;
  }

  // FR-05: profit = estimated fare (trip distance x fare per km) minus the estimated fuel cost. A loss stays negative.
  estimateProfit(req) {
    const fare = distance(this.distances, req.pickup, req.dropOff) * this.settings.farePerKm;
    return fare - this.estimateFuelCost(req);
  }

  // FR-05: removes requests above the maximum detour, scores the rest (0..100 per criterion), applies the weights
  // and sorts from best to worst. Returns candidates:
  //   { request, detourKm, fuelCost, profit, routeScore, score, scores: { route, detour, fuel, profit } }
  // (scores keeps all four criteria for the tests; only the values of the Recommendation class are stored).
  rankRequests(requests = []) {
    const S = this.plan.source;
    const D = this.plan.destination;
    const dSD = distance(this.distances, S, D);
    const max = this.settings.maxDetourKm;
    const candidates = [];
    for (const request of requests) {
      const detour = this.calculateDetour(request);
      if (detour > max) {
        this.excluded.push({ requestId: request.requestId, reason: "detour above the maximum" });
        continue;
      }
      const viaP = Math.max(0, distance(this.distances, S, request.pickup) + distance(this.distances, request.pickup, D) - dSD);
      const viaQ = Math.max(0, distance(this.distances, S, request.dropOff) + distance(this.distances, request.dropOff, D) - dSD);
      const fuelCost = this.estimateFuelCost(request);
      const profit = this.estimateProfit(request);
      candidates.push({ request, detour, fuelCost, profit, fare: profit + fuelCost, viaP, viaQ });
    }
    const bestProfit = candidates.reduce((best, c) => Math.max(best, c.profit), 0);
    const [wRoute, wDetour, wFuel, wProfit] = this.settings.weights;
    const ranked = candidates.map(c => {
      const route = clamp(100 * (1 - (c.viaP + c.viaQ) / (2 * max)), 0, 100);
      const detourScore = clamp(100 * (1 - c.detour / max), 0, 100);
      const fuel = c.fare > 0 ? clamp(100 * (1 - c.fuelCost / c.fare), 0, 100) : 0;
      const profitScore = bestProfit > 0 ? clamp(100 * c.profit / bestProfit, 0, 100) : 0;
      const totalRaw = (wRoute * route + wDetour * detourScore + wFuel * fuel + wProfit * profitScore) / 100;
      return {
        request: c.request,
        detourKm: round(c.detour, 2),
        fuelCost: round(c.fuelCost, 2),
        profit: round(c.profit, 2),
        routeScore: round(route, 1),
        score: round(totalRaw, 1),
        scores: { route: round(route, 1), detour: round(detourScore, 1), fuel: round(fuel, 1), profit: round(profitScore, 1) },
        totalRaw
      };
    });
    // equal totals: earlier pickup time first; then requestId (stable order)
    ranked.sort((a, b) => (b.totalRaw - a.totalRaw)
      || (toMs(a.request.pickupTime) - toMs(b.request.pickupTime))
      || (a.request.requestId < b.request.requestId ? -1 : 1));
    return ranked;
  }

  // UC-06 step 6: builds the Recommendation of one ranked candidate (not saved here; decision.js saves it).
  createRecommendation(candidate, driverId, recommendationId, now) {
    return new Recommendation({
      recommendationId,
      planId: this.plan.planId,
      requestId: candidate.request.requestId,
      driverId,
      routeScore: candidate.routeScore,
      detourKm: candidate.detourKm,
      fuelCost: candidate.fuelCost,
      profit: candidate.profit,
      score: candidate.score,
      status: STATUS.AWAITING,
      shownAt: toIso(now)
    });
  }
}
