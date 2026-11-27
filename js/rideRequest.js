// rideRequest.js - Ride Request package (SRS FR-03, UC-03, UC-09, UC-10). Saves and loads RideRequest objects
// (js/classes/RideRequest.js): submit, validate, view, cancel and expire passenger ride requests.
// Stored record: { requestId, passengerId, pickup, dropOff, pickupTime, passengerCount,
//                  status: "Pending"|"Confirmed"|"Cancelled"|"Expired" }
// Every change to requests/rides follows the storage.js pattern: read revision, build lists,
// saveRideData(changes, revision), handle "conflict" (retry a few times) and "write-failed".

import { getList, getRideDataRevision, saveRideData, newId } from "./storage.js";
import { recordAudit } from "./auditLog.js";
import { notifyDriverCancelled } from "./notification.js";
import { getUserName } from "./auth.js";
import { RideRequest } from "./classes/RideRequest.js";
import { Ride } from "./classes/Ride.js";
import { toMs, toIso } from "./dateUtils.js";

const MAX_TRIES = 3;

// UC-03 step 5 (RideRequest.validate). Returns a list of error messages (empty = valid).
export function validateRequest(input, locations, now = Date.now()) {
  const data = input && typeof input === "object" ? input : {};
  const request = new RideRequest(data);
  request.validate(locations, now);
  return request.errors;
}

// UC-03 alternative 5b: the passenger already has an active (Pending or Confirmed) request for the same time.
function hasDuplicate(requests, passengerId, pickupMs) {
  return requests.some(r => r.passengerId === passengerId
    && (r.status === "Pending" || r.status === "Confirmed") && toMs(r.pickupTime) === pickupMs);
}

// Submits a request with status Pending. Returns { ok: true, request } or { ok: false, errors }.
export function submitRequest(passengerId, input, locations, now = Date.now()) {
  const data = input && typeof input === "object" ? input : {};
  const request = new RideRequest({ ...data, passengerId, requestId: null, status: "Pending" });
  if (!request.validate(locations, now)) return { ok: false, errors: request.errors };
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const rev = getRideDataRevision();
    const requests = getList("rideRequests");
    if (hasDuplicate(requests, passengerId, toMs(request.pickupTime))) {
      return { ok: false, errors: ["You already have an active request for this time"] };
    }
    request.requestId = newId("REQ");
    request.pickupTime = toIso(toMs(request.pickupTime));
    const result = saveRideData({ rideRequests: [...requests, request.toRecord()] }, rev);
    if (result.ok) {
      recordAudit(passengerId, "Ride request submitted", request.requestId, now);
      return { ok: true, request: request.toRecord() };
    }
    if (result.reason !== "conflict") break;
  }
  return { ok: false, errors: ["The request could not be saved. Please try again."] };
}

// UC-09: all requests of one passenger, newest pickup time first.
export function getRequestsFor(passengerId, now = Date.now()) {
  expireRequests(now);
  return getList("rideRequests")
    .filter(r => r.passengerId === passengerId)
    .sort((a, b) => toMs(b.pickupTime) - toMs(a.pickupTime))
    .map(r => RideRequest.fromRecord(r).toRecord());
}

// Pending requests (the pool the Recommendation Engine reads).
export function getPendingRequests(now = Date.now()) {
  expireRequests(now);
  return getList("rideRequests").filter(r => r.status === "Pending").map(r => RideRequest.fromRecord(r).toRecord());
}

// FR-03: a request whose preferred pickup time has passed without confirmation becomes Expired
// (RideRequest.markExpired). Returns how many requests were expired.
export function expireRequests(now = Date.now()) {
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const rev = getRideDataRevision();
    const requests = getList("rideRequests");
    const expiredIds = [];
    const updated = requests.map(record => {
      const request = RideRequest.fromRecord(record);
      if (request.markExpired(now)) expiredIds.push(request.requestId);
      return request.toRecord();
    });
    if (expiredIds.length === 0) return 0;
    const result = saveRideData({ rideRequests: updated }, rev);
    if (result.ok) {
      expiredIds.forEach(id => recordAudit("system", "Ride request expired", id, now));
      return expiredIds.length;
    }
    if (result.reason !== "conflict") return 0;
  }
  return 0;
}

// UC-10: cancel a Pending or Confirmed request before pickup (RideRequest.cancel). If it was Confirmed the ride is
// cancelled too (Ride.cancel) and the driver is notified (ASSUMPTION, see docs: SRS does not define the ride status).
// Returns { ok: true, request } or { ok: false, errors }.
export function cancelRequest(requestId, passengerId, locations, now = Date.now()) {
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const rev = getRideDataRevision();
    const requests = getList("rideRequests");
    const index = requests.findIndex(r => r.requestId === requestId && r.passengerId === passengerId);
    if (index < 0) return { ok: false, errors: ["Request not found"] };
    const request = RideRequest.fromRecord(requests[index]);
    const wasConfirmed = request.status === "Confirmed";
    if (!request.cancel(now)) return { ok: false, errors: request.errors };
    const changes = { rideRequests: requests.map((r, i) => (i === index ? request.toRecord() : r)) };
    let confirmedRide = null;
    if (wasConfirmed) {
      const rides = getList("rides");
      const rideIndex = rides.findIndex(r => r.requestId === requestId && r.status === "Confirmed");
      if (rideIndex >= 0) {
        confirmedRide = Ride.fromRecord(rides[rideIndex]);
        confirmedRide.cancel();
        changes.rides = rides.map((r, i) => (i === rideIndex ? confirmedRide.toRecord() : r));
      }
    }
    const result = saveRideData(changes, rev);
    if (result.ok) {
      recordAudit(passengerId, "Ride request cancelled", requestId, now);
      if (wasConfirmed && confirmedRide) {
        const names = locationNames(locations, request);
        notifyDriverCancelled(confirmedRide.driverId, getUserName(passengerId), names.pickup, names.dropOff, now);
      }
      return { ok: true, request: request.toRecord() };
    }
    if (result.reason !== "conflict") break;
  }
  return { ok: false, errors: ["The cancellation could not be saved. The request is unchanged. Please try again."] };
}

// Location id -> name helper for messages.
export function locationNames(locations, request) {
  const nameOf = id => {
    const found = Array.isArray(locations) ? locations.find(l => l.id === id) : null;
    return found ? found.name : id;
  };
  return { pickup: nameOf(request.pickup), dropOff: nameOf(request.dropOff) };
}
