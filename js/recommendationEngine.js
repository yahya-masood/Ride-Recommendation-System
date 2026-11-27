// recommendationEngine.js - Recommendation Engine package (SRS FR-04, FR-05, FR-06, UC-04, UC-05, UC-06).
// Reads the data from storage and runs the RecommendationEngine class (js/classes/RecommendationEngine.js):
// filterRequests -> rankRequests -> createRecommendation. The formulas are documented in that class and in
// docs/architecture-and-data-schema.md (sections 7 and 8).
// evaluateRequests() is pure (no storage). findRecommendations() reads storage and calls it.

import { getList, newId } from "./storage.js";
import { getCurrentSettings } from "./settings.js";
import { getActivePlan } from "./routePlan.js";
import { getPendingRequests } from "./rideRequest.js";
import { getUserById } from "./auth.js";
import { recordAudit } from "./auditLog.js";
import { RecommendationEngine } from "./classes/RecommendationEngine.js";
import { RoutePlan } from "./classes/RoutePlan.js";
import { STATUS } from "./classes/Recommendation.js";

const MAX_ALTERNATIVES = 3;   // SRS FR-06: up to three next best requests

// Pure calculation. Returns:
//   { ok: true,  ranked: [candidate, ...], excluded: [{ requestId, reason }], skipped: [{ requestId, reason }] }
//   { ok: false, errors: [...] }   (settings, driver or distance data are not usable: UC-05 exception)
// candidate = { request, detourKm, fuelCost, profit, routeScore, score, scores }  (see RecommendationEngine.rankRequests)
export function evaluateRequests({ plan, driver, requests, settings, distances, excludeRequestIds = [] }) {
  const engine = new RecommendationEngine({ settings, driver, distances });
  if (!engine.checkData(plan)) return { ok: false, errors: engine.errors };
  const pool = requests.filter(r => !excludeRequestIds.includes(r.requestId));
  const routePlan = plan instanceof RoutePlan ? plan : RoutePlan.fromRecord(plan);
  const compatible = engine.filterRequests(routePlan, pool);
  const ranked = engine.rankRequests(compatible);
  return { ok: true, ranked, excluded: engine.excluded, skipped: engine.skipped };
}

// Reads storage and evaluates the pending requests for one driver (UC-06 steps 1 to 6).
// Returns one of:
//   { status: "inactive" }                            the driver has no active window (FR-04)
//   { status: "error", errors }                       calculation or data error (UC-05 exception)
//   { status: "no-match", excluded, skipped }         nothing suitable; monitoring continues (FR-06)
//   { status: "match", top, alternatives, ranked }    top = best candidate, alternatives = up to 3 next best
// Requests this driver already rejected or let expire for this plan are not offered again (ASSUMPTION A7).
export function findRecommendations(driverId, now, distances) {
  const plan = getActivePlan(driverId, now);
  if (!plan) return { status: "inactive" };
  const driver = getUserById(driverId);
  const rejected = getList("recommendations")
    .filter(r => r.driverId === driverId && r.planId === plan.planId && (r.status === STATUS.REJECTED || r.status === STATUS.EXPIRED))
    .map(r => r.requestId);
  const result = evaluateRequests({
    plan, driver, requests: getPendingRequests(now), settings: getCurrentSettings(), distances, excludeRequestIds: rejected
  });
  if (!result.ok) return { status: "error", errors: result.errors, planId: plan.planId };
  if (result.ranked.length === 0) {
    return { status: "no-match", excluded: result.excluded, skipped: result.skipped, planId: plan.planId };
  }
  return {
    status: "match",
    planId: plan.planId,
    top: result.ranked[0],
    alternatives: result.ranked.slice(1, 1 + MAX_ALTERNATIVES),
    ranked: result.ranked,
    skipped: result.skipped
  };
}

// RecommendationEngine.createRecommendation: builds the Recommendation record of the top candidate (decision.js saves it).
// Only the Class Diagram attributes plus the three association ids (planId, requestId, driverId) are stored.
// No contact data and no passenger name is stored here (NFR-04).
export function createRecommendation(planId, driverId, candidate, settings, now) {
  const engine = new RecommendationEngine({ settings, driver: null, distances: null });
  engine.plan = { planId };
  return engine.createRecommendation(candidate, driverId, newId("REC"), now).toRecord();
}

// UC-05 exception: write the calculation or data error to the audit log. Call it once per error, not on every poll.
export function logEngineError(driverId, planId, message, now = Date.now()) {
  return recordAudit(driverId, "Recommendation calculation error: " + message, planId || "", now);
}
