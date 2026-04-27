const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { PythonShell } = require("python-shell");

const ML_DIR = path.join(__dirname, "../python-ml");
const LOCAL_VENV_PYTHON_WINDOWS = path.join(ML_DIR, "venv", "Scripts", "python.exe");
const LOCAL_VENV_PYTHON_POSIX = path.join(ML_DIR, "venv", "bin", "python");
const RETRAIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RETRAIN_DEBOUNCE_MS = 5 * 60 * 1000;

let retrainTimer = null;
let retrainIntervalTimer = null;
let mlUnavailableLogged = false;

function commandExists(command, args = ["--version"]) {
  try {
    const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe", shell: false });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

function resolvePythonPath() {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  if (fs.existsSync(LOCAL_VENV_PYTHON_WINDOWS)) return LOCAL_VENV_PYTHON_WINDOWS;
  if (fs.existsSync(LOCAL_VENV_PYTHON_POSIX)) return LOCAL_VENV_PYTHON_POSIX;
  if (commandExists("python")) return "python";
  if (process.platform !== "win32" && commandExists("python3")) return "python3";
  if (process.platform === "win32" && commandExists("py", ["-3", "--version"])) return "py";
  return null;
}

const PYTHON_PATH = resolvePythonPath();

function logMlUnavailable() {
  if (mlUnavailableLogged) return;
  mlUnavailableLogged = true;
  console.warn("[ML] Python runtime not found. ML prediction/anomaly/retraining are disabled.");
}

function runJsonScript(script, args) {
  if (!PYTHON_PATH) {
    logMlUnavailable();
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    try {
      PythonShell.run(
        script,
        {
          mode: "json",
          pythonPath: PYTHON_PATH,
          pythonOptions: PYTHON_PATH === "py" ? ["-3"] : [],
          scriptPath: ML_DIR,
          args,
        },
        (error, results) => {
          if (error) { reject(error); return; }
          resolve(results?.[0] ?? null);
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

function toFeatureArgs({ temp, humidity, motion, ldr }) {
  return [temp ?? 25, humidity ?? 50, motion ? 1 : 0, ldr ?? 500];
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
  if (!PYTHON_PATH) {
    logMlUnavailable();
    return;
  }

  return new Promise((resolve, reject) => {
    try {
      PythonShell.run(
        "train.py",
        {
          pythonPath: PYTHON_PATH,
          pythonOptions: PYTHON_PATH === "py" ? ["-3"] : [],
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
    } catch (error) {
      console.error("[ML] Retrain failed:", error.message);
      reject(error);
    }
  });
}

function scheduleRetrain() {
  if (retrainTimer) clearTimeout(retrainTimer);
  retrainTimer = setTimeout(() => {
    retrainModels().catch(() => {});
    retrainTimer = null;
    // Start periodic retrain only after first manual-triggered retrain
    if (!retrainIntervalTimer) {
      retrainIntervalTimer = setInterval(() => {
        retrainModels().catch(() => {});
      }, RETRAIN_INTERVAL_MS);
    }
  }, RETRAIN_DEBOUNCE_MS);
}

function getMlStatus() {
  return {
    enabled: Boolean(PYTHON_PATH),
    pythonPath: PYTHON_PATH,
  };
}

module.exports = {
  detectAnomaly,
  getMlStatus,
  predictDeviceAction,
  scheduleRetrain,
};
