/**
 * Initialize MongoDB indexes and seed the default device state.
 */

const mongoose = require("mongoose");

require("dotenv").config({ path: "./.env" });

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/smarthome";
const HOME_ID = "home1";

const ReadingSchema = new mongoose.Schema({
  device: { type: String, index: true },
  temp: Number,
  humidity: Number,
  pir1: Boolean,
  pir2: Boolean,
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

const DeviceStateSchema = new mongoose.Schema({
  device: { type: String, unique: true },
  light1: { type: Boolean, default: false },
  light2: { type: Boolean, default: false },
  fan1: { type: Boolean, default: false },
  fan2: { type: Boolean, default: false },
  temp: { type: Number, default: 0 },
  humidity: { type: Number, default: 0 },
  pir1: { type: Boolean, default: false },
  pir2: { type: Boolean, default: false },
  motion: { type: Boolean, default: false },
  ldr: { type: Number, default: 0 },
  ml_enabled: { type: Boolean, default: true },
  buzzer_muted: { type: Boolean, default: false },
  overrideUntil: {
    light1: { type: Date, default: null },
    light2: { type: Date, default: null },
    fan1: { type: Date, default: null },
    fan2: { type: Date, default: null },
  },
  updatedAt: { type: Date, default: Date.now },
});

const ManualActionSchema = new mongoose.Schema({
  device: { type: String, index: true },
  target: String,
  state: Boolean,
  temp: Number,
  humidity: Number,
  pir1: Boolean,
  pir2: Boolean,
  motion: Boolean,
  ldr: Number,
  hour: Number,
  timestamp: { type: Date, default: Date.now, index: true },
});

const AlertLogSchema = new mongoose.Schema({
  device: { type: String, index: true },
  message: String,
  reason: String,
  timestamp: { type: Date, default: Date.now, index: true },
});

async function init() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  const Reading = mongoose.model("Reading", ReadingSchema);
  const DeviceState = mongoose.model("DeviceState", DeviceStateSchema);
  const ManualAction = mongoose.model("ManualAction", ManualActionSchema);
  const AlertLog = mongoose.model("AlertLog", AlertLogSchema);

  await Reading.collection.createIndex({ device: 1, timestamp: -1 });
  await Reading.collection.createIndex(
    { timestamp: -1 },
    { expireAfterSeconds: 60 * 60 * 24 * 30 }
  );
  await ManualAction.collection.createIndex({ device: 1, timestamp: -1 });
  await AlertLog.collection.createIndex({ device: 1, timestamp: -1 });

  await DeviceState.findOneAndUpdate(
    { device: HOME_ID },
    {
      device: HOME_ID,
      light1: false,
      light2: false,
      fan1: false,
      fan2: false,
      temp: 0,
      humidity: 0,
      pir1: false,
      pir2: false,
      motion: false,
      ldr: 0,
      ml_enabled: true,
      buzzer_muted: false,
      overrideUntil: {
        light1: null,
        light2: null,
        fan1: null,
        fan2: null,
      },
      updatedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log("Indexes created and default home state seeded.");
  await mongoose.disconnect();
}

init().catch((error) => {
  console.error("Mongo init failed:", error.message);
  process.exit(1);
});
