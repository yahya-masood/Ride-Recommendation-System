// tests/rideRequest.test.mjs - AUTOMATED NODE TESTS for js/rideRequest.js. Run: node tests/rideRequest.test.mjs
import { group, check, finish, resetStore, fake, locations, NOW, HOUR, MIN, iso } from "./testKit.mjs";
const rr = await import("../js/rideRequest.js");
const storage = await import("../js/storage.js");
const P1 = "USR-p1", P2 = "USR-p2";
const input = (over = {}) => ({ pickup: "L03", dropOff: "L02", pickupTime: iso(NOW + HOUR), passengerCount: 1, ...over });

group("1 validation (UC-03 step 5)");
check("valid request has no errors", rr.validateRequest(input(), locations, NOW).length === 0);
check("unknown pickup rejected", rr.validateRequest(input({ pickup: "Z9" }), locations, NOW).length > 0);
check("unknown drop-off rejected", rr.validateRequest(input({ dropOff: undefined }), locations, NOW).length > 0);
check("pickup equals drop-off rejected", rr.validateRequest(input({ dropOff: "L03" }), locations, NOW).some(e => /different/.test(e)));
check("pickup time in the past rejected", rr.validateRequest(input({ pickupTime: iso(NOW - MIN - 1) }), locations, NOW).some(e => /past/.test(e)));
check("pickup up to 1 minute behind is accepted (minute precision of the input)", rr.validateRequest(input({ pickupTime: iso(NOW - MIN) }), locations, NOW).length === 0);
check("pickup time exactly now accepted (boundary)", rr.validateRequest(input({ pickupTime: iso(NOW) }), locations, NOW).length === 0);
check("invalid time rejected", rr.validateRequest(input({ pickupTime: "tomorrow" }), locations, NOW).length > 0);
check("passenger count 0 rejected (boundary)", rr.validateRequest(input({ passengerCount: 0 }), locations, NOW).length > 0);
check("passenger count 1 accepted (boundary)", rr.validateRequest(input({ passengerCount: 1 }), locations, NOW).length === 0);
check("passenger count 1.5 rejected", rr.validateRequest(input({ passengerCount: 1.5 }), locations, NOW).length > 0);
check("passenger count as text rejected", rr.validateRequest(input({ passengerCount: "2" }), locations, NOW).length > 0);
check("null input rejected without throwing", rr.validateRequest(null, locations, NOW).length > 0);

group("2 submit (UC-03)");
resetStore();
const s1 = rr.submitRequest(P1, input(), locations, NOW);
check("request stored as Pending", s1.ok && s1.request.status === "Pending");
check("saved in ride data", storage.getList("rideRequests").length === 1);
check("audit entry written", storage.getList("auditLogs").some(e => e.action === "Ride request submitted"));
check("duplicate active request for the same time refused (5b)", !rr.submitRequest(P1, input(), locations, NOW).ok && storage.getList("rideRequests").length === 1);
check("same time for another passenger allowed", rr.submitRequest(P2, input(), locations, NOW).ok);
check("another time for the same passenger allowed", rr.submitRequest(P1, input({ pickupTime: iso(NOW + 2 * HOUR) }), locations, NOW).ok);
check("invalid request is not saved", !rr.submitRequest(P1, input({ passengerCount: 0 }), locations, NOW).ok && storage.getList("rideRequests").length === 3);
const rev = storage.getRideDataRevision();
fake.failWrites = true;
check("save failure reported and nothing changes", !rr.submitRequest(P1, input({ pickupTime: iso(NOW + 5 * HOUR) }), locations, NOW).ok);
fake.failWrites = false;
check("revision unchanged after failed save", storage.getRideDataRevision() === rev);

group("3 view (UC-09)");
const mine = rr.getRequestsFor(P1, NOW);
check("passenger sees only own requests", mine.length === 2 && mine.every(r => r.passengerId === P1));
check("sorted newest pickup first", mine[0].pickupTime > mine[1].pickupTime);
check("passenger without requests gets an empty list", rr.getRequestsFor("USR-none", NOW).length === 0);
check("pending pool has the pending requests", rr.getPendingRequests(NOW).length === 3);

group("4 expiry (FR-03)");
resetStore();
rr.submitRequest(P1, input({ pickupTime: iso(NOW + HOUR) }), locations, NOW);
check("not expired before pickup time", rr.expireRequests(NOW + HOUR - 1) === 0);
check("expired at pickup time (boundary)", rr.expireRequests(NOW + HOUR) === 1);
check("status is Expired and audited", rr.getRequestsFor(P1, NOW + HOUR)[0].status === "Expired" && storage.getList("auditLogs").some(e => e.action === "Ride request expired"));
check("expired request leaves the pending pool", rr.getPendingRequests(NOW + HOUR).length === 0);
check("expiring twice does nothing", rr.expireRequests(NOW + 2 * HOUR) === 0);

group("5 cancel (UC-10)");
resetStore();
const a = rr.submitRequest(P1, input(), locations, NOW).request;
check("other passenger cannot cancel", !rr.cancelRequest(a.requestId, P2, locations, NOW).ok);
check("unknown request refused", !rr.cancelRequest("REQ-none", P1, locations, NOW).ok);
const c = rr.cancelRequest(a.requestId, P1, locations, NOW);
check("pending request cancelled", c.ok && rr.getRequestsFor(P1, NOW)[0].status === "Cancelled");
check("cancel audited", storage.getList("auditLogs").some(e => e.action === "Ride request cancelled"));
check("cancelling twice refused", !rr.cancelRequest(a.requestId, P1, locations, NOW).ok);
const b = rr.submitRequest(P1, input({ pickupTime: iso(NOW + 2 * HOUR) }), locations, NOW).request;
check("pickup time passed: cancel refused", !rr.cancelRequest(b.requestId, P1, locations, NOW + 2 * HOUR).ok);
// confirmed request: build the data directly as decision.js would
const d = rr.submitRequest(P1, input({ pickupTime: iso(NOW + 3 * HOUR) }), locations, NOW).request;
const rev2 = storage.getRideDataRevision();
storage.saveRideData({
  rideRequests: storage.getList("rideRequests").map(r => (r.requestId === d.requestId ? { ...r, status: "Confirmed" } : r)),
  rides: [{ rideId: "RID-1", recommendationId: "REC-1", driverId: "USR-d1", requestId: d.requestId, detourKm: 1, fuelCost: 2, profit: 3, status: "Confirmed", confirmedAt: iso(NOW) }]
}, rev2);
const cc = rr.cancelRequest(d.requestId, P1, locations, NOW);
check("confirmed request can be cancelled", cc.ok);
check("ride becomes Cancelled", storage.getList("rides")[0].status === "Cancelled");
check("driver is notified", storage.getList("notifications").some(n => n.recipientId === "USR-d1" && /cancelled/.test(n.message)));
const f = rr.submitRequest(P2, input({ pickupTime: iso(NOW + 4 * HOUR) }), locations, NOW).request;
fake.failWrites = true;
check("failed cancel keeps the request unchanged", !rr.cancelRequest(f.requestId, P2, locations, NOW).ok);
fake.failWrites = false;
check("request still Pending after failed cancel", rr.getRequestsFor(P2, NOW)[0].status === "Pending");

finish("js/rideRequest.js");
