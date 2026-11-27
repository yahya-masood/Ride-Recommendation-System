// tests/misc.test.mjs - AUTOMATED NODE TESTS for js/auditLog.js, js/notification.js, js/rideHistory.js, js/dateUtils.js.
// Run: node tests/misc.test.mjs
import { group, check, finish, resetStore, fake, locations, distances, NOW, HOUR, MIN, iso } from "./testKit.mjs";
const audit = await import("../js/auditLog.js");
const note = await import("../js/notification.js");
const hist = await import("../js/rideHistory.js");
const du = await import("../js/dateUtils.js");
const storage = await import("../js/storage.js");
const auth = await import("../js/auth.js");
const dec = await import("../js/decision.js");
const { createPlan } = await import("../js/routePlan.js");
const { submitRequest } = await import("../js/rideRequest.js");

group("1 audit log (FR-09)");
resetStore();
check("entry recorded", audit.recordAudit("USR-1", "Test action", "REF-1", NOW) === true);
audit.recordAudit("USR-2", "Later action", "REF-2", NOW + MIN);
const entries = audit.getAuditEntries();
check("entries have the four SRS fields plus id", entries.every(e => e.logId && e.timestamp && e.userId && e.action && "recordRef" in e));
check("newest first", entries[0].action === "Later action");
check("empty action refused", audit.recordAudit("USR-1", "  ", "R", NOW) === false);
check("missing user becomes 'system'", (audit.recordAudit(undefined, "Auto", "R", NOW), audit.getAuditEntries().some(e => e.userId === "system")));
entries[0].action = "tampered";
check("returned entries are copies (no edit through the read function)", audit.getAuditEntries()[0].action !== "tampered");
check("module exports no edit or delete function", Object.keys(audit).every(k => !/edit|delete|remove|update|clear/i.test(k)));
fake.failWrites = true;
check("save failure returns false without throwing", audit.recordAudit("U", "A", "R", NOW) === false);
fake.failWrites = false;

group("2 notifications (FR-07, UC-08)");
resetStore();
check("first name only", note.firstName("  Sara Noor Khan ") === "Sara" && note.firstName(null) === "" && note.firstName("") === "");
const n1 = note.notifyPassengerConfirmed("USR-p", "Ali Khan", "City Mall", "University Campus", NOW);
check("passenger message names places and the driver's first name only", n1 && /City Mall/.test(n1.message) && /Ali/.test(n1.message) && !/Khan/.test(n1.message));
note.notifyDriverCancelled("USR-d", "Sara Noor", "A", "B", NOW + MIN);
check("each user sees only own notifications", note.getNotificationsFor("USR-p").length === 1 && note.getNotificationsFor("USR-d").length === 1 && note.getNotificationsFor("x").length === 0);
check("empty message or recipient refused", note.createNotification("", "m", NOW) === null && note.createNotification("u", " ", NOW) === null);
fake.failWrites = true;
check("save failure gives null", note.createNotification("u", "m", NOW) === null);
fake.failWrites = false;

group("3 ride history (FR-10, UC-14)");
resetStore();
const d = (await auth.register({ name: "Ali Khan", role: "Driver", password: "secret1", fuelEfficiency: 12 })).user;
const p = (await auth.register({ name: "Sara Noor", role: "Passenger", password: "secret1" })).user;
createPlan(d.userId, { source: "L01", destination: "L02", windowStart: iso(NOW), windowEnd: iso(NOW + 4 * HOUR) }, locations, NOW);
check("no rides gives an empty list", hist.getRideHistory(d.userId, locations).length === 0);
submitRequest(p.userId, { pickup: "L03", dropOff: "L02", pickupTime: iso(NOW + HOUR), passengerCount: 1 }, locations, NOW);
const rec = dec.getOrCreateRecommendation(d.userId, NOW, distances);
dec.confirmRecommendation(rec.recommendation.recommendationId, d.userId, locations, NOW + MIN);
const h = hist.getRideHistory(d.userId, locations);
check("confirmed ride listed with places, detour, fuel cost and profit", h.length === 1 && h[0].pickupName === "City Mall" && h[0].dropOffName === "University Campus" && h[0].detourKm === 1.7 && h[0].fuelCost > 0 && h[0].profit > 0);
check("only the passenger's first name is shown", h[0].passengerFirstName === "Sara");
check("another driver sees nothing", hist.getRideHistory("USR-other", locations).length === 0);

group("4 date helpers");
check("toMs accepts Date, ISO, number", du.toMs(new Date(5)) === 5 && du.toMs("1970-01-01T00:00:00.005Z") === 5 && du.toMs(7) === 7);
check("toMs rejects junk", Number.isNaN(du.toMs("")) && Number.isNaN(du.toMs(null)) && Number.isNaN(du.toMs("abc")) && !du.isValidDate(undefined));
check("toIso round trip", du.toMs(du.toIso(NOW)) === NOW);

finish("audit log, notification, ride history, date helpers");
