const FALLBACK_RULES = [
  {
    name: "Hot room with motion -> both fans ON",
    condition: "temp > 30 && motion === true",
    targets: ["fan1", "fan2"],
    state: true,
  },
  {
    name: "Night motion -> both lights ON",
    condition: "(hour >= 18 || hour < 6) && motion === true",
    targets: ["light1", "light2"],
    state: true,
  },
];

function isNightHour(hour) {
  return hour >= 18 || hour < 6;
}

function buildFallbackDecision({ temp, motion, hour }) {
  const fansOn = temp > 30 && motion === true;
  const lightsOn = isNightHour(hour) && motion === true;

  return {
    light1: lightsOn,
    light2: lightsOn,
    fan1: fansOn,
    fan2: fansOn,
  };
}

function loadRules() {
  return FALLBACK_RULES;
}

module.exports = {
  buildFallbackDecision,
  isNightHour,
  loadRules,
};
