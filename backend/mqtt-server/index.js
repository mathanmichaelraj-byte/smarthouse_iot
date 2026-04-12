require("dotenv").config();
const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const cors       = require("cors");
const mqtt       = require("mqtt");
const mongoose   = require("mongoose");
const { evaluateRules, loadRules } = require("./rules");
const { predictDeviceAction, detectAnomaly } = require("./ml_integration");

// ─── CONFIG ──────────────────────────────────────────────
const MQTT_BROKER  = process.env.MQTT_BROKER || "mqtt://broker.emqx.io";
const MONGO_URI    = process.env.MONGO_URI   || "mongodb://localhost:27017/smarthome";
const PORT         = process.env.PORT        || 3001;

// ─── MONGOOSE MODELS ─────────────────────────────────────
const ReadingSchema = new mongoose.Schema({
  device:    String,
  temp:      Number,
  humidity:  Number,
  motion:    Boolean,
  light_on:  Boolean,
  fan_on:    Boolean,
  timestamp: { type: Date, default: Date.now },
});
const Reading = mongoose.model("Reading", ReadingSchema);

const DeviceStateSchema = new mongoose.Schema({
  device:    { type: String, unique: true },
  light_on:  { type: Boolean, default: false },
  fan_on:    { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now },
});
const DeviceState = mongoose.model("DeviceState", DeviceStateSchema);

// ─── CONNECT DB ──────────────────────────────────────────
mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((e) => console.error("MongoDB error:", e.message));

// ─── EXPRESS + SOCKET.IO ─────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// ─── MQTT CLIENT ─────────────────────────────────────────
const mqttClient = mqtt.connect(MQTT_BROKER);

mqttClient.on("connect", () => {
  console.log("MQTT connected to", MQTT_BROKER);
  mqttClient.subscribe("home1/sensor");
  mqttClient.subscribe("home1/light/ack");
  mqttClient.subscribe("home1/fan/ack");
  mqttClient.subscribe("home1/all/ack");
});

mqttClient.on("error", (err) => console.error("MQTT error:", err.message));

mqttClient.on("message", async (topic, payload) => {
  const msg = payload.toString();
  console.log(`[MQTT] ${topic}: ${msg}`);

  // ── Sensor data ──
  if (topic.endsWith("/sensor")) {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    const device = data.device || "unknown";
    const reading = { ...data, timestamp: new Date() };

    // Save to DB
    try {
      await Reading.create(reading);
      await DeviceState.findOneAndUpdate(
        { device },
        { light_on: data.light_on, fan_on: data.fan_on, updatedAt: new Date() },
        { upsert: true }
      );
    } catch (e) { console.error("DB write error:", e.message); }

    // Push live data to dashboard via Socket.IO
    io.emit("sensor_update", reading);

    // ── Anomaly detection ──
    const anomaly = await detectAnomaly(data);
    if (anomaly) {
      console.warn("⚠️  Anomaly detected:", data);
      io.emit("anomaly", { device, data, ts: new Date() });
    }

    // ── AI prediction ──
    const prediction = await predictDeviceAction(data);
    if (prediction?.light_on !== undefined) {
      const cmd = prediction.light_on ? "ON" : "OFF";
      console.log(`[AI] Predicted light should be: ${cmd}`);
      mqttClient.publish(`${device}/light`, cmd);
    }

    // ── Rule engine ──
    const rules = loadRules();
    const context = {
      ...data,
      hour: new Date().getHours(),
      time: new Date().getHours(),
    };
    for (const rule of rules) {
      if (evaluateRules(rule.condition, context)) {
        console.log(`[RULE] Triggered: "${rule.name}" → ${rule.action}`);
        const [topicCmd, val] = rule.action.split("=");
        mqttClient.publish(topicCmd.trim(), val.trim());
        io.emit("rule_triggered", { rule: rule.name, action: rule.action });
      }
    }
  }

  // ── Ack messages → update state + push to UI ──
  if (topic.endsWith("/ack")) {
    const parts  = topic.split("/");      // ["home1","light","ack"]
    const device = parts[0];
    const type   = parts[1];             // "light" | "fan"
    const update = { updatedAt: new Date() };
    if (type === "light") update.light_on = (msg === "ON");
    if (type === "fan")   update.fan_on   = (msg === "ON");
    await DeviceState.findOneAndUpdate({ device }, update, { upsert: true });
    io.emit("device_state", { device, [type + "_on"]: msg === "ON" });
  }
});

// ─── REST API ────────────────────────────────────────────

/** GET /api/devices – all device states */
app.get("/api/devices", async (req, res) => {
  const devices = await DeviceState.find();
  res.json(devices);
});

/** GET /api/readings?device=home1&limit=100 – historical sensor data */
app.get("/api/readings", async (req, res) => {
  const { device = "home1", limit = 100 } = req.query;
  const readings = await Reading.find({ device })
    .sort({ timestamp: -1 })
    .limit(Number(limit));
  res.json(readings.reverse());
});

/** POST /api/control – manual device control
 *  Body: { device: "home1", type: "light", state: "ON" }
 */
app.post("/api/control", (req, res) => {
  const { device, type, state } = req.body;
  if (!device || !type || !state) return res.status(400).json({ error: "Missing fields" });
  const topic = `${device}/${type}`;
  mqttClient.publish(topic, state);
  console.log(`[API] Manual control → ${topic}: ${state}`);
  res.json({ ok: true, topic, state });
});

/** GET /api/rules – list active rules */
app.get("/api/rules", (req, res) => res.json(loadRules()));

// ─── SOCKET.IO ───────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("Dashboard connected:", socket.id);
  socket.on("control", ({ device, type, state }) => {
    mqttClient.publish(`${device}/${type}`, state);
  });
  socket.on("disconnect", () => console.log("Dashboard disconnected:", socket.id));
});

// ─── START SERVER ────────────────────────────────────────
server.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
