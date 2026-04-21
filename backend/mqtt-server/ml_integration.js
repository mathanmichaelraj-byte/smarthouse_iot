/**
 * Bridges Node.js to the Python ML scripts.
 */

const fs = require("fs");
const path = require("path");
const { PythonShell } = require("python-shell");

const ML_DIR = path.join(__dirname, "../python-ml");
const LOCAL_VENV_PYTHON = path.join(ML_DIR, "venv", "bin", "python");
const PYTHON_PATH = process.env.PYTHON_PATH || (fs.existsSync(LOCAL_VENV_PYTHON) ? LOCAL_VENV_PYTHON : "python3");
const RETRAIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RETRAIN_DEBOUNCE_MS = 5 * 60 * 1000;

let retrainTimer = null;

function runJsonScript(script, args) {
  return new Promise((resolve, reject) => {
    PythonShell.run(
      script,
      {
        mode: "json",
        pythonPath: PYTHON_PATH,
        scriptPath: ML_DIR,
        args,
      },
      (error, results) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(results?.[0] ?? null);
      }
    );
  });
}

function toFeatureArgs({ temp, humidity, motion, ldr }) {
  return [
    temp ?? 25,
    humidity ?? 50,
    motion ? 1 : 0,
    ldr ?? 500,
  ];
}

async function predictDeviceAction(data) {
  try {
    return await runJsonScript("predict.py", toFeatureArgs(data));
  } catch (error) {
    console.warn("[ML] Prediction unavailable:", error.message);
    return null;
  }
}

async function detectAnomaly(data) {
  try {
    const result = await runJsonScript("anomaly.py", toFeatureArgs(data));
    return result ?? { anomaly: false, score: 0 };
  } catch (error) {
    console.warn("[ML] Anomaly detection unavailable:", error.message);
    return { anomaly: false, score: 0 };
  }
}

async function retrainModels() {
  return new Promise((resolve, reject) => {
    PythonShell.run(
      "train.py",
      {
        pythonPath: PYTHON_PATH,
        scriptPath: ML_DIR,
      },
      (error) => {
        if (error) {
          console.error("[ML] Retrain failed:", error.message);
          reject(error);
          return;
        }
        console.log("[ML] Models retrained successfully.");
        resolve();
      }
    );
  });
}

function scheduleRetrain() {
  if (retrainTimer) clearTimeout(retrainTimer);
  retrainTimer = setTimeout(() => {
    retrainModels().catch(() => {});
    retrainTimer = null;
  }, RETRAIN_DEBOUNCE_MS);
}

setInterval(() => {
  retrainModels().catch(() => {});
}, RETRAIN_INTERVAL_MS);

module.exports = {
  detectAnomaly,
  predictDeviceAction,
  retrainModels,
  scheduleRetrain,
};
