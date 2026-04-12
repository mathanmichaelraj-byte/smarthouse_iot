/**
 * init_mongodb.js
 * Run once to create indexes and seed initial device state.
 * Usage: node init_mongodb.js
 */

const mongoose = require("mongoose");
require("dotenv").config({ path: "./.env" });

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/smarthome";

const ReadingSchema = new mongoose.Schema({
  device:    String,
  temp:      Number,
  humidity:  Number,
  motion:    Boolean,
  light_on:  Boolean,
  fan_on:    Boolean,
  timestamp: { type: Date, default: Date.now },
});

const DeviceStateSchema = new mongoose.Schema({
  device:    { type: String, unique: true },
  light_on:  { type: Boolean, default: false },
  fan_on:    { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now },
});

async function init() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB:");

  const Reading     = mongoose.model("Reading", ReadingSchema);
  const DeviceState = mongoose.model("DeviceState", DeviceStateSchema);

  // Create indexes for fast time-series queries
  await Reading.collection.createIndex({ device: 1, timestamp: -1 });
  await Reading.collection.createIndex({ timestamp: -1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }); // 30-day TTL
  console.log("Indexes created on 'readings' collection.");

  // Seed initial device state for home1
  await DeviceState.findOneAndUpdate(
    { device: "home1" },
    { device: "home1", light_on: false, fan_on: false, updatedAt: new Date() },
    { upsert: true, new: true }
  );
  console.log("Seeded initial DeviceState for 'home1'.");

  await mongoose.disconnect();
  console.log("Done.");
}

init().catch(console.error);
