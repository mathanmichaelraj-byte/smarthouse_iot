require("dotenv").config();

const Aedes = require("aedes");
const aedes = Aedes();
const cors = require("cors");
const express = require("express");
const fs = require("fs/promises");
const http = require("http");
const mqtt = require("mqtt");
const mongoose = require("mongoose");
const net = require("net");
const path = require("path");
const websocketStream = require("websocket-stream");

const { startMlServer, detectAnomaly, getMlStatus, predictDeviceAction, scheduleRetrain } = require("./ml_integration");
const { buildFallbackDecision, loadRules } = require("./rules");

const MQTT_BROKER = process.env.MQTT_BROKER || "mqtt://127.0.0.1:1883";
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/smarthome";
const PORT = Number(process.env.PORT || 3001);
const LOCAL_MQTT_HOST = process.env.LOCAL_MQTT_HOST || "0.0.0.0";
const LOCAL_MQTT_PORT = Number(process.env.LOCAL_MQTT_PORT || 1883);
const LOCAL_MQTT_WS_PORT = Number(process.env.LOCAL_MQTT_WS_PORT || 8000);
const ENABLE_EMBEDDED_BROKER = (process.env.ENABLE_EMBEDDED_BROKER || "true") !== "false";

const HOME_ID = "home1";
const CONTROL_TARGETS = ["light1", "light2", "fan1", "fan2"];
const MANUAL_TOPIC_SUFFIX = "_manual";
const OVERRIDE_MS = 5 * 60 * 1000;
const BUZZER_PULSE_MS = 10 * 1000;
const SENSOR_SNAPSHOT_MAX_AGE_MS = 30 * 1000;
const DATASET_FILE = path.join(__dirname, "../python-ml/train_data.json");

const ReadingSchema = new mongoose.Schema({
  device: { type: String, default: HOME_ID, index: true },
  temp: Number,
  humidity: Number,
  pir1: Boolean,
  motion: Boolean,
  ldr: Number,
  sw_light1: Boolean,
  sw_light2: Boolean,
  sw_fan1: Boolean,
  sw_fan2: Boolean,
  relay_light1: Boolean,
  relay_light2: Boolean,
  relay_fan1: Boolean,
  relay_fan2: Boolean,
  ml_enabled: Boolean,
  buzzer_muted: Boolean,
  timestamp: { type: Date, default: Date.now, index: true },
});

const OverrideSchema = new mongoose.Schema(
  {
    light1: { type: Date, default: null },
    light2: { type: Date, default: null },
    fan1: { type: Date, default: null },
    fan2: { type: Date, default: null },
  },
  { _id: false }
);

const DeviceStateSchema = new mongoose.Schema({
  device: { type: String, unique: true, default: HOME_ID },
  light1: { type: Boolean, default: false },
  light2: { type: Boolean, default: false },
  fan1: { type: Boolean, default: false },
  fan2: { type: Boolean, default: false },
  temp: { type: Number, default: 0 },
  humidity: { type: Number, default: 0 },
  pir1: { type: Boolean, default: false },
  motion: { type: Boolean, default: false },
  ldr: { type: Number, default: 0 },
  ml_enabled: { type: Boolean, default: true },
  buzzer_muted: { type: Boolean, default: false },
  overrideUntil: { type: OverrideSchema, default: () => ({}) },
  updatedAt: { type: Date, default: Date.now },
});

const ManualActionSchema = new mongoose.Schema({
  device: { type: String, default: HOME_ID, index: true },
  target: { type: String, enum: CONTROL_TARGETS, required: true },
  state: { type: Boolean, required: true },
  temp: Number,
  humidity: Number,
  pir1: Boolean,
  motion: Boolean,
  ldr: Number,
  hour: Number,
  timestamp: { type: Date, default: Date.now, index: true },
});

const AlertLogSchema = new mongoose.Schema({
  device: { type: String, default: HOME_ID, index: true },
  message: { type: String, required: true },
  reason: { type: String, required: true },
  timestamp: { type: Date, default: Date.now, index: true },
});

const Reading = mongoose.model("Reading", ReadingSchema);
const DeviceState = mongoose.model("DeviceState", DeviceStateSchema);
const ManualAction = mongoose.model("ManualAction", ManualActionSchema);
const AlertLog = mongoose.model("AlertLog", AlertLogSchema);

const app = express();
app.use(cors());
app.use(express.json());

let mqttClient = null;
let tcpBrokerServer = null;
let wsBrokerServer = null;

function createHealthSnapshot() {
  return {
    ok: Boolean(mqttClient?.connected) && mongoose.connection.readyState === 1,
    device: HOME_ID,
    broker: {
      embedded: ENABLE_EMBEDDED_BROKER,
      url: MQTT_BROKER,
      connected: Boolean(mqttClient?.connected),
      tcpPort: LOCAL_MQTT_PORT,
      wsPort: LOCAL_MQTT_WS_PORT,
    },
    mongodb: {
      connected: mongoose.connection.readyState === 1,
      readyState: mongoose.connection.readyState,
    },
    ml: getMlStatus(),
    latestSensorAt: latestSensorSnapshot?.receivedAt ?? null,
    updatedAt: homeState.updatedAt ?? null,
  };
}

function logSensorSummary(sensorSnapshot) {
  console.log(
    `[SENSOR] device=${sensorSnapshot.device} temp=${sensorSnapshot.temp} humidity=${sensorSnapshot.humidity} pir1=${sensorSnapshot.pir1} motion=${sensorSnapshot.motion} ldr=${sensorSnapshot.ldr}`
  );
}

function defaultOverrideUntil() {
  return {
    light1: null,
    light2: null,
    fan1: null,
    fan2: null,
  };
}

function createDefaultState() {
  return {
    device: HOME_ID,
    light1: false,
    light2: false,
    fan1: false,
    fan2: false,
    temp: 0,
    humidity: 0,
    pir1: false,
    motion: false,
    ldr: 0,
    ml_enabled: true,
    buzzer_muted: false,
    overrideUntil: defaultOverrideUntil(),
    updatedAt: new Date(),
  };
}

let homeState = createDefaultState();
let latestSensorSnapshot = null;
let datasetWriteQueue = Promise.resolve();
let buzzerTimeout = null;

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    if (["1", "TRUE", "YES", "ON"].includes(normalized)) return true;
    if (["0", "FALSE", "NO", "OFF"].includes(normalized)) return false;
  }
  return null;
}

function topicStateToBoolean(payload) {
  const normalized = payload.trim().toUpperCase();
  if (normalized === "ON") return true;
  if (normalized === "OFF") return false;
  return null;
}

function parseTimestamp(value) {
  if (!value && value !== 0) return new Date();
  if (typeof value === "number") {
    return new Date(value > 1e12 ? value : value * 1000);
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && value.trim() !== "") {
      return new Date(numeric > 1e12 ? numeric : numeric * 1000);
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function buildOverrideUntil(source = {}) {
  return CONTROL_TARGETS.reduce((accumulator, target) => {
    const value = source[target];
    accumulator[target] = value ? new Date(value) : null;
    return accumulator;
  }, {});
}

function normalizeSensorPayload(message) {
  let parsed;
  try {
    parsed = JSON.parse(message);
  } catch {
    console.warn("[SENSOR] Invalid JSON payload:", message.slice(0, 200));
    return null;
  }

  const temp = Number(parsed.temp);
  const humidity = Number(parsed.humidity);
  const pir1 = normalizeBoolean(parsed.pir1);
  const motion = normalizeBoolean(parsed.motion) ?? pir1;
  const ldr = Number(parsed.ldr);

  if (Number.isNaN(temp) || Number.isNaN(humidity) || pir1 === null || motion === null || Number.isNaN(ldr)) {
    console.warn("[SENSOR] Rejected payload due to invalid fields:", {
      temp: parsed.temp,
      humidity: parsed.humidity,
      pir1: parsed.pir1,
      motion: parsed.motion,
      ldr: parsed.ldr,
    });
    return null;
  }

  const receivedAt = new Date();
  const timestamp = parseTimestamp(parsed.timestamp);

  return {
    device: parsed.device || HOME_ID,
    temp,
    humidity,
    pir1,
    motion,
    ldr,
    sw_light1: normalizeBoolean(parsed.sw_light1),
    sw_light2: normalizeBoolean(parsed.sw_light2),
    sw_fan1: normalizeBoolean(parsed.sw_fan1),
    sw_fan2: normalizeBoolean(parsed.sw_fan2),
    relay_light1: normalizeBoolean(parsed.relay_light1) ?? homeState.light1,
    relay_light2: normalizeBoolean(parsed.relay_light2) ?? homeState.light2,
    relay_fan1: normalizeBoolean(parsed.relay_fan1) ?? homeState.fan1,
    relay_fan2: normalizeBoolean(parsed.relay_fan2) ?? homeState.fan2,
    ml_enabled: normalizeBoolean(parsed.ml_enabled) ?? true,
    buzzer_muted: normalizeBoolean(parsed.buzzer_muted) ?? false,
    timestamp,
    receivedAt,
    hour: receivedAt.getHours(),
  };
}

function isRecentSensorSnapshot(snapshot) {
  if (!snapshot?.receivedAt) return false;
  return Date.now() - snapshot.receivedAt.getTime() <= SENSOR_SNAPSHOT_MAX_AGE_MS;
}

function buildDatasetRow(snapshot, stateLike) {
  return {
    temp: snapshot.temp,
    humidity: snapshot.humidity,
    pir1: snapshot.pir1 ? 1 : 0,
    motion: snapshot.motion ? 1 : 0,
    ldr: snapshot.ldr,
    hour: snapshot.hour,
    light1: stateLike.light1 ? 1 : 0,
    light2: stateLike.light2 ? 1 : 0,
    fan1: stateLike.fan1 ? 1 : 0,
    fan2: stateLike.fan2 ? 1 : 0,
  };
}

async function appendDatasetRow(row) {
  await fs.mkdir(path.dirname(DATASET_FILE), { recursive: true });

  let records = [];
  try {
    const existing = await fs.readFile(DATASET_FILE, "utf8");
    const parsed = JSON.parse(existing);
    if (Array.isArray(parsed)) records = parsed;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  records.push(row);
  await fs.writeFile(DATASET_FILE, JSON.stringify(records, null, 2));
}

function queueDatasetRow(row) {
  datasetWriteQueue = datasetWriteQueue
    .then(async () => {
      await appendDatasetRow(row);
      scheduleRetrain();
    })
    .catch((error) => {
      console.error("[DATASET] Failed to append training row:", error.message);
    });

  return datasetWriteQueue;
}

function hasActiveOverride(target, now = new Date()) {
  const until = homeState.overrideUntil?.[target];
  return Boolean(until && new Date(until).getTime() > now.getTime());
}

function hasAnyActiveOverride(now = new Date()) {
  return CONTROL_TARGETS.some((target) => hasActiveOverride(target, now));
}

function manualTopicFor(target) {
  return `${HOME_ID}/${target}${MANUAL_TOPIC_SUFFIX}`;
}

function controlTopicFor(target) {
  return `${HOME_ID}/${target}`;
}

function controlTargetFromTopic(topic) {
  return topic.split("/")[1];
}

function manualTargetFromTopic(topic) {
  return controlTargetFromTopic(topic).replace(MANUAL_TOPIC_SUFFIX, "");
}

function stateDocument() {
  return {
    device: HOME_ID,
    light1: homeState.light1,
    light2: homeState.light2,
    fan1: homeState.fan1,
    fan2: homeState.fan2,
    temp: homeState.temp,
    humidity: homeState.humidity,
    pir1: homeState.pir1,
    motion: homeState.motion,
    ldr: homeState.ldr,
    ml_enabled: homeState.ml_enabled,
    buzzer_muted: homeState.buzzer_muted,
    overrideUntil: buildOverrideUntil(homeState.overrideUntil),
    updatedAt: homeState.updatedAt || new Date(),
  };
}

async function persistHomeState() {
  await DeviceState.findOneAndUpdate({ device: HOME_ID }, stateDocument(), {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
}

async function hydrateHomeState() {
  const existing = await DeviceState.findOne({ device: HOME_ID }).lean();
  if (!existing) {
    homeState = createDefaultState();
    await persistHomeState();
    return;
  }

  homeState = {
    device: existing.device || HOME_ID,
    light1: Boolean(existing.light1),
    light2: Boolean(existing.light2),
    fan1: Boolean(existing.fan1),
    fan2: Boolean(existing.fan2),
    temp: Number(existing.temp ?? 0),
    humidity: Number(existing.humidity ?? 0),
    pir1: Boolean(existing.pir1),
    motion: Boolean(existing.motion),
    ldr: Number(existing.ldr ?? 0),
    ml_enabled: Boolean(existing.ml_enabled ?? true),
    buzzer_muted: Boolean(existing.buzzer_muted ?? false),
    overrideUntil: buildOverrideUntil(existing.overrideUntil),
    updatedAt: existing.updatedAt ? new Date(existing.updatedAt) : new Date(),
  };
}

async function applyDecision(decision, source) {
  const now = new Date();
  const changedTargets = [];

  CONTROL_TARGETS.forEach((target) => {
    if (hasActiveOverride(target, now)) return;

    const desired = Boolean(decision[target]);
    if (homeState[target] !== desired) {
      homeState[target] = desired;
      changedTargets.push(target);
    }
  });

  if (!changedTargets.length) return;

  homeState.updatedAt = now;
  await persistHomeState();
  changedTargets.forEach((target) => {
    mqttClient.publish(controlTopicFor(target), homeState[target] ? "ON" : "OFF", { retain: true });
  });

  console.log(`[AUTO:${source}] Updated ${changedTargets.join(", ")}`);
}

async function logAlert(message, reason, options = {}) {
  const timestamp = new Date();

  await AlertLog.create({
    device: HOME_ID,
    message,
    reason,
    timestamp,
  });

  mqttClient.publish(`${HOME_ID}/alert`, message);
  console.warn(`[ALERT:${reason}] ${message}`);

  if (options.buzzer) {
    mqttClient.publish(`${HOME_ID}/buzzer`, "ON");
    if (buzzerTimeout) clearTimeout(buzzerTimeout);
    buzzerTimeout = setTimeout(() => {
      mqttClient.publish(`${HOME_ID}/buzzer`, "OFF");
      buzzerTimeout = null;
    }, BUZZER_PULSE_MS);
  }
}

async function handleManualTopic(target, payload) {
  const nextState = topicStateToBoolean(payload);
  if (nextState === null) return;

  const now = new Date();
  homeState[target] = nextState;
  homeState.overrideUntil[target] = new Date(now.getTime() + OVERRIDE_MS);
  homeState.updatedAt = now;
  await persistHomeState();

  const sensorSnapshot = isRecentSensorSnapshot(latestSensorSnapshot) ? latestSensorSnapshot : null;
  await ManualAction.create({
    device: HOME_ID,
    target,
    state: nextState,
    temp: sensorSnapshot?.temp,
    humidity: sensorSnapshot?.humidity,
    pir1: sensorSnapshot?.pir1,
    motion: sensorSnapshot?.motion,
    ldr: sensorSnapshot?.ldr,
    hour: sensorSnapshot?.hour,
    timestamp: now,
  });

  if (sensorSnapshot) {
    queueDatasetRow(buildDatasetRow(sensorSnapshot, homeState));
  }

  mqttClient.publish(controlTopicFor(target), nextState ? "ON" : "OFF", { retain: true });
  console.log(`[MANUAL] ${target} -> ${nextState ? "ON" : "OFF"}`);
}

async function maybeAppendOverrideTrainingRow(sensorSnapshot) {
  if (!hasAnyActiveOverride(sensorSnapshot.receivedAt)) return;
  queueDatasetRow(
    buildDatasetRow(sensorSnapshot, {
      light1: sensorSnapshot.relay_light1,
      light2: sensorSnapshot.relay_light2,
      fan1: sensorSnapshot.relay_fan1,
      fan2: sensorSnapshot.relay_fan2,
    })
  );
}

function normalizePrediction(prediction) {
  if (!prediction || typeof prediction !== "object") return null;

  const confidence = Number(prediction.confidence);
  if (Number.isNaN(confidence)) return null;

  const decision = { confidence };
  for (const target of CONTROL_TARGETS) {
    const value = normalizeBoolean(prediction[target]);
    if (value === null) return null;
    decision[target] = value;
  }

  return decision;
}

function anomalyMessage(snapshot, anomalyResult) {
  return `Anomaly detected: temp=${snapshot.temp}C humidity=${snapshot.humidity}% pir1=${snapshot.pir1} motion=${snapshot.motion} ldr=${snapshot.ldr} score=${anomalyResult.score}`;
}

async function handleSensorMessage(payload) {
  const sensorSnapshot = normalizeSensorPayload(payload);
  if (!sensorSnapshot) return;
  logSensorSummary(sensorSnapshot);

  latestSensorSnapshot = sensorSnapshot;
  homeState.temp = sensorSnapshot.temp;
  homeState.humidity = sensorSnapshot.humidity;
  homeState.pir1 = sensorSnapshot.pir1;
  homeState.motion = sensorSnapshot.motion;
  homeState.ldr = sensorSnapshot.ldr;
  homeState.updatedAt = sensorSnapshot.receivedAt;

  await Promise.all([
    Reading.create({
      device: sensorSnapshot.device,
      temp: sensorSnapshot.temp,
      humidity: sensorSnapshot.humidity,
      pir1: sensorSnapshot.pir1,
      motion: sensorSnapshot.motion,
      ldr: sensorSnapshot.ldr,
      sw_light1: sensorSnapshot.sw_light1,
      sw_light2: sensorSnapshot.sw_light2,
      sw_fan1: sensorSnapshot.sw_fan1,
      sw_fan2: sensorSnapshot.sw_fan2,
      relay_light1: sensorSnapshot.relay_light1,
      relay_light2: sensorSnapshot.relay_light2,
      relay_fan1: sensorSnapshot.relay_fan1,
      relay_fan2: sensorSnapshot.relay_fan2,
      ml_enabled: homeState.ml_enabled,
      buzzer_muted: homeState.buzzer_muted,
      timestamp: sensorSnapshot.timestamp,
    }),
    persistHomeState(),
  ]);

  console.log("[SENSOR] Reading stored in MongoDB");

  await maybeAppendOverrideTrainingRow(sensorSnapshot);

  // Security alert: dark (ldr < 1000) + motion + lights off
  const lightsOff = !homeState.light1 && !homeState.light2;
  if (sensorSnapshot.ldr < 1000 && sensorSnapshot.motion && lightsOff) {
    await logAlert(
      `Motion in the dark! ldr=${sensorSnapshot.ldr} temp=${sensorSnapshot.temp}C`,
      "security",
      { buzzer: !homeState.buzzer_muted }
    );
  }

  const [predictionResult, anomalyResult] = await Promise.all([
    predictDeviceAction(sensorSnapshot),
    detectAnomaly(sensorSnapshot),
  ]);

  if (anomalyResult?.anomaly) {
    await logAlert(anomalyMessage(sensorSnapshot, anomalyResult), "ml_anomaly");
  }

  if (!homeState.ml_enabled) {
    console.log("[AUTO] Manual mode active, skipping automation.");
    return;
  }

  const normalizedPrediction = normalizePrediction(predictionResult);
  const useMlDecision = normalizedPrediction && normalizedPrediction.confidence > 0.7;
  const decision = useMlDecision ? normalizedPrediction : buildFallbackDecision(sensorSnapshot);

  await applyDecision(decision, useMlDecision ? "ml" : "fallback");
}

async function handleControlTopic(target, payload) {
  const nextState = topicStateToBoolean(payload);
  if (nextState === null) return;
  if (homeState[target] === nextState) return;

  homeState[target] = nextState;
  homeState.updatedAt = new Date();
  await persistHomeState();
}

function attachMqttHandlers() {
  mqttClient.on("connect", () => {
    console.log("MQTT connected to", MQTT_BROKER);

    mqttClient.subscribe(`${HOME_ID}/sensor`, { qos: 0 }, (error) => {
      if (error) {
        console.error("[MQTT] Failed subscribing to sensor topic:", error.message);
        return;
      }
      console.log(`[MQTT] Subscribed ${HOME_ID}/sensor`);
    });
    CONTROL_TARGETS.forEach((target) => {
      mqttClient.subscribe(controlTopicFor(target), { qos: 0 }, (error) => {
        if (error) {
          console.error(`[MQTT] Failed subscribing ${controlTopicFor(target)}:`, error.message);
        }
      });
      mqttClient.subscribe(manualTopicFor(target), { qos: 0 }, (error) => {
        if (error) {
          console.error(`[MQTT] Failed subscribing ${manualTopicFor(target)}:`, error.message);
        }
      });
    });
    mqttClient.subscribe(`${HOME_ID}/ml_mode`, { qos: 0 });
    mqttClient.subscribe(`${HOME_ID}/buzzer_mute`, { qos: 0 });

    CONTROL_TARGETS.forEach((target) => {
      mqttClient.publish(manualTopicFor(target), "", { retain: true });
      mqttClient.publish(controlTopicFor(target), homeState[target] ? "ON" : "OFF", { retain: true });
    });
    mqttClient.publish(controlTopicFor("ml_mode"), homeState.ml_enabled ? "ON" : "OFF", { retain: true });
    mqttClient.publish(controlTopicFor("buzzer_mute"), homeState.buzzer_muted ? "ON" : "OFF", { retain: true });
  });

  mqttClient.on("error", (error) => {
    console.error("MQTT error:", error.message);
  });

  mqttClient.on("offline", () => {
    console.log("MQTT offline, attempting reconnect...");
  });

  mqttClient.on("reconnect", () => {
    console.log("MQTT reconnecting...");
  });

  mqttClient.on("message", async (topic, payloadBuffer) => {
    const payload = payloadBuffer.toString();

    try {
      if (topic === `${HOME_ID}/sensor`) {
        await handleSensorMessage(payload);
        return;
      }

      if (topic === `${HOME_ID}/ml_mode`) {
        const nextState = topicStateToBoolean(payload);
        if (nextState === null) return;
        if (homeState.ml_enabled === nextState) return;

        homeState.ml_enabled = nextState;
        homeState.updatedAt = new Date();
        await persistHomeState();
        console.log(`[SYSTEM] ML mode -> ${homeState.ml_enabled ? "ON" : "OFF"}`);
        return;
      }

      if (topic === `${HOME_ID}/buzzer_mute`) {
        const nextState = topicStateToBoolean(payload);
        if (nextState === null) return;
        if (homeState.buzzer_muted === nextState) return;

        homeState.buzzer_muted = nextState;
        homeState.updatedAt = new Date();
        await persistHomeState();
        console.log(`[SYSTEM] Buzzer mute -> ${homeState.buzzer_muted ? "ON" : "OFF"}`);
        return;
      }

      if (topic.endsWith(MANUAL_TOPIC_SUFFIX)) {
        await handleManualTopic(manualTargetFromTopic(topic), payload);
        return;
      }

      if (CONTROL_TARGETS.includes(controlTargetFromTopic(topic))) {
        await handleControlTopic(controlTargetFromTopic(topic), payload);
      }
    } catch (error) {
      console.error(`[MQTT] Failed handling ${topic}:`, error.message);
    }
  });
}

app.get("/api/devices", async (req, res) => {
  try {
    const devices = await DeviceState.find().sort({ device: 1 }).lean();
    res.json(devices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/readings", async (req, res) => {
  try {
    const { device = HOME_ID, limit = 100 } = req.query;
    const readings = await Reading.find({ device })
      .sort({ timestamp: -1 })
      .limit(Number(limit))
      .lean();
    res.json(readings.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/control", async (req, res) => {
  try {
    const { device = HOME_ID, target, state } = req.body;

    if (device !== HOME_ID || !CONTROL_TARGETS.includes(target)) {
      res.status(400).json({ error: "Invalid device or target" });
      return;
    }

    const nextState = topicStateToBoolean(String(state || ""));
    if (nextState === null) {
      res.status(400).json({ error: "State must be ON or OFF" });
      return;
    }

    const topic = manualTopicFor(target);
    mqttClient.publish(topic, nextState ? "ON" : "OFF");
    res.json({ ok: true, topic, state: nextState ? "ON" : "OFF" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/alerts", async (req, res) => {
  try {
    const { device = HOME_ID, limit = 50 } = req.query;
    const alerts = await AlertLog.find({ device })
      .sort({ timestamp: -1 })
      .limit(Number(limit))
      .lean();
    res.json(alerts.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/rules", (req, res) => {
  res.json(loadRules());
});

app.get("/api/health", (req, res) => {
  const snapshot = createHealthSnapshot();
  res.status(snapshot.ok ? 200 : 503).json(snapshot);
});

async function waitForBrokerReady(port, retries = 20, intervalMs = 250) {
  for (let i = 0; i < retries; i++) {
    const ok = await new Promise((resolve) => {
      const socket = net.createConnection({ port, host: "127.0.0.1" });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
    });
    if (ok) {
      console.log("[BROKER] TCP port ready");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  console.warn("[BROKER] TCP port did not become ready in time, proceeding anyway");
}

async function startEmbeddedBroker() {
  async function isPortAvailable(port, host) {
    return new Promise((resolve) => {
      const tester = net.createServer()
        .once("error", () => {
          try {
            tester.close();
          } catch {}
          resolve(false);
        })
        .once("listening", () => {
          tester.close(() => resolve(true));
        })
        .listen(port, host);
    });
  }

  return new Promise((resolve, reject) => {
    let listeningCount = 0;
    let settled = false;

    function completeListen() {
      listeningCount += 1;
      if (!settled && listeningCount === 2) {
        settled = true;
        console.log(
          `[BROKER] Embedded broker ready on tcp://${LOCAL_MQTT_HOST}:${LOCAL_MQTT_PORT} and ws://${LOCAL_MQTT_HOST}:${LOCAL_MQTT_WS_PORT}/mqtt`
        );
        resolve();
      }
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    aedes.on("client", (client) => {
      console.log(`[BROKER] Client connected: ${client?.id || "unknown"}`);
    });

    aedes.on("clientDisconnect", (client) => {
      console.log(`[BROKER] Client disconnected: ${client?.id || "unknown"}`);
    });

    aedes.on("publish", (packet, client) => {
      if (!client || !packet?.topic || packet.topic.startsWith("$SYS")) return;
      console.log(`[BROKER] ${client.id} -> ${packet.topic}`);
    });

    (async () => {
      try {
        const tcpFree = await isPortAvailable(LOCAL_MQTT_PORT, LOCAL_MQTT_HOST);
        if (!tcpFree) {
          console.warn(`[BROKER] TCP port ${LOCAL_MQTT_PORT} in use, continuing without embedded TCP broker`);
          completeListen();
        } else {
          tcpBrokerServer = net.createServer(aedes.handle);
          tcpBrokerServer.once("error", fail);
          tcpBrokerServer.listen(LOCAL_MQTT_PORT, LOCAL_MQTT_HOST, completeListen);
        }

        const wsFree = await isPortAvailable(LOCAL_MQTT_WS_PORT, LOCAL_MQTT_HOST);
        if (!wsFree) {
          console.warn(`[BROKER] WS port ${LOCAL_MQTT_WS_PORT} in use, starting without websocket support`);
          completeListen();
        } else {
          wsBrokerServer = http.createServer();
          websocketStream.createServer({ server: wsBrokerServer, path: "/mqtt" }, aedes.handle);
          wsBrokerServer.once("error", fail);
          wsBrokerServer.listen(LOCAL_MQTT_WS_PORT, LOCAL_MQTT_HOST, completeListen);
        }
      } catch (err) {
        fail(err);
      }
    })();
  });
}

async function start() {
  if (ENABLE_EMBEDDED_BROKER) {
    await startEmbeddedBroker();
  }

  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log("MongoDB connected");

  await hydrateHomeState();
  await startMlServer();

  if (ENABLE_EMBEDDED_BROKER) {
    await waitForBrokerReady(LOCAL_MQTT_PORT);
  }

  mqttClient = mqtt.connect(MQTT_BROKER, {
    manualConnect: true,
    reconnectPeriod: 3000,
    connectTimeout: 30000,
    keepalive: 30,
    clean: true,
    protocolVersion: 4,
    clientId: `backend-${HOME_ID}-${process.pid}`,
  });
  attachMqttHandlers();
  mqttClient.connect();

  const httpServer = app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
  });

  httpServer.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} already in use. Exiting.`);
      process.exit(1);
    }
    console.error("HTTP server error:", err.message);
    process.exit(1);
  });
}

start().catch((error) => {
  console.error("Startup failed:", error.message);
  process.exit(1);
});
