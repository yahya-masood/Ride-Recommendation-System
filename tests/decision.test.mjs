// tests/decision.test.mjs - AUTOMATED NODE TESTS for js/decision.js. Run: node tests/decision.test.mjs
// Covers UC-06 step 6 and UC-07 (confirm, reject, timeout, request taken, save failure).
import { group, check, finish, resetStore, fake, rawGet, locations, distances, NOW, HOUR, MIN, iso } from "./testKit.mjs";
const dec = await import("../js/decision.js");
const storage = await import("../js/storage.js");
const auth = await import("../js/auth.js");
const { createPlan } = await import("../js/routePlan.js");
const { submitRequest, cancelRequest } = await import("../js/rideRequest.js");

async function setup() {
  resetStore();
  const d1 = (await auth.register({ name: "Ali Khan", role: "Driver", password: "secret1", fuelEfficiency: 12 })).user;
  const d2 = (await auth.register({ name: "Bilal Raza", role: "Driver", password: "secret1", fuelEfficiency: 12 })).user;
  const p1 = (await auth.register({ name: "Sara Noor", role: "Passenger", password: "secret1" })).user;
  const p2 = (await auth.register({ name: "Hina Malik", role: "Passenger", password: "secret1" })).user;
  const win = { source: "L01", destination: "L02", windowStart: iso(NOW), windowEnd: iso(NOW + 4 * HOUR) };
  createPlan(d1.userId, win, locations, NOW);
  createPlan(d2.userId, win, locations, NOW);
  const a = submitRequest(p1.userId, { pickup: "L03", dropOff: "L02", pickupTime: iso(NOW + HOUR), passengerCount: 1 }, locations, NOW).request;
  const b = submitRequest(p2.userId, { pickup: "L07", dropOff: "L02", pickupTime: iso(NOW + HOUR), passengerCount: 1 }, locations, NOW).request;
  return { d1, d2, p1, p2, a, b };
}
const reqStatus = id => storage.getList("rideRequests").find(r => r.requestId === id);

group("1 recommendation is shown, nothing is confirmed (UC-06)");
let { d1, d2, p1, a, b } = await setup();
const g1 = dec.getOrCreateRecommendation(d1.userId, NOW, distances);
check("best request is recommended", g1.status === "match" && g1.request.requestId === a.requestId);
check("recommendation is Awaiting Decision", g1.recommendation.status === "Awaiting Decision");
check("alternatives contain the next best request", g1.alternatives.length === 1 && g1.alternatives[0].request.requestId === b.requestId);
check("request is still Pending and unlocked (no automatic selection)", reqStatus(a.requestId).status === "Pending");
check("no ride exists yet", storage.getList("rides").length === 0);
check("no notification yet", storage.getList("notifications").length === 0);
const g1b = dec.getOrCreateRecommendation(d1.userId, NOW + 10000, distances);
check("same recommendation stays on screen (no duplicate)", g1b.recommendation.recommendationId === g1.recommendation.recommendationId && storage.getList("recommendations").length === 1);
check("audit: recommendation created", storage.getList("auditLogs").some(e => e.action === "Recommendation created"));
check("no active window gives inactive", dec.getOrCreateRecommendation("USR-none", NOW, distances).status === "inactive");

group("2 confirm (UC-07 main flow)");
const c1 = dec.confirmRecommendation(g1.recommendation.recommendationId, d1.userId, locations, NOW + MIN);
check("confirm succeeds", c1.ok === true && c1.ride.status === "Confirmed" && c1.ride.driverId === d1.userId);
check("request Confirmed (locked: RideRequest.lock)", reqStatus(a.requestId).status === "Confirmed" && storage.getList("rides").some(r => r.requestId === a.requestId && r.driverId === d1.userId));
check("recommendation Confirmed", storage.getList("recommendations")[0].status === "Confirmed");
check("ride copies detour, fuel cost and profit", c1.ride.detourKm === g1.recommendation.detourKm && c1.ride.fuelCost === g1.recommendation.fuelCost && c1.ride.profit === g1.recommendation.profit);
check("passenger name revealed only after confirm", c1.passengerName === "Sara Noor");
const note = storage.getList("notifications")[0];
check("passenger notified (UC-08)", note && note.recipientId === p1.userId && /confirmed/.test(note.message));
check("notification has no contact data or full driver name", !/Khan/.test(note.message));
check("decision written to audit log", storage.getList("auditLogs").some(e => e.action === "Driver confirmed recommendation"));
check("confirming twice refused", dec.confirmRecommendation(g1.recommendation.recommendationId, d1.userId, locations, NOW + MIN).ok === false);
check("confirmed request is not recommended again", dec.getOrCreateRecommendation(d1.userId, NOW + 2 * MIN, distances).request.requestId === b.requestId);

group("3 request taken by another driver (alternative 3a, NFR-05)");
({ d1, d2, p1, a, b } = await setup());
const x1 = dec.getOrCreateRecommendation(d1.userId, NOW, distances);
const x2 = dec.getOrCreateRecommendation(d2.userId, NOW, distances);
check("both drivers see the same top request", x1.request.requestId === x2.request.requestId);
check("driver 1 confirms", dec.confirmRecommendation(x1.recommendation.recommendationId, d1.userId, locations, NOW + MIN).ok);
check("driver 2's recommendation was stopped (Expired)", storage.getList("recommendations").find(r => r.recommendationId === x2.recommendation.recommendationId).status === "Expired");
const late = dec.confirmRecommendation(x2.recommendation.recommendationId, d2.userId, locations, NOW + MIN);
check("driver 2 gets 'unavailable'", late.ok === false && late.reason === "unavailable");
check("only one ride exists for the request", storage.getList("rides").filter(r => r.requestId === x1.request.requestId).length === 1);
check("request stays Confirmed for driver 1", reqStatus(x1.request.requestId).status === "Confirmed" && storage.getList("rides").filter(r => r.requestId === x1.request.requestId).length === 1);
check("driver 2 now gets the next best request", dec.getOrCreateRecommendation(d2.userId, NOW + 2 * MIN, distances).request.requestId === b.requestId);
check("a driver cannot confirm another driver's recommendation", dec.confirmRecommendation(x1.recommendation.recommendationId, d2.userId, locations, NOW).reason === "not-found");

group("4 request cancelled before confirm (alternative 3a)");
({ d1, d2, p1, a, b } = await setup());
const y1 = dec.getOrCreateRecommendation(d1.userId, NOW, distances);
cancelRequest(a.requestId, p1.userId, locations, NOW + 5000);
const yc = dec.confirmRecommendation(y1.recommendation.recommendationId, d1.userId, locations, NOW + 10000);
check("confirm refused as unavailable", yc.ok === false && yc.reason === "unavailable");
check("no ride and no notification created", storage.getList("rides").length === 0 && storage.getList("notifications").length === 0);
check("cancelled request is not changed back", reqStatus(a.requestId).status === "Cancelled");

group("5 reject (FR-07, alternative 2a)");
({ d1, d2, p1, a, b } = await setup());
const z1 = dec.getOrCreateRecommendation(d1.userId, NOW, distances);
const rj = dec.rejectRecommendation(z1.recommendation.recommendationId, d1.userId, NOW + MIN);
check("reject succeeds", rj.ok === true);
check("recommendation is Rejected but the request stays Pending", storage.getList("recommendations")[0].status === "Rejected" && reqStatus(a.requestId).status === "Pending");
check("rejection written to audit log", storage.getList("auditLogs").some(e => e.action === "Driver rejected recommendation"));
const z2 = dec.getOrCreateRecommendation(d1.userId, NOW + MIN, distances);
check("next best request is recommended", z2.status === "match" && z2.request.requestId === b.requestId);
check("rejected request is not offered again to the same driver (ASSUMPTION)", z2.alternatives.length === 0);
dec.rejectRecommendation(z2.recommendation.recommendationId, d1.userId, NOW + 2 * MIN);
check("nothing left gives no-match (No further match)", dec.getOrCreateRecommendation(d1.userId, NOW + 2 * MIN, distances).status === "no-match");
check("another driver can still get the rejected request", dec.getOrCreateRecommendation(d2.userId, NOW + 2 * MIN, distances).request.requestId === a.requestId);
check("rejecting twice refused", dec.rejectRecommendation(z1.recommendation.recommendationId, d1.userId, NOW + 3 * MIN).ok === false);

group("6 timeout (FR-07: expires, never confirms)");
({ d1, d2, p1, a, b } = await setup());
const t1 = dec.getOrCreateRecommendation(d1.userId, NOW, distances);
check("expiry time is 2 minutes after shownAt", dec.getExpiryMs(t1.recommendation) === NOW + 2 * MIN);
check("not expired at 1:59", dec.expireTimedOut(NOW + 2 * MIN - 1) === 0);
check("expired at 2:00 (boundary)", dec.expireTimedOut(NOW + 2 * MIN) === 1);
check("recommendation Expired, request back in Pending pool", storage.getList("recommendations")[0].status === "Expired" && reqStatus(a.requestId).status === "Pending");
check("no ride and no notification after timeout", storage.getList("rides").length === 0 && storage.getList("notifications").length === 0);
check("timeout is logged", storage.getList("auditLogs").some(e => /expired \(no response/.test(e.action)));
check("late Confirm after timeout is refused", dec.confirmRecommendation(t1.recommendation.recommendationId, d1.userId, locations, NOW + 3 * MIN).ok === false);
({ d1, d2, p1, a, b } = await setup());
const t2 = dec.getOrCreateRecommendation(d1.userId, NOW, distances);
const lateConfirm = dec.confirmRecommendation(t2.recommendation.recommendationId, d1.userId, locations, NOW + 2 * MIN);
check("Confirm exactly at timeout is refused as expired", lateConfirm.ok === false && lateConfirm.reason === "expired" && storage.getList("rides").length === 0);
check("late Reject is refused as expired", dec.rejectRecommendation(t2.recommendation.recommendationId, d1.userId, NOW + 3 * MIN).ok === false);
check("a new recommendation can be created after the timeout (other drivers' request pool)", dec.getOrCreateRecommendation(d2.userId, NOW + 3 * MIN, distances).status === "match");
// settings changed later apply to future recommendations only
({ d1, d2, p1, a, b } = await setup());
const t3 = dec.getOrCreateRecommendation(d1.userId, NOW, distances);
storage.saveSettings({ maxDetourKm: 5, weights: [25, 25, 20, 30], farePerKm: 30, fuelPrice: 280, responseTimeoutMin: 10 });
check("an existing recommendation keeps its own timeout", dec.getExpiryMs(t3.recommendation) === NOW + 2 * MIN);

group("7 save failure (UC-07 exception)");
({ d1, d2, p1, a, b } = await setup());
const s1 = dec.getOrCreateRecommendation(d1.userId, NOW, distances);
const before = rawGet("rr_rideData");
fake.failWrites = true;
const sf = dec.confirmRecommendation(s1.recommendation.recommendationId, d1.userId, locations, NOW + MIN);
fake.failWrites = false;
check("failed save reported", sf.ok === false && sf.reason === "save-failed");
check("nothing changed in ride data (fully or not at all)", rawGet("rr_rideData") === before);
check("request stays Pending", reqStatus(a.requestId).status === "Pending");
check("driver can retry and succeed", dec.confirmRecommendation(s1.recommendation.recommendationId, d1.userId, locations, NOW + MIN).ok);
({ d1, d2, p1, a, b } = await setup());
const s2 = dec.getOrCreateRecommendation(d1.userId, NOW, distances);
const originalSet = localStorage.setItem;
let n = 0;
localStorage.setItem = (k, v) => { if (k === "rr_notifications") throw new Error("fake failure"); return originalSet(k, v); };
const nf = dec.confirmRecommendation(s2.recommendation.recommendationId, d1.userId, locations, NOW + MIN);
localStorage.setItem = originalSet;
check("failed notification does not undo the confirmation (UC-08)", nf.ok === true && reqStatus(a.requestId).status === "Confirmed");
check("the failed notification is logged", storage.getList("auditLogs").some(e => /Notification could not be saved/.test(e.action)));

group("8 engine data error");
({ d1, d2, p1, a, b } = await setup());
const users = storage.getList("users"); users.find(u => u.userId === d1.userId).fuelEfficiency = 0; storage.saveList("users", users);
const er = dec.getOrCreateRecommendation(d1.userId, NOW, distances);
check("bad driver data gives an error and no recommendation", er.status === "error" && storage.getList("recommendations").length === 0);

finish("js/decision.js");
