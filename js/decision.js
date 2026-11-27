// decision.js - Decision package (SRS FR-07, UC-06 step 6, UC-07, NFR-05).
// Shows ONE recommendation to the driver, and handles Confirm, Reject and the response timeout using the classes
// Recommendation, RideRequest and Ride (js/classes/).
// NOTHING here confirms a ride by itself: only confirmRecommendation(), called after the driver pressed Confirm,
// creates the ride and locks the request (SRS FR-07).
// Recommendation.status: "Awaiting Decision" | "Confirmed" | "Rejected" | "Expired" (SRS state diagram).
//
// Pattern for every change of ride data (see storage.js saveRideData): read the revision, build new
// lists, save once with the revision, and on "conflict" read again and re-check (maximum 3 tries).
// Honest limit: this is a best-effort demo of NFR-05, not a database transaction.

import { getList, getRideDataRevision, saveRideData, newId } from "./storage.js";
import { findRecommendations, createRecommendation } from "./recommendationEngine.js";
import { getCurrentSettings } from "./settings.js";
import { recordAudit } from "./auditLog.js";
import { notifyPassengerConfirmed } from "./notification.js";
import { locationNames } from "./rideRequest.js";
import { getUserName } from "./auth.js";
import { Recommendation, STATUS } from "./classes/Recommendation.js";
import { RideRequest } from "./classes/RideRequest.js";
import { Ride } from "./classes/Ride.js";
import { toMs, toIso, MINUTE_MS } from "./dateUtils.js";

const MAX_TRIES = 3;

// SRS FR-08: changed settings apply to FUTURE recommendations only. So when a recommendation is saved, the stored
// record also gets "expiresAt" (shownAt + the timeout in force at that moment). This is a storage detail of
// decision.js only: it is NOT an attribute of the Recommendation class (Class Diagram), which stays exactly as drawn.
// A record without expiresAt (old data) falls back to shownAt + the current timeout.
function timeoutMinFor(record) {
  const stored = toMs(record.expiresAt);
  return Number.isFinite(stored) ? (stored - toMs(record.shownAt)) / MINUTE_MS : getCurrentSettings().responseTimeoutMin;
}

// Keeps every stored field (including expiresAt) and only writes the new status of the class object.
function withStatus(record, recommendation) {
  return { ...record, status: recommendation.status };
}

// When does this recommendation time out? shownAt + the timeout that was in force when it was shown.
export function getExpiryMs(recommendation) {
  return toMs(recommendation.shownAt) + timeoutMinFor(recommendation) * MINUTE_MS;
}

// Recommendation.isExpired
export function isRecommendationExpired(recommendation, now) {
  return Recommendation.fromRecord(recommendation).isExpired(now, timeoutMinFor(recommendation));
}

// Marks recommendations as Expired in one save (Recommendation.expire). ids: list of recommendationIds.
// Returns how many changed.
function markExpired(ids, auditText, now) {
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const rev = getRideDataRevision();
    const recs = getList("recommendations");
    const expiredIds = [];
    const updated = recs.map(record => {
      const rec = Recommendation.fromRecord(record);
      if (ids.includes(rec.recommendationId) && rec.expire()) expiredIds.push(rec);
      return withStatus(record, rec);
    });
    if (expiredIds.length === 0) return 0;
    const result = saveRideData({ recommendations: updated }, rev);
    if (result.ok) {
      expiredIds.forEach(r => recordAudit(r.driverId, auditText, r.recommendationId, now));
      return expiredIds.length;
    }
    if (result.reason !== "conflict") return 0;
  }
  return 0;
}

// FR-07: a recommendation not answered within the response timeout expires. The request stays Pending
// (it is back in the pool) and the ride is NOT confirmed. Returns how many were expired.
export function expireTimedOut(now = Date.now()) {
  const ids = getList("recommendations")
    .filter(r => r.status === STATUS.AWAITING && isRecommendationExpired(r, now))
    .map(r => r.recommendationId);
  return ids.length === 0 ? 0 : markExpired(ids, "Recommendation expired (no response, request back to Pending)", now);
}

export function getAwaitingRecommendation(driverId) {
  return getList("recommendations").find(r => r.driverId === driverId && r.status === STATUS.AWAITING) || null;
}

// UC-06: returns what the driver screen must show. Calls the engine, keeps the recommendation that is
// already on screen while its request is still suitable, otherwise creates one for the best request.
//   { status: "inactive" | "no-match" }
//   { status: "error", errors }
//   { status: "match", recommendation, request, alternatives }   alternatives: up to 3 candidates
//   { status: "save-failed" }
export function getOrCreateRecommendation(driverId, now, distances) {
  expireTimedOut(now);
  const result = findRecommendations(driverId, now, distances);
  const existing = getAwaitingRecommendation(driverId);
  if (result.status !== "match") {
    if (existing) markExpired([existing.recommendationId], "Recommendation expired (request no longer suitable)", now);
    return result;
  }
  if (existing) {
    const current = result.ranked.find(c => c.request.requestId === existing.requestId);
    if (current) {
      return {
        status: "match",
        recommendation: existing,
        request: current.request,
        alternatives: result.ranked.filter(c => c !== current).slice(0, 3)
      };
    }
    markExpired([existing.recommendationId], "Recommendation expired (request no longer suitable)", now);
  }
  const settings = getCurrentSettings();
  const record = {
    ...createRecommendation(result.planId, driverId, result.top, settings, now),
    expiresAt: toIso(now + settings.responseTimeoutMin * MINUTE_MS)
  };
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const rev = getRideDataRevision();
    const saved = saveRideData({ recommendations: [...getList("recommendations"), record] }, rev);
    if (saved.ok) {
      recordAudit(driverId, "Recommendation created", record.recommendationId, now);
      return { status: "match", recommendation: record, request: result.top.request, alternatives: result.alternatives };
    }
    if (saved.reason !== "conflict") break;
  }
  return { status: "save-failed" };
}

// UC-07 steps 2 to 6. Returns:
//   { ok: true, ride, passengerName }
//   { ok: false, reason: "not-found" | "expired" | "unavailable" | "save-failed" }
// "unavailable": request was cancelled or confirmed by another driver (UC-07 alternative 3a).
// "save-failed": nothing was saved, request stays Pending, driver may retry (UC-07 exception).
export function confirmRecommendation(recommendationId, driverId, locations, now = Date.now()) {
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const rev = getRideDataRevision();
    const recs = getList("recommendations");
    const requests = getList("rideRequests");
    const rides = getList("rides");
    const recIndex = recs.findIndex(r => r.recommendationId === recommendationId);
    if (recIndex < 0 || recs[recIndex].driverId !== driverId) return { ok: false, reason: "not-found" };
    const rec = Recommendation.fromRecord(recs[recIndex]);
    if (rec.status !== STATUS.AWAITING) return { ok: false, reason: "unavailable" };
    const timeoutMin = timeoutMinFor(recs[recIndex]);
    if (rec.isExpired(now, timeoutMin)) {
      markExpired([rec.recommendationId], "Recommendation expired (late confirm refused)", now);
      return { ok: false, reason: "expired" };
    }
    const requestIndex = requests.findIndex(r => r.requestId === rec.requestId);
    const request = requestIndex >= 0 ? RideRequest.fromRecord(requests[requestIndex]) : null;
    // UC-07 step 3: the request must still be pending and unassigned. RideRequest.lock() only works on Pending.
    if (!request || !request.lock()) {
      markExpired([rec.recommendationId], "Recommendation expired (request cancelled or taken)", now);
      return { ok: false, reason: "unavailable" };
    }
    rec.confirm(now, timeoutMin);
    const ride = Ride.createFrom(rec, newId("RID"), now);
    const result = saveRideData({
      rideRequests: requests.map((r, i) => (i === requestIndex ? request.toRecord() : r)),
      recommendations: recs.map((r, i) => {
        if (i === recIndex) return withStatus(r, rec);
        // stop recommending this request to any other driver (UC-07 step 6)
        if (r.requestId === request.requestId && r.status === STATUS.AWAITING) {
          const other = Recommendation.fromRecord(r);
          other.expire();
          return withStatus(r, other);
        }
        return r;
      }),
      rides: [...rides, ride.toRecord()]
    }, rev);
    if (result.ok) {
      recordAudit(driverId, "Driver confirmed recommendation", rec.recommendationId, now);
      const names = locationNames(locations, request);
      const passengerName = getUserName(request.passengerId);
      const note = notifyPassengerConfirmed(request.passengerId, getUserName(driverId), names.pickup, names.dropOff, now);
      if (!note) recordAudit(driverId, "Notification could not be saved (ride stays confirmed)", request.requestId, now);
      return { ok: true, ride: ride.toRecord(), passengerName };
    }
    if (result.reason === "write-failed" || result.reason === "bad-input") return { ok: false, reason: "save-failed" };
    // conflict: another tab saved in between; read again and re-check everything
  }
  return { ok: false, reason: "unavailable" };
}

// UC-07 alternative 2a / FR-07: record the rejection (Recommendation.reject). The RECOMMENDATION becomes Rejected;
// the request itself stays Pending (SRS state diagram). The caller then asks getOrCreateRecommendation() for the next best.
// Returns { ok: true } or { ok: false, reason: "not-found" | "expired" | "unavailable" | "save-failed" }.
export function rejectRecommendation(recommendationId, driverId, now = Date.now()) {
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const rev = getRideDataRevision();
    const recs = getList("recommendations");
    const index = recs.findIndex(r => r.recommendationId === recommendationId);
    if (index < 0 || recs[index].driverId !== driverId) return { ok: false, reason: "not-found" };
    const rec = Recommendation.fromRecord(recs[index]);
    if (rec.status !== STATUS.AWAITING) return { ok: false, reason: "unavailable" };
    const timeoutMin = timeoutMinFor(recs[index]);
    if (rec.isExpired(now, timeoutMin)) {
      markExpired([rec.recommendationId], "Recommendation expired (no response, request back to Pending)", now);
      return { ok: false, reason: "expired" };
    }
    rec.reject(now, timeoutMin);
    const result = saveRideData({ recommendations: recs.map((r, i) => (i === index ? withStatus(r, rec) : r)) }, rev);
    if (result.ok) {
      recordAudit(driverId, "Driver rejected recommendation", rec.recommendationId, now);
      return { ok: true };
    }
    if (result.reason !== "conflict") return { ok: false, reason: "save-failed" };
  }
  return { ok: false, reason: "unavailable" };
}
