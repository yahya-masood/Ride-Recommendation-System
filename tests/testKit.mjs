// tests/testKit.mjs - shared helpers for the Node tests of the logic modules (not a test itself).
// Provides a FAKE localStorage (a Map) that can be told to fail, Web Crypto for old Node versions,
// a tiny group/check helper and the summary. These are NOT browser tests.
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const store = new Map();
export const fake = { failWrites: false };
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      if (fake.failWrites) throw new Error("quota exceeded (fake)");
      store.set(key, String(value));
    },
    removeItem: key => { store.delete(key); }
  }
});
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
}

export const resetStore = () => { store.clear(); fake.failWrites = false; };
export const rawGet = key => (store.has(key) ? store.get(key) : null);
export const rawSet = (key, value) => { store.set(key, value); };

export const locations = JSON.parse(fs.readFileSync(path.join(root, "data/locations.json"), "utf8")).locations;
export const distances = JSON.parse(fs.readFileSync(path.join(root, "data/distances.json"), "utf8")).distances;

// Fixed "now" for all tests: 2026-11-23 08:00 UTC
export const NOW = Date.parse("2026-11-23T08:00:00.000Z");
export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const iso = ms => new Date(ms).toISOString();

const originalConsoleError = console.error;
console.error = () => {};              // modules log expected errors; keep the output clean
const groups = {};
let current = "";
export const group = name => { current = name; groups[name] = { pass: 0, fail: 0 }; };
export const check = (name, condition) => {
  if (condition) groups[current].pass++;
  else { groups[current].fail++; originalConsoleError("  FAIL [" + current + "] " + name); }
};
export const near = (a, b, tolerance = 0.051) => Math.abs(a - b) <= tolerance;

export function finish(title) {
  console.error = originalConsoleError;
  let totalPass = 0, totalFail = 0;
  for (const [name, g] of Object.entries(groups)) {
    console.log((g.fail === 0 ? "PASS " : "FAIL ") + name + ": " + g.pass + " passed, " + g.fail + " failed");
    totalPass += g.pass; totalFail += g.fail;
  }
  console.log("TOTAL (" + title + "): " + totalPass + " passed, " + totalFail + " failed");
  console.log("Browser tests: none have been run.");
  process.exit(totalFail === 0 ? 0 : 1);
}
