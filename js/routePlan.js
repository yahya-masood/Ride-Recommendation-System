// routePlan.js - Route Plan package (SRS FR-02, UC-02). Saves and loads RoutePlan objects (js/classes/RoutePlan.js).
// A Driver defines source, destination and a time window; can modify or end it before it expires.
// Stored record = RoutePlan attributes + driverId: { planId, driverId, source, destination, windowStart, windowEnd,
// status: "Active"|"Ended"|"Expired" }. source and destination are location ids from data/locations.json.

import { getList, saveList, newId } from "./storage.js";
import { recordAudit } from "./auditLog.js";
import { RoutePlan } from "./classes/RoutePlan.js";
import { toMs, toIso } from "./dateUtils.js";

// UC-02 step 4. Returns a list of error messages (empty = valid). ignorePlanId is used when modifying a plan.
export function validatePlan(input, locations, existingPlans, now = Date.now(), ignorePlanId = null) {
  const data = input && typeof input === "object" ? input : {};
  const plan = new RoutePlan({ ...data, planId: ignorePlanId });
  plan.validate(locations, existingPlans, now);
  return plan.errors;
}

// Marks Active plans whose end time has passed as Expired. Returns how many were changed.
export function expirePlans(now = Date.now()) {
  const plans = getList("routePlans");
  let changed = 0;
  const updated = plans.map(record => {
    const plan = RoutePlan.fromRecord(record);
    if (plan.expireIfDue(now)) changed++;
    return plan.toRecord();
  });
  if (changed > 0 && !saveList("routePlans", updated)) return 0;
  return changed;
}

// Creates a plan. Returns { ok: true, plan } or { ok: false, errors }.
export function createPlan(driverId, input, locations, now = Date.now()) {
  expirePlans(now);
  const plans = getList("routePlans");
  const plan = new RoutePlan({ ...input, driverId, planId: null, status: "Active" });
  if (!plan.validate(locations, plans, now)) return { ok: false, errors: plan.errors };
  plan.planId = newId("PLN");
  plan.windowStart = toIso(toMs(plan.windowStart));
  plan.windowEnd = toIso(toMs(plan.windowEnd));
  plans.push(plan.toRecord());
  if (!saveList("routePlans", plans)) return { ok: false, errors: ["The plan could not be saved. Please try again."] };
  recordAudit(driverId, "Route plan created", plan.planId, now);
  return { ok: true, plan: plan.toRecord() };
}

// FR-02: modify an Active plan before it expires (RoutePlan.modify). Returns { ok: true, plan } or { ok: false, errors }.
export function modifyPlan(planId, driverId, changes, locations, now = Date.now()) {
  expirePlans(now);
  const plans = getList("routePlans");
  const index = plans.findIndex(p => p.planId === planId && p.driverId === driverId);
  if (index < 0) return { ok: false, errors: ["Route plan not found"] };
  const plan = RoutePlan.fromRecord(plans[index]);
  if (!plan.modify(changes, locations, plans, now)) return { ok: false, errors: plan.errors };
  plans[index] = plan.toRecord();
  if (!saveList("routePlans", plans)) return { ok: false, errors: ["The plan could not be saved. Please try again."] };
  recordAudit(driverId, "Route plan modified", planId, now);
  return { ok: true, plan: plan.toRecord() };
}

// FR-02: end the window before it expires (RoutePlan.end). Monitoring stops.
export function endPlan(planId, driverId, now = Date.now()) {
  const plans = getList("routePlans");
  const index = plans.findIndex(p => p.planId === planId && p.driverId === driverId);
  if (index < 0) return { ok: false, errors: ["Route plan not found"] };
  const plan = RoutePlan.fromRecord(plans[index]);
  if (!plan.end()) return { ok: false, errors: plan.errors };
  plans[index] = plan.toRecord();
  if (!saveList("routePlans", plans)) return { ok: false, errors: ["The plan could not be saved. Please try again."] };
  recordAudit(driverId, "Route plan ended", planId, now);
  return { ok: true, plan: plan.toRecord() };
}

// RoutePlan.isActive on a stored record.
export function isPlanActive(plan, now = Date.now()) {
  return Boolean(plan) && RoutePlan.fromRecord(plan).isActive(now);
}

// The Driver's plan whose window is active right now, or null (FR-04: analyse only while active).
export function getActivePlan(driverId, now = Date.now()) {
  expirePlans(now);
  return getList("routePlans").find(p => p.driverId === driverId && isPlanActive(p, now)) || null;
}

// Plans of one Driver, newest window first. Includes Active, Ended and Expired.
export function getPlansFor(driverId, now = Date.now()) {
  expirePlans(now);
  return getList("routePlans")
    .filter(p => p.driverId === driverId)
    .sort((a, b) => toMs(b.windowStart) - toMs(a.windowStart));
}
