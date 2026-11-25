// tests/settings.test.mjs - AUTOMATED NODE TESTS for js/settings.js. Run: node tests/settings.test.mjs
import { group, check, finish, resetStore, rawGet, rawSet, fake } from "./testKit.mjs";
const { getCurrentSettings, validateSettings, updateSettings } = await import("../js/settings.js");
const storage = await import("../js/storage.js");

const good = () => ({ maxDetourKm: 5, weights: [25, 25, 20, 30], farePerKm: 30, fuelPrice: 280, responseTimeoutMin: 2 });

group("1 defaults and reading");
resetStore();
check("defaults are valid", validateSettings(getCurrentSettings()).length === 0);
check("defaults equal storage.js defaults", JSON.stringify(getCurrentSettings()) === JSON.stringify(storage.getSettings()));
const a = getCurrentSettings(); a.weights[0] = 99;
check("returned object is a copy", getCurrentSettings().weights[0] === 25);
rawSet("rr_settings", JSON.stringify({ ...good(), weights: [41, 19, 20, 20] }));
check("valid shape but broken rule falls back to defaults", JSON.stringify(getCurrentSettings().weights) === "[25,25,20,30]");

group("2 validation rules");
check("good settings pass", validateSettings(good()).length === 0);
for (const bad of [null, undefined, [], "x", 5, new Map(), new Date()]) check("rejects non-object " + String(bad), validateSettings(bad).length > 0);
for (const field of ["maxDetourKm", "farePerKm", "fuelPrice", "responseTimeoutMin"]) {
  for (const value of [0, -1, NaN, Infinity, "5", null, true, [], {}, undefined]) {
    const s = good(); s[field] = value;
    check(field + " rejects " + String(value), validateSettings(s).length > 0);
  }
}
check("weights must be 4 numbers (3)", validateSettings({ ...good(), weights: [25, 25, 50] }).length > 0);
check("weights must be 4 numbers (5)", validateSettings({ ...good(), weights: [20, 20, 20, 20, 20] }).length > 0);
check("weights with text rejected", validateSettings({ ...good(), weights: [25, 25, 20, "30"] }).length > 0);
check("weight 9 rejected", validateSettings({ ...good(), weights: [9, 31, 30, 30] }).length > 0);
check("weight 41 rejected", validateSettings({ ...good(), weights: [41, 19, 20, 20] }).length > 0);
check("weight 10 accepted", validateSettings({ ...good(), weights: [10, 30, 30, 30] }).length === 0);
check("weight 40 accepted", validateSettings({ ...good(), weights: [40, 20, 20, 20] }).length === 0);
check("total 99 rejected", validateSettings({ ...good(), weights: [25, 25, 20, 29] }).length > 0);
check("total 101 rejected", validateSettings({ ...good(), weights: [25, 25, 20, 31] }).length > 0);
check("error names the weight", validateSettings({ ...good(), weights: [9, 31, 30, 30] }).some(e => /Weight 1 \(route compatibility\).*found 9/.test(e)));
check("validate does not change input", (() => { const s = good(); validateSettings(s); return JSON.stringify(s) === JSON.stringify(good()); })());

group("3 updateSettings");
resetStore();
const ok = updateSettings({ ...good(), maxDetourKm: 7, extra: "drop me" });
check("valid update ok", ok.ok === true && ok.errors.length === 0 && ok.reason === undefined);
check("saved and readable", getCurrentSettings().maxDetourKm === 7);
check("extra properties dropped", !("extra" in JSON.parse(rawGet("rr_settings"))));
const before = rawGet("rr_settings");
const bad = updateSettings({ ...good(), farePerKm: 0 });
check("invalid update refused", bad.ok === false && bad.reason === "invalid" && bad.settings === null && bad.errors.length > 0);
check("invalid update leaves storage unchanged", rawGet("rr_settings") === before);
fake.failWrites = true;
const failed = updateSettings({ ...good(), maxDetourKm: 9 });
check("write failure reported", failed.ok === false && failed.reason === "write-failed");
fake.failWrites = false;
check("write failure leaves storage unchanged", rawGet("rr_settings") === before);
const w = [25, 25, 20, 30]; const r = updateSettings({ ...good(), weights: w }); w[0] = 11;
check("saved weights list is not shared with the input", r.settings.weights[0] === 25 && getCurrentSettings().weights[0] === 25);

finish("js/settings.js");
