/**
 * ml_integration.js
 * Bridges Node.js to Python ML models via child_process.
 * Falls back gracefully if Python/models are unavailable.
 */

const { PythonShell } = require("python-shell");
const path = require("path");

const ML_DIR = path.join(__dirname, "../python-ml");

// ─── PREDICT DEVICE ACTION ───────────────────────────────
/**
 * Call the Decision Tree model to predict whether light should be ON.
 * @param {{ temp, humidity, motion }} data
 * @returns {Promise<{ light_on: boolean } | null>}
 */
async function predictDeviceAction(data) {
  return new Promise((resolve) => {
    const options = {
      mode:        "json",
      pythonPath:  "python3",
      scriptPath:  ML_DIR,
      args: [
        data.temp     ?? 25,
        data.humidity ?? 50,
        data.motion   ? 1 : 0,
        new Date().getHours(),
      ],
    };

    PythonShell.run("predict.py", options, (err, results) => {
      if (err) {
        // Model not yet trained or python unavailable – skip
        resolve(null);
        return;
      }
      const result = results?.[0];
      resolve(result ?? null);
    });
  });
}

// ─── ANOMALY DETECTION ───────────────────────────────────
/**
 * Call the Isolation Forest model to flag anomalies.
 * @param {{ temp, humidity, motion }} data
 * @returns {Promise<boolean>}  true = anomaly detected
 */
async function detectAnomaly(data) {
  return new Promise((resolve) => {
    const options = {
      mode:        "json",
      pythonPath:  "python3",
      scriptPath:  ML_DIR,
      args: [
        data.temp     ?? 25,
        data.humidity ?? 50,
        data.motion   ? 1 : 0,
      ],
    };

    PythonShell.run("anomaly.py", options, (err, results) => {
      if (err) { resolve(false); return; }
      const anomaly = results?.[0]?.anomaly === true;
      resolve(anomaly);
    });
  });
}

// ─── RETRAIN (called periodically or on demand) ──────────
/**
 * Trigger model retraining from MongoDB export.
 * @returns {Promise<void>}
 */
async function retrainModels() {
  return new Promise((resolve, reject) => {
    PythonShell.run("train.py", { pythonPath: "python3", scriptPath: ML_DIR }, (err) => {
      if (err) { console.error("[ML] Retrain failed:", err.message); reject(err); return; }
      console.log("[ML] Models retrained successfully.");
      resolve();
    });
  });
}

// Retrain every 6 hours
setInterval(() => {
  retrainModels().catch(() => {});
}, 6 * 60 * 60 * 1000);

module.exports = { predictDeviceAction, detectAnomaly, retrainModels };
