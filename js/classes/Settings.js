// Settings.js - class Settings of the SRS Class Diagram (Figure 7), package "Administration".
// The values the Administrator controls (SRS FR-08, UC-12, CRC card Settings).
//
// UML attributes: maxDetourKm : float, weights : float[4], farePerKm : float, fuelPrice : float,
//                 responseTimeoutMin : int
// UML operations: validate() : boolean
// Associations: Administrator 1..* "configures" 1 Settings; RecommendationEngine "uses" Settings.
// weights = [route compatibility, minimum detour, fuel efficiency, driver profitability] (SRS FR-05).
// The rules (weights 10-40 each and total 100, the other values greater than 0) and the reading and saving of the
// stored values are in js/settings.js; this class uses them.
// Helpers that are NOT in the UML: current(), toRecord(), errors.

import { validateSettings, getCurrentSettings } from "../settings.js";

export class Settings {
  constructor({ maxDetourKm = 5, weights = [25, 25, 20, 30], farePerKm = 30, fuelPrice = 280, responseTimeoutMin = 2 } = {}) {
    this.maxDetourKm = maxDetourKm;
    this.weights = Array.isArray(weights) ? weights.slice() : weights;
    this.farePerKm = farePerKm;
    this.fuelPrice = fuelPrice;
    this.responseTimeoutMin = responseTimeoutMin;
    this.errors = [];
  }

  // SRS FR-08 / UC-12 step 4. Fills this.errors with the messages.
  validate() {
    this.errors = validateSettings(this.toRecord());
    return this.errors.length === 0;
  }

  // The settings now in force (stored values, or the demonstration defaults if the stored ones are broken).
  static current() {
    return new Settings(getCurrentSettings());
  }

  toRecord() {
    return {
      maxDetourKm: this.maxDetourKm, weights: Array.isArray(this.weights) ? this.weights.slice() : this.weights,
      farePerKm: this.farePerKm, fuelPrice: this.fuelPrice, responseTimeoutMin: this.responseTimeoutMin
    };
  }
}
