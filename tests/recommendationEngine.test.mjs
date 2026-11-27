// tests/recommendationEngine.test.mjs - AUTOMATED NODE TESTS for js/recommendationEngine.js.
// Run: node tests/recommendationEngine.test.mjs
// The expected numbers are the worked examples in docs/architecture-and-data-schema.md section 8.
import { group, check, finish, resetStore, locations, distances, NOW, HOUR, iso, near } from "./testKit.mjs";
const eng = await import("../js/recommendationEngine.js");
const storage = await import("../js/storage.js");
const { createPlan } = await import("../js/routePlan.js");
const { submitRequest } = await import("../js/rideRequest.js");
const auth = await import("../js/auth.js");

const settings = () => ({ maxDetourKm: 5, weights: [25, 25, 20, 30], farePerKm: 30, fuelPrice: 280, responseTimeoutMin: 2 });
const driver = { userId: "USR-d1", fuelEfficiency: 12 };
const plan = { planId: "PLN-1", driverId: "USR-d1", source: "L01", destination: "L02", windowStart: iso(NOW), windowEnd: iso(NOW + 4 * HOUR), status: "Active" };
const req = (id, pickup, dropOff, time = NOW + HOUR) => ({ requestId: id, passengerId: "P", pickup, dropOff, pickupTime: iso(time), passengerCount: 1, status: "Pending" });
const examples = () => [req("R-A", "L03", "L02"), req("R-B", "L04", "L06"), req("R-C", "L07", "L02"), req("R-X", "L05", "L02")];
const run = (over = {}) => eng.evaluateRequests({ plan, driver, requests: examples(), settings: settings(), distances, ...over });

group("1 worked examples (docs section 8)");
const r = run();
check("evaluation ok", r.ok);
check("three valid requests are ranked", r.ranked.length === 3);
check("order: City Mall, Market Square, Park View", r.ranked.map(c => c.request.requestId).join() === "R-A,R-B,R-C");
const A = r.ranked[0], B = r.ranked[1], C = r.ranked[2];
check("example 1 detour 1.7 km", near(A.detourKm, 1.7, 0.001));
check("example 1 fuel cost Rs 39.67", near(A.fuelCost, 39.67, 0.001));
check("example 1 profit Rs 221.33", near(A.profit, 221.33, 0.001));
check("example 1 scores 83.0 / 66.0 / 84.8 / 100.0", near(A.scores.route, 83, 0.05) && near(A.scores.detour, 66, 0.05) && near(A.scores.fuel, 84.8, 0.05) && near(A.scores.profit, 100, 0.05));
check("example 1 total 84.2", near(A.score, 84.2, 0.05));
check("example 2 total 71.1 and detour score 60.0", near(B.score, 71.1, 0.05) && near(B.scores.detour, 60, 0.05));
check("example 3 (Park View) detour 4.4, total 50.6", near(C.detourKm, 4.4, 0.001) && near(C.score, 50.6, 0.05));
check("Hospital Road request (detour 5.9 km, above 5) is removed before ranking", r.excluded.some(x => x.requestId === "R-X"));
check("excluded request is not ranked", !r.ranked.some(c => c.request.requestId === "R-X"));

group("2 filtering (FR-04)");
check("pickup before the window is excluded", run({ requests: [req("R1", "L03", "L02", NOW - 1)] }).ranked.length === 0);
check("pickup exactly at window start is kept (boundary)", run({ requests: [req("R1", "L03", "L02", NOW)] }).ranked.length === 1);
check("pickup exactly at window end is kept (boundary)", run({ requests: [req("R1", "L03", "L02", NOW + 4 * HOUR)] }).ranked.length === 1);
check("pickup after the window is excluded", run({ requests: [req("R1", "L03", "L02", NOW + 4 * HOUR + 1)] }).ranked.length === 0);
check("Confirmed, Cancelled and Expired requests are ignored", run({ requests: [{ ...req("R1", "L03", "L02"), status: "Confirmed" }, { ...req("R2", "L03", "L02"), status: "Cancelled" }, { ...req("R3", "L03", "L02"), status: "Expired" }] }).ranked.length === 0);
check("rejected request ids are excluded", run({ excludeRequestIds: ["R-A"] }).ranked.every(c => c.request.requestId !== "R-A"));
check("pickup farther from start than drop-off is not along the route", run({ requests: [req("R1", "L02", "L03")] }).excluded.some(x => /route/.test(x.reason)));
check("missing distance skips the request without a crash", (() => { const t = JSON.parse(JSON.stringify(distances)); delete t.L03.L02; const x = run({ distances: t }); return x.ok && x.skipped.some(s => s.requestId === "R-A"); })());
check("empty request list gives an empty ranking", run({ requests: [] }).ranked.length === 0);

group("3 safeguards and errors (docs section 8)");
check("invalid settings refuse to run", run({ settings: { ...settings(), maxDetourKm: 0 } }).ok === false);
check("invalid weights refuse to run", run({ settings: { ...settings(), weights: [40, 40, 10, 20] } }).ok === false);
check("fuel efficiency 0 blocks", run({ driver: { fuelEfficiency: 0 } }).ok === false);
check("missing driver blocks", run({ driver: null }).ok === false);
check("unknown driver route distance blocks", run({ plan: { ...plan, destination: "L99" } }).ok === false);
const loss = run({ requests: [req("R-L", "L03", "L07")] });
check("loss: City Mall to Park View has profit about -20.33", loss.ranked.length === 1 && near(loss.ranked[0].profit, -20.33, 0.01));
check("loss: profit score is 0, not negative", loss.ranked[0].scores.profit === 0);
check("loss request is still ranked (not excluded)", loss.ranked.length === 1);
check("fuel score never below 0", loss.ranked[0].scores.fuel >= 0);
check("all scores stay between 0 and 100", r.ranked.every(c => Object.values(c.scores).every(v => v >= 0 && v <= 100) && c.score >= 0 && c.score <= 100));
check("weights are not rescaled: changing a weight changes the total", run({ settings: { ...settings(), weights: [10, 10, 40, 40] } }).ranked[0].score !== A.score);
const tie = run({ requests: [req("R-late", "L03", "L02", NOW + 2 * HOUR), req("R-early", "L03", "L02", NOW + HOUR)] });
check("tie: earlier pickup time ranks first (A5)", tie.ranked[0].request.requestId === "R-early");
check("evaluation does not change its inputs", (() => { const reqs = examples(); const copy = JSON.stringify(reqs); run({ requests: reqs }); return JSON.stringify(reqs) === copy; })());

group("4 findRecommendations with storage (UC-06)");
resetStore();
await auth.register({ name: "Ali Khan", role: "Driver", password: "secret1", fuelEfficiency: 12 });
const drv = storage.getList("users")[0].userId;
check("no plan gives inactive", eng.findRecommendations(drv, NOW, distances).status === "inactive");
createPlan(drv, { source: "L01", destination: "L02", windowStart: iso(NOW), windowEnd: iso(NOW + 4 * HOUR) }, locations, NOW);
check("active plan and no requests gives no-match", eng.findRecommendations(drv, NOW, distances).status === "no-match");
for (const [p, q] of [["L03", "L02"], ["L04", "L06"], ["L07", "L02"], ["L05", "L02"]]) {
  submitRequest("USR-p-" + p + q, { pickup: p, dropOff: q, pickupTime: iso(NOW + HOUR), passengerCount: 1 }, locations, NOW);
}
const f = eng.findRecommendations(drv, NOW, distances);
check("match: top is City Mall to University Campus", f.status === "match" && f.top.request.pickup === "L03" && f.top.request.dropOff === "L02");
check("two alternatives (three valid requests in total)", f.alternatives.length === 2);
check("alternatives are limited to three", (() => { for (let i = 0; i < 5; i++) submitRequest("USR-x" + i, { pickup: "L03", dropOff: "L02", pickupTime: iso(NOW + HOUR + i * 60000), passengerCount: 1 }, locations, NOW); return eng.findRecommendations(drv, NOW, distances).alternatives.length === 3; })());
check("window ended gives inactive", eng.findRecommendations(drv, NOW + 5 * HOUR, distances).status === "inactive");
const rec = eng.createRecommendation("PLN-1", drv, f.top, settings(), NOW);
check("recommendation record fields", rec.status === "Awaiting Decision" && rec.requestId === f.top.request.requestId && rec.driverId === drv && rec.score === f.top.score && rec.routeScore === f.top.routeScore);
check("record has exactly the Class Diagram attributes plus planId, requestId, driverId", JSON.stringify(Object.keys(rec).sort()) === JSON.stringify(["detourKm","driverId","fuelCost","planId","profit","recommendationId","requestId","routeScore","score","shownAt","status"]));
check("recommendation holds no passenger data (NFR-04)", !/passenger|phone|name/i.test(Object.keys(rec).join(",")));
check("engine error can be logged", eng.logEngineError(drv, "PLN-1", "test", NOW) === true && storage.getList("auditLogs").some(e => /calculation error/.test(e.action)));

finish("js/recommendationEngine.js");
