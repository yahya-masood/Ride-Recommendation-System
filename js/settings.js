// settings.js - Recommendation settings (SRS FR-08, UC-12).
// Gets, checks and saves the settings the Administrator controls:
//   maxDetourKm, weights[4] (route, detour, fuel efficiency, profitability), farePerKm, fuelPrice,
//   responseTimeoutMin.
// storage.js only checks the TYPES. The business rules below live here:
//   - maxDetourKm, farePerKm, fuelPrice, responseTimeoutMin: finite numbers greater than 0
//   - weights: exactly 4 numbers, each between 10 and 40, total exactly 100 (SRS FR-08)
// This file never writes an audit entry; the caller (admin.js) does that.
//
// updateSettings() always returns one of:
//   { ok: true,  settings: {...saved copy}, errors: [] }
//   { ok: false, reason: "invalid",      settings: null, errors: ["...", ...] }
//   { ok: false, reason: "write-failed", settings: null, errors: ["Settings could not be saved. Please try again."] }

import { getSettings, saveSettings } from "./storage.js";

// Copy of the demonstration defaults in storage.js (they are not exported there).
// tests/settings.test.mjs checks that both copies stay the same.
const DEFAULT_SETTINGS = {
  maxDetourKm: 5,
  weights: [25, 25, 20, 30],
  farePerKm: 30,
  fuelPrice: 280,
  responseTimeoutMin: 2
};

const WEIGHT_NAMES = ["route compatibility", "minimum detour", "fuel efficiency", "driver profitability"];
const POSITIVE_FIELDS = [
  ["maxDetourKm", "Maximum detour (km)"],
  ["farePerKm", "Fare per km"],
  ["fuelPrice", "Fuel price"],
  ["responseTimeoutMin", "Response timeout (minutes)"]
];

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function copySettings(settings) {
  return {
    maxDetourKm: settings.maxDetourKm,
    weights: settings.weights.slice(),
    farePerKm: settings.farePerKm,
    fuelPrice: settings.fuelPrice,
    responseTimeoutMin: settings.responseTimeoutMin
  };
}

// Returns a list of error messages. An empty list means the settings are valid. Never throws.
export function validateSettings(settings) {
  if (!isPlainObject(settings)) return ["Settings must be an object"];
  const errors = [];
  for (const [field, label] of POSITIVE_FIELDS) {
    const value = settings[field];
    if (!isNumber(value) || value <= 0) {
      errors.push(label + " must be a number greater than 0");
    }
  }
  const weights = settings.weights;
  if (!Array.isArray(weights) || weights.length !== 4 || !weights.every(isNumber)) {
    errors.push("Weights must be exactly 4 numbers");
  } else {
    weights.forEach((w, i) => {
      if (w < 10 || w > 40) {
        errors.push("Weight " + (i + 1) + " (" + WEIGHT_NAMES[i] + ") must be between 10 and 40 (found " + w + ")");
      }
    });
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total !== 100) errors.push("Weights must total 100 (found " + total + ")");
  }
  return errors;
}

// Current valid settings as a NEW object. If the stored settings break the rules (for example
// edited by hand in DevTools) the demonstration defaults are returned instead. Writes nothing.
export function getCurrentSettings() {
  const stored = getSettings();
  if (validateSettings(stored).length === 0) return copySettings(stored);
  console.error("settings: stored settings are invalid, using defaults");
  return copySettings(DEFAULT_SETTINGS);
}

// Validates and saves new settings. Only the five known settings are saved (extra properties are dropped).
export function updateSettings(newSettings) {
  const errors = validateSettings(newSettings);
  if (errors.length > 0) return { ok: false, reason: "invalid", settings: null, errors };
  const clean = copySettings(newSettings);
  if (!saveSettings(clean)) {
    return { ok: false, reason: "write-failed", settings: null, errors: ["Settings could not be saved. Please try again."] };
  }
  return { ok: true, settings: copySettings(clean), errors: [] };
}
