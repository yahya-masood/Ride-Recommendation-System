// rideHistory.js - Ride History component (SRS FR-10, UC-14).
// The driver's confirmed rides with detour, estimated fuel cost and estimated profit.
// A ride that the passenger cancelled later is still listed, with status "Cancelled" (ASSUMPTION).
// NOTE: the SRS Package Diagram draws Ride History depending on Decision; this module reads the stored
// rides through storage.js instead, which gives the same result.

import { getList } from "./storage.js";
import { locationNames } from "./rideRequest.js";
import { getUserName } from "./auth.js";
import { firstName } from "./notification.js";
import { toMs } from "./dateUtils.js";

// Returns rows newest first: { rideId, confirmedAt, status, pickupName, dropOffName, passengerFirstName,
// detourKm, fuelCost, profit }. Needs the location list to show place names.
export function getRideHistory(driverId, locations) {
  const requests = getList("rideRequests");
  return getList("rides")
    .filter(r => r.driverId === driverId)
    .sort((a, b) => toMs(b.confirmedAt) - toMs(a.confirmedAt))
    .map(ride => {
      const request = requests.find(q => q.requestId === ride.requestId);
      const names = request ? locationNames(locations, request) : { pickup: "", dropOff: "" };
      return {
        rideId: ride.rideId,
        confirmedAt: ride.confirmedAt,
        status: ride.status,
        pickupName: names.pickup,
        dropOffName: names.dropOff,
        passengerFirstName: request ? firstName(getUserName(request.passengerId)) : "",
        detourKm: ride.detourKm,
        fuelCost: ride.fuelCost,
        profit: ride.profit
      };
    });
}
