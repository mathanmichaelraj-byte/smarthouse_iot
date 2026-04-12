/**
 * rules.js – Simple rule engine.
 * Rules are stored as JSON: { name, condition (JS expr), action ("topic=VALUE") }
 * Condition variables: temp, humidity, motion, light_on, fan_on, hour
 */

// ─── DEFAULT RULES ───────────────────────────────────────
const DEFAULT_RULES = [
  {
    name:      "Evening motion → lights ON",
    condition: "hour >= 18 && motion === true && light_on === false",
    action:    "home1/light = ON",
  },
  {
    name:      "Late night → lights OFF",
    condition: "hour >= 23",
    action:    "home1/light = OFF",
  },
  {
    name:      "Hot temperature → fan ON",
    condition: "temp > 30 && fan_on === false",
    action:    "home1/fan = ON",
  },
  {
    name:      "Cool down → fan OFF",
    condition: "temp <= 26 && fan_on === true",
    action:    "home1/fan = OFF",
  },
  {
    name:      "No motion for morning → lights OFF",
    condition: "hour >= 9 && hour <= 17 && motion === false && light_on === true",
    action:    "home1/light = OFF",
  },
];

let rules = [...DEFAULT_RULES];

/**
 * Evaluate a rule condition against the current context.
 * @param {string} condition – JS boolean expression
 * @param {object} context   – { temp, humidity, motion, light_on, fan_on, hour }
 * @returns {boolean}
 */
function evaluateRules(condition, context) {
  try {
    // Build a safe function from known keys only
    const keys   = Object.keys(context);
    const values = Object.values(context);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, `"use strict"; return (${condition});`);
    return fn(...values);
  } catch (e) {
    console.error("[RULE] Eval error:", e.message, "| Condition:", condition);
    return false;
  }
}

/**
 * Add a new rule at runtime.
 * @param {{ name: string, condition: string, action: string }} rule
 */
function addRule(rule) {
  rules.push(rule);
}

/**
 * Remove a rule by name.
 * @param {string} name
 */
function removeRule(name) {
  rules = rules.filter((r) => r.name !== name);
}

/**
 * Return all active rules.
 * @returns {Array}
 */
function loadRules() {
  return rules;
}

module.exports = { evaluateRules, addRule, removeRule, loadRules };
