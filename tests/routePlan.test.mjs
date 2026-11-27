// tests/routePlan.test.mjs - AUTOMATED NODE TESTS for js/routePlan.js. Run: node tests/routePlan.test.mjs
import { group, check, finish, resetStore, fake, locations, NOW, HOUR, MIN, iso } from "./testKit.mjs";
const rp = await import("../js/routePlan.js");
const storage = await import("../js/storage.js");
const D1 = "USR-d1", D2 = "USR-d2";
const input = (over = {}) => ({ source: "L01", destination: "L02", windowStart: iso(NOW + HOUR), windowEnd: iso(NOW + 3 * HOUR), ...over });

group("1 validation (UC-02 step 4)");
resetStore();
check("valid plan has no errors", rp.validatePlan({ ...input(), driverId: D1 }, locations, [], NOW).length === 0);
check("unknown source rejected", rp.validatePlan(input({ source: "X" }), locations, [], NOW).length > 0);
check("unknown destination rejected", rp.validatePlan(input({ destination: "X" }), locations, [], NOW).length > 0);
check("source equals destination rejected", rp.validatePlan(input({ destination: "L01" }), locations, [], NOW).some(e => /different/.test(e)));
check("end equal to start rejected (boundary)", rp.validatePlan(input({ windowEnd: iso(NOW + HOUR) }), locations, [], NOW).some(e => /later/.test(e)));
check("end before start rejected", rp.validatePlan(input({ windowEnd: iso(NOW) }), locations, [], NOW).length > 0);
check("end 1 minute after start accepted (boundary)", rp.validatePlan(input({ windowEnd: iso(NOW + HOUR + MIN) }), locations, [], NOW).length === 0);
check("start in the past rejected", rp.validatePlan(input({ windowStart: iso(NOW - MIN - 1) }), locations, [], NOW).some(e => /past/.test(e)));
check("start up to 1 minute behind is accepted (minute precision of the input)", rp.validatePlan(input({ windowStart: iso(NOW - MIN) }), locations, [], NOW).length === 0);
check("start exactly now accepted (boundary)", rp.validatePlan(input({ windowStart: iso(NOW) }), locations, [], NOW).length === 0);
check("invalid dates rejected", rp.validatePlan(input({ windowStart: "soon", windowEnd: null }), locations, [], NOW).length >= 2);
check("null input rejected without throwing", rp.validatePlan(null, locations, [], NOW).length > 0);

group("2 create, overlap, audit");
resetStore();
const c1 = rp.createPlan(D1, input(), locations, NOW);
check("plan created Active", c1.ok && c1.plan.status === "Active" && c1.plan.driverId === D1);
check("plan saved", storage.getList("routePlans").length === 1);
check("audit entry written", storage.getList("auditLogs").some(e => e.action === "Route plan created" && e.recordRef === c1.plan.planId));
check("overlap with own window rejected", !rp.createPlan(D1, input({ windowStart: iso(NOW + 2 * HOUR), windowEnd: iso(NOW + 4 * HOUR) }), locations, NOW).ok);
check("window touching the end is not an overlap", rp.createPlan(D1, input({ windowStart: iso(NOW + 3 * HOUR), windowEnd: iso(NOW + 4 * HOUR) }), locations, NOW).ok);
check("other driver may use the same time", rp.createPlan(D2, input(), locations, NOW).ok);
fake.failWrites = true;
check("save failure reported", !rp.createPlan("USR-d3", input(), locations, NOW).ok);
fake.failWrites = false;

group("3 active window and expiry (FR-04)");
resetStore();
const p = rp.createPlan(D1, input(), locations, NOW).plan;
check("not active before start", rp.getActivePlan(D1, NOW) === null);
check("active at start (boundary)", rp.getActivePlan(D1, NOW + HOUR) !== null);
check("active just before end", rp.getActivePlan(D1, NOW + 3 * HOUR - 1) !== null);
check("not active at end (boundary)", rp.getActivePlan(D1, NOW + 3 * HOUR) === null);
check("plan is marked Expired after the end", rp.getPlansFor(D1, NOW + 4 * HOUR)[0].status === "Expired");
check("other driver has no active plan", rp.getActivePlan(D2, NOW + 2 * HOUR) === null);
check("isPlanActive handles null", rp.isPlanActive(null, NOW) === false);

group("4 modify and end (FR-02)");
resetStore();
const q = rp.createPlan(D1, input(), locations, NOW).plan;
const m = rp.modifyPlan(q.planId, D1, { windowEnd: iso(NOW + 5 * HOUR) }, locations, NOW);
check("modify end time", m.ok && m.plan.windowEnd === iso(NOW + 5 * HOUR));
check("modify keeps overlap check but ignores itself", m.ok);
check("modify with end before start rejected", !rp.modifyPlan(q.planId, D1, { windowEnd: iso(NOW) }, locations, NOW).ok);
check("other driver cannot modify", !rp.modifyPlan(q.planId, D2, { source: "L03" }, locations, NOW).ok);
const running = NOW + 2 * HOUR;
check("running window can be modified when start is unchanged", rp.modifyPlan(q.planId, D1, { windowEnd: iso(NOW + 6 * HOUR) }, locations, running).ok);
check("audit entry for modify", storage.getList("auditLogs").some(e => e.action === "Route plan modified"));
const e1 = rp.endPlan(q.planId, D1, running);
check("end plan", e1.ok && e1.plan.status === "Ended" && rp.getActivePlan(D1, running) === null);
check("ending twice refused", !rp.endPlan(q.planId, D1, running).ok);
check("modify after end refused", !rp.modifyPlan(q.planId, D1, { source: "L03" }, locations, running).ok);
check("other driver cannot end", !rp.endPlan(q.planId, D2, running).ok);
check("ended window frees the time for a new plan", rp.createPlan(D1, input({ windowStart: iso(running), windowEnd: iso(running + HOUR) }), locations, running).ok);

finish("js/routePlan.js");
