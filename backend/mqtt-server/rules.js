const FALLBACK_RULES = [
  {
    name: "Hot room with motion -> both fans ON",
    condition: "temp > 30 && motion === true",
    targets: ["fan1", "fan2"],
    state: true,
  },
  {
    name: "Dark room with motion -> both lights ON",
    condition: "ldr < 1000 && motion === true",
    targets: ["light1", "light2"],
    state: true,
  },
];

function isNightHour(hour) {
  return hour >= 18 || hour < 6;
}

function buildFallbackDecision({ temp, motion, ldr }) {
  const isNight = ldr < 1000; // low ldr = dark
  const fansOn = temp > 30 && motion === true;
  const lightsOn = isNight && motion === true;

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
  loadRules,
};
