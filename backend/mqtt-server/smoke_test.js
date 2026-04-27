require("dotenv").config();

const mqtt = require("mqtt");
const mongoose = require("mongoose");

const MQTT_BROKER = process.env.MQTT_BROKER || "mqtt://127.0.0.1:1883";
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/smarthome";
const API_BASE = process.env.API_BASE || "http://localhost:3001";
const HOME_ID = "home1";

const ReadingSchema = new mongoose.Schema(
  {
    device: String,
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
    timestamp: Date,
  },
  { versionKey: false, collection: "readings" }
);

const Reading = mongoose.models.Reading || mongoose.model("Reading", ReadingSchema);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function publishSamplePayload() {
  const client = mqtt.connect(MQTT_BROKER, {
    reconnectPeriod: 0,
    connectTimeout: 10000,
    keepalive: 30,
    protocolVersion: 4,
    clientId: `smoke-pub-${process.pid}-${Date.now()}`,
  });

  await new Promise((resolve, reject) => {
    client.once("connect", resolve);
    client.once("error", reject);
  });

  const timestamp = new Date().toISOString();
  const temp = Number((20 + ((Date.now() % 1000) / 100)).toFixed(2));

  const payload = {
    device: HOME_ID,
    temp,
    humidity: 61.2,
    pir1: true,
    motion: true,
    ldr: 800,
    sw_light1: false,
    sw_light2: false,
    sw_fan1: false,
    sw_fan2: false,
    relay_light1: false,
    relay_light2: false,
    relay_fan1: false,
    relay_fan2: false,
    ml_enabled: true,
    buzzer_muted: false,
    timestamp,
  };

  const message = JSON.stringify(payload);
  console.log(`[SMOKE] Publishing ${message.length} bytes to ${HOME_ID}/sensor`);

  await new Promise((resolve, reject) => {
    client.publish(`${HOME_ID}/sensor`, message, { qos: 1, retain: false }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  await delay(500);
  await new Promise((resolve) => {
    client.end(false, {}, resolve);
  });
  return payload;
}

async function ensureBackendRunning() {
  try {
    const response = await fetch(`${API_BASE}/api/devices`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    console.log(`[SMOKE] Backend is reachable at ${API_BASE}`);
  } catch (error) {
    throw new Error(
      `Backend is not reachable at ${API_BASE}. Start it first with 'npm start' in backend/mqtt-server.`
    );
  }
}

async function verifyMongoInsert() {
  await ensureBackendRunning();
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 15000 });

  const before = await Reading.countDocuments({ device: HOME_ID });
  console.log(`[SMOKE] Existing readings for ${HOME_ID}: ${before}`);

  const payload = await publishSamplePayload();
  const expectedTimestamp = new Date(payload.timestamp);

  console.log("[SMOKE] Waiting up to 10 seconds for backend ingestion...");

  let matchedReading = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    await delay(1000);
    matchedReading = await Reading.findOne({
      device: HOME_ID,
      temp: payload.temp,
      timestamp: expectedTimestamp,
    }).lean();

    if (matchedReading) {
      break;
    }
  }

  const latest = await Reading.findOne({ device: HOME_ID }).sort({ timestamp: -1 }).lean();
  const after = await Reading.countDocuments({ device: HOME_ID });

  console.log(`[SMOKE] Updated readings for ${HOME_ID}: ${after}`);

  if (!latest) {
    throw new Error("No reading found in MongoDB. Backend likely did not ingest the MQTT message.");
  }

  console.log("[SMOKE] Latest reading:");
  console.log(
    JSON.stringify(
      {
        device: latest.device,
        temp: latest.temp,
        humidity: latest.humidity,
        pir1: latest.pir1,
        motion: latest.motion,
        ldr: latest.ldr,
        timestamp: latest.timestamp,
      },
      null,
      2
    )
  );

  if (!matchedReading) {
    throw new Error(
      "Published test payload was not found in MongoDB. Check backend terminal for MQTT receipt logs."
    );
  }

  if (after <= before) {
    throw new Error("Test payload was found, but document count did not increase as expected.");
  }
}

verifyMongoInsert()
  .then(async () => {
    await mongoose.disconnect();
    console.log("[SMOKE] End-to-end smoke test passed.");
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[SMOKE] Failed:", error.message);
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(1);
  });
