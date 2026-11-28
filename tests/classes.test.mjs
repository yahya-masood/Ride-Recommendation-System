// tests/classes.test.mjs - AUTOMATED NODE TESTS: does the code match the SRS Class Diagram (Figure 7)?
// Run: node tests/classes.test.mjs
// Part 1 compares every class with the diagram: the attributes and the operations must be exactly the ones drawn.
// Part 2 checks the behaviour of the operations (state changes of RoutePlan, RideRequest, Recommendation, Ride ...).
// Part 3 runs a whole flow only through the operations of Driver, Passenger and Administrator.
import { group, check, finish, resetStore, locations, distances, NOW, HOUR, MIN, iso } from "./testKit.mjs";

const { RoutePlan } = await import("../js/classes/RoutePlan.js");
const { RideRequest } = await import("../js/classes/RideRequest.js");
const { Recommendation } = await import("../js/classes/Recommendation.js");
const { Ride } = await import("../js/classes/Ride.js");
const { Notification } = await import("../js/classes/Notification.js");
const { AuditLog } = await import("../js/classes/AuditLog.js");
const { Settings } = await import("../js/classes/Settings.js");
const { RecommendationEngine } = await import("../js/classes/RecommendationEngine.js");
const { Driver } = await import("../js/classes/Driver.js");
const { Passenger } = await import("../js/classes/Passenger.js");
const { Administrator } = await import("../js/classes/Administrator.js");
const storage = await import("../js/storage.js");
const auth = await import("../js/auth.js");
const decision = await import("../js/decision.js");

// ---- Part 1: the Class Diagram, copied from SRS section 4.8 ----
// attributes = the attributes drawn in the class box; links = ids that implement the drawn associations
const DIAGRAM = {
  RoutePlan: { cls: RoutePlan, attributes: ["planId", "source", "destination", "windowStart", "windowEnd", "status"], links: ["driverId"], operations: ["validate", "isActive", "modify", "end"] },
  Driver: { cls: Driver, attributes: ["driverId", "name", "fuelEfficiency", "vehicleSeats"], links: [], operations: ["register", "login", "defineRoutePlan", "confirm", "reject", "viewRideHistory"] },
  Notification: { cls: Notification, attributes: ["notificationId", "message", "createdAt"], links: ["recipientId"], operations: ["send"] },
  RecommendationEngine: { cls: RecommendationEngine, attributes: [], links: [], operations: ["filterRequests", "calculateDetour", "estimateFuelCost", "estimateProfit", "rankRequests", "createRecommendation"] },
  Recommendation: { cls: Recommendation, attributes: ["recommendationId", "routeScore", "detourKm", "fuelCost", "profit", "score", "status", "shownAt"], links: ["planId", "requestId", "driverId"], operations: ["confirm", "reject", "expire", "isExpired"] },
  Ride: { cls: Ride, attributes: ["rideId", "detourKm", "fuelCost", "profit", "status", "confirmedAt"], links: ["recommendationId", "driverId", "requestId"], operations: ["cancel"] },
  Settings: { cls: Settings, attributes: ["maxDetourKm", "weights", "farePerKm", "fuelPrice", "responseTimeoutMin"], links: [], operations: ["validate"] },
  RideRequest: { cls: RideRequest, attributes: ["requestId", "pickup", "dropOff", "pickupTime", "passengerCount", "status"], links: ["passengerId"], operations: ["validate", "cancel", "lock", "markExpired"] },
  Passenger: { cls: Passenger, attributes: ["passengerId", "name"], links: [], operations: ["register", "login", "submitRequest", "viewStatus", "cancelRequest"] },
  Administrator: { cls: Administrator, attributes: ["adminId", "name"], links: [], operations: ["login", "manageUsers", "configureSettings", "viewAuditLog"] },
  AuditLog: { cls: AuditLog, attributes: ["logId", "timestamp", "userId", "action", "recordRef"], links: [], operations: ["record"] }
};
// helpers that are not in the UML (documented in each class file)
const HELPER_OPERATIONS = ["constructor", "toRecord", "expireIfDue", "fromUser", "fromRecord", "current", "createFrom", "checkData"];
const HELPER_ATTRIBUTES = ["errors", "plan", "excluded", "skipped", "fuelEfficiency", "settings", "distances"];

group("1 the 11 classes of the Class Diagram exist");
check("exactly 11 classes are checked", Object.keys(DIAGRAM).length === 11);
for (const [name, spec] of Object.entries(DIAGRAM)) {
  check(name + " is a class named like the diagram", typeof spec.cls === "function" && spec.cls.name === name);
}

group("2 attributes match the diagram");
for (const [name, spec] of Object.entries(DIAGRAM)) {
  if (name === "RecommendationEngine") continue;
  const keys = Object.keys(new spec.cls()).filter(k => !HELPER_ATTRIBUTES.includes(k) || spec.attributes.includes(k) || spec.links.includes(k));
  const expected = [...spec.attributes, ...spec.links].sort();
  check(name + " has the attributes " + spec.attributes.join(", ") + (spec.links.length ? " (+ " + spec.links.join(", ") + " for the associations)" : ""),
    JSON.stringify(keys.sort()) === JSON.stringify(expected));
}
check("RecommendationEngine has no attributes of its own in the diagram", DIAGRAM.RecommendationEngine.attributes.length === 0);

group("3 operations match the diagram");
for (const [name, spec] of Object.entries(DIAGRAM)) {
  for (const op of spec.operations) check(name + "." + op + "() exists", typeof spec.cls.prototype[op] === "function");
  const extra = Object.getOwnPropertyNames(spec.cls.prototype).filter(n => !spec.operations.includes(n) && !HELPER_OPERATIONS.includes(n));
  check(name + " has no operation that is not in the diagram (found: " + (extra.join(", ") || "none") + ")", extra.length === 0);
}

// ---- Part 2: behaviour ----
const plan = (over = {}) => new RoutePlan({ planId: "P1", driverId: "D1", source: "L01", destination: "L02", windowStart: iso(NOW + HOUR), windowEnd: iso(NOW + 3 * HOUR), ...over });

group("4 RoutePlan operations");
check("validate() true for a good plan", plan().validate(locations, [], NOW) === true);
check("validate() false when end is before start", plan({ windowEnd: iso(NOW) }).validate(locations, [], NOW) === false);
check("isActive() false before the window", plan().isActive(NOW) === false);
check("isActive() true inside the window", plan().isActive(NOW + 2 * HOUR) === true);
check("isActive() false at the end (boundary)", plan().isActive(NOW + 3 * HOUR) === false);
const p1 = plan();
check("modify() changes the destination", p1.modify({ destination: "L03" }, locations, [p1.toRecord()], NOW) === true && p1.destination === "L03");
check("modify() refuses an invalid change and keeps the old value", p1.modify({ source: "L03" }, locations, [], NOW) === false && p1.source === "L01");
check("end() sets Ended", p1.end() === true && p1.status === "Ended");
check("modify() refused after the plan ended", p1.modify({ destination: "L02" }, locations, [], NOW) === false);
check("end() twice is refused", p1.end() === false);

const request = (over = {}) => new RideRequest({ requestId: "R1", passengerId: "P1", pickup: "L03", dropOff: "L02", pickupTime: iso(NOW + 2 * HOUR), passengerCount: 2, ...over });
group("5 RideRequest operations");
check("new request is Pending", request().status === "Pending");
check("validate() true", request().validate(locations, NOW) === true);
check("validate() false for pickup = drop-off", request({ dropOff: "L03" }).validate(locations, NOW) === false);
check("validate() false for 0 passengers (boundary)", request({ passengerCount: 0 }).validate(locations, NOW) === false);
check("validate() true for 1 passenger (boundary)", request({ passengerCount: 1 }).validate(locations, NOW) === true);
const r1 = request();
check("lock() Pending -> Confirmed", r1.lock() === true && r1.status === "Confirmed");
check("lock() twice is refused (only one driver, NFR-05)", r1.lock() === false);
check("cancel() a Confirmed request before pickup", r1.cancel(NOW) === true && r1.status === "Cancelled");
check("cancel() a Cancelled request is refused", r1.cancel(NOW) === false);
check("cancel() after the pickup time is refused", request().cancel(NOW + 3 * HOUR) === false);
const r2 = request();
check("markExpired() before the pickup time does nothing", r2.markExpired(NOW) === false && r2.status === "Pending");
check("markExpired() at the pickup time (boundary)", r2.markExpired(NOW + 2 * HOUR) === true && r2.status === "Expired");
check("lock() on an Expired request is refused", r2.lock() === false);

const rec = (over = {}) => new Recommendation({ recommendationId: "REC1", planId: "P1", requestId: "R1", driverId: "D1", routeScore: 80, detourKm: 1, fuelCost: 10, profit: 100, score: 77, shownAt: iso(NOW), ...over });
group("6 Recommendation operations (state diagram)");
check("starts as Awaiting Decision", rec().status === "Awaiting Decision");
check("isExpired() false inside the timeout", rec().isExpired(NOW + 2 * MIN - 1, 2) === false);
check("isExpired() true at the timeout (boundary)", rec().isExpired(NOW + 2 * MIN, 2) === true);
const a1 = rec();
check("confirm() -> Confirmed", a1.confirm(NOW + MIN, 2) === true && a1.status === "Confirmed");
check("confirm() again is refused", a1.confirm(NOW + MIN, 2) === false);
const a2 = rec();
check("reject() -> Rejected", a2.reject(NOW + MIN, 2) === true && a2.status === "Rejected");
const a3 = rec();
check("late confirm() is refused and the recommendation expires", a3.confirm(NOW + 3 * MIN, 2) === false && a3.status === "Expired");
const a4 = rec();
check("expire() -> Expired", a4.expire() === true && a4.status === "Expired");
check("expire() on a Confirmed recommendation does nothing", (() => { const c = rec(); c.confirm(NOW, 2); return c.expire() === false && c.status === "Confirmed"; })());

group("7 Ride operations");
const ride = Ride.createFrom(rec(), "RID1", NOW);
check("ride copies detour, fuel cost and profit from the recommendation", ride.detourKm === 1 && ride.fuelCost === 10 && ride.profit === 100 && ride.driverId === "D1" && ride.requestId === "R1" && ride.recommendationId === "REC1");
check("ride is Confirmed with confirmedAt", ride.status === "Confirmed" && ride.confirmedAt === iso(NOW));
check("cancel() -> Cancelled", ride.cancel() === true && ride.status === "Cancelled");
check("cancel() twice is refused", ride.cancel() === false);

group("8 Settings.validate");
check("defaults are valid", new Settings().validate() === true);
check("weights must total 100", new Settings({ weights: [25, 25, 20, 31] }).validate() === false);
check("a weight of 9 is refused (10-40)", new Settings({ weights: [9, 26, 25, 40] }).validate() === false);
check("a weight of 40 and 10 are accepted (boundary)", new Settings({ weights: [40, 10, 25, 25] }).validate() === true);
check("max detour 0 is refused", new Settings({ maxDetourKm: 0 }).validate() === false);
resetStore();
check("Settings.current() returns the defaults before anything is saved", Settings.current().maxDetourKm === 5 && Settings.current().responseTimeoutMin === 2);

group("9 RecommendationEngine operations");
const engine = new RecommendationEngine({ settings: new Settings(), driver: { fuelEfficiency: 12 }, distances });
const routePlan = new RoutePlan({ planId: "P1", driverId: "D1", source: "L01", destination: "L02", windowStart: iso(NOW), windowEnd: iso(NOW + 4 * HOUR) });
const good = request({ requestId: "G", pickup: "L01", dropOff: "L02" });
const outside = request({ requestId: "O", pickupTime: iso(NOW + 9 * HOUR) });
const kept = engine.filterRequests(routePlan, [good, outside, request({ requestId: "C", status: "Cancelled" })]);
check("filterRequests() keeps the Pending request inside the window and removes the others", kept.length === 1 && kept[0].requestId === "G");
check("calculateDetour() is 0 for a request on the exact route", engine.calculateDetour(good) === 0);
check("estimateFuelCost() is 0 without a detour", engine.estimateFuelCost(good) === 0);
check("estimateProfit() = fare of the trip when there is no detour", Math.abs(engine.estimateProfit(good) - distances.L01.L02 * 30) < 1e-9);
const ranked = engine.rankRequests(kept);
check("rankRequests() returns the candidate with score 0..100", ranked.length === 1 && ranked[0].score >= 0 && ranked[0].score <= 100);
const created = engine.createRecommendation(ranked[0], "D1", "REC9", NOW);
check("createRecommendation() returns a Recommendation in Awaiting Decision", created instanceof Recommendation && created.status === "Awaiting Decision" && created.requestId === "G" && created.driverId === "D1");

group("10 Notification.send and AuditLog.record");
resetStore();
check("send() saves a notification", new Notification({ recipientId: "U1", message: "Hello" }).send(NOW) === true && storage.getList("notifications").length === 1);
check("send() refuses an empty message", new Notification({ recipientId: "U1", message: "  " }).send(NOW) === false);
check("record() saves an audit entry with the five attributes", new AuditLog({ userId: "U1", action: "x", recordRef: "R" }).record(NOW) === true
  && JSON.stringify(Object.keys(storage.getList("auditLogs")[0]).sort()) === JSON.stringify(["action", "logId", "recordRef", "timestamp", "userId"]));
check("record() refuses an empty action", new AuditLog({ userId: "U1", action: "" }).record(NOW) === false);

// ---- Part 3: a whole flow only through the operations of the actor classes ----
group("11 Driver, Passenger and Administrator operations (UC-01 to UC-14)");
resetStore();
await auth.ensureSeedAdmin();
const admin = new Administrator({ name: "admin" });
check("Administrator.login() with the right password", (await admin.login("Admin@123")).ok === true && admin.adminId !== null);
check("Administrator.login() with a wrong password fails", (await new Administrator({ name: "admin" }).login("wrong")).ok === false);
const driver = new Driver({ name: "Ali Driver", fuelEfficiency: 12, vehicleSeats: 4 });
const dReg = await driver.register("secret1");
check("Driver.register() creates the account and sets driverId", dReg.ok === true && typeof driver.driverId === "string");
check("Driver.register() with a duplicate name fails", (await new Driver({ name: "ali driver", fuelEfficiency: 12 }).register("secret1")).ok === false);
check("Driver.register() without fuel efficiency fails", (await new Driver({ name: "Zed", fuelEfficiency: NaN }).register("secret1")).ok === false);
const passenger = new Passenger({ name: "Sara Khan" });
check("Passenger.register() works", (await passenger.register("secret2")).ok === true && typeof passenger.passengerId === "string");
check("Passenger cannot log in as Driver (role check)", (await new Driver({ name: "Sara Khan" }).login("secret2")).ok === false);
check("Driver.login() works", (await new Driver({ name: "Ali Driver" }).login("secret1")).ok === true);
check("Administrator.manageUsers('list') shows 3 accounts", (await admin.manageUsers("list")).length === 3);
check("Administrator.manageUsers('deactivate') works and the account cannot log in", (await (async () => {
  const extra = new Passenger({ name: "Temp User" }); await extra.register("secret3");
  const r = await admin.manageUsers("deactivate", { userId: extra.passengerId });
  return r.ok && (await new Passenger({ name: "Temp User" }).login("secret3")).ok === false;
})()) === true);

const nowMs = Date.now();
const plan1 = driver.defineRoutePlan({ source: "L01", destination: "L02", windowStart: iso(nowMs), windowEnd: iso(nowMs + 2 * HOUR) }, locations);
check("Driver.defineRoutePlan() creates an Active plan", plan1.ok === true && plan1.plan.status === "Active");
const sub1 = passenger.submitRequest({ pickup: "L01", dropOff: "L02", pickupTime: iso(nowMs + HOUR), passengerCount: 1 }, locations);
check("Passenger.submitRequest() creates a Pending request", sub1.ok === true && sub1.request.status === "Pending");
check("Passenger.viewStatus() lists it", passenger.viewStatus().length === 1);

const shown = decision.getOrCreateRecommendation(driver.driverId, nowMs, distances);
check("the engine recommends the request", shown.status === "match" && shown.recommendation.status === "Awaiting Decision");
const confirmed = driver.confirm(shown.recommendation, locations);
check("Driver.confirm() creates the Ride", confirmed.ok === true && confirmed.ride.status === "Confirmed");
check("Passenger.viewStatus() now shows Confirmed", passenger.viewStatus()[0].status === "Confirmed");
check("Driver.viewRideHistory() lists the ride", driver.viewRideHistory(locations).length === 1);
check("Passenger.cancelRequest() cancels the Confirmed request and the ride", passenger.cancelRequest(sub1.request.requestId, locations).ok === true
  && storage.getList("rides")[0].status === "Cancelled");
check("Driver was notified of the cancellation", storage.getList("notifications").some(n => n.recipientId === driver.driverId && /cancelled/.test(n.message)));
check("Administrator.configureSettings() accepts valid and refuses invalid settings",
  admin.configureSettings({ maxDetourKm: 6, weights: [25, 25, 20, 30], farePerKm: 30, fuelPrice: 280, responseTimeoutMin: 3 }).ok === true
  && admin.configureSettings({ maxDetourKm: 6, weights: [25, 25, 20, 31], farePerKm: 30, fuelPrice: 280, responseTimeoutMin: 3 }).ok === false);
check("Administrator.viewAuditLog() is not empty and newest first", (() => { const log = admin.viewAuditLog(); return log.length > 5 && log[0].timestamp >= log[log.length - 1].timestamp; })());

// second driver / reject flow
const shown2 = (() => {
  const s = passenger.submitRequest({ pickup: "L01", dropOff: "L02", pickupTime: iso(nowMs + 90 * MIN), passengerCount: 1 }, locations);
  return decision.getOrCreateRecommendation(driver.driverId, nowMs, distances);
})();
check("Driver.reject() records the rejection and the request stays Pending", driver.reject(shown2.recommendation).ok === true
  && storage.getList("rideRequests").filter(r => r.status === "Pending").length === 1);

finish("class diagram mapping");
