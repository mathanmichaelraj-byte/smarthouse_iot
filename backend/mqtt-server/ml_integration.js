const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ML_DIR = path.join(__dirname, "../python-ml");
const ML_SERVER_SCRIPT = path.join(ML_DIR, "ml_server.py");
const LOCAL_VENV_PYTHON_WINDOWS = path.join(ML_DIR, "venv", "Scripts", "python.exe");
const LOCAL_VENV_PYTHON_POSIX = path.join(ML_DIR, "venv", "bin", "python");

const ML_PORT = Number(process.env.ML_PORT || 5001);
const ML_BASE = `http://127.0.0.1:${ML_PORT}`;
const RETRAIN_DEBOUNCE_MS = 5 * 60 * 1000;
const RETRAIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

let retrainTimer = null;
let retrainIntervalTimer = null;
let mlUnavailableLogged = false;
let serverProcess = null;
let serverReady = false;

// ── Python path resolution ────────────────────────────────────────────────────

function commandExists(command, args = ["--version"]) {
  try {
    const r = spawnSync(command, args, { encoding: "utf8", stdio: "pipe", shell: false });
    return !r.error && r.status === 0;
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

// ── Server lifecycle ──────────────────────────────────────────────────────────

async function waitForServer(retries = 20, intervalMs = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${ML_BASE}/status`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function startMlServer() {
  if (!PYTHON_PATH) {
    if (!mlUnavailableLogged) {
      mlUnavailableLogged = true;
      console.warn("[ML] Python not found. ML server disabled, fallback rules will be used.");
    }
    return;
  }

  // Check if already running
  try {
    const res = await fetch(`${ML_BASE}/status`, { signal: AbortSignal.timeout(800) });
    if (res.ok) {
      console.log("[ML] Server already running.");
      serverReady = true;
      return;
    }
  } catch {}

  const args = PYTHON_PATH === "py" ? ["-3", ML_SERVER_SCRIPT] : [ML_SERVER_SCRIPT];
  serverProcess = spawn(PYTHON_PATH, args, {
    cwd: ML_DIR,
    env: { ...process.env, ML_PORT: String(ML_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (d) => process.stdout.write(`[ML] ${d}`));
  serverProcess.stderr.on("data", (d) => process.stderr.write(`[ML] ${d}`));

  serverProcess.on("exit", (code) => {
    serverReady = false;
    if (code !== 0 && code !== null) {
      console.warn(`[ML] Server exited with code ${code}. Fallback rules active.`);
    }
  });

  serverReady = await waitForServer();
  if (serverReady) {
    console.log(`[ML] Server ready at ${ML_BASE}`);
  } else {
    console.warn("[ML] Server did not start in time. Fallback rules active.");
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function mlPost(endpoint, body) {
  if (!serverReady) return null;
  try {
    const res = await fetch(`${ML_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

async function predictDeviceAction(data) {
  try {
    return await mlPost("/predict", {
      temp: data.temp ?? 25,
      humidity: data.humidity ?? 50,
      motion: data.motion ? 1 : 0,
      ldr: data.ldr ?? 500,
      hour: data.hour ?? new Date().getHours(),
    });
  } catch (error) {
    console.warn("[ML] Prediction failed:", error.message);
    return null;
  }
}

async function detectAnomaly(data) {
  try {
    const result = await mlPost("/anomaly", {
      temp: data.temp ?? 25,
      humidity: data.humidity ?? 50,
      motion: data.motion ? 1 : 0,
      ldr: data.ldr ?? 500,
    });
    return result ?? { anomaly: false, score: 0 };
  } catch (error) {
    console.warn("[ML] Anomaly detection failed:", error.message);
    return { anomaly: false, score: 0 };
  }
}

function scheduleRetrain() {
  if (retrainTimer) clearTimeout(retrainTimer);
  retrainTimer = setTimeout(async () => {
    retrainTimer = null;
    if (!serverReady) return;
    try {
      await mlPost("/retrain", {});
      console.log("[ML] Retrain triggered after manual action.");
    } catch {}

    if (!retrainIntervalTimer) {
      retrainIntervalTimer = setInterval(async () => {
        if (!serverReady) return;
        try {
          await mlPost("/retrain", {});
          console.log("[ML] Periodic retrain triggered.");
        } catch {}
      }, RETRAIN_INTERVAL_MS);
    }
  }, RETRAIN_DEBOUNCE_MS);
}

function getMlStatus() {
  return {
    enabled: Boolean(PYTHON_PATH) && serverReady,
    pythonPath: PYTHON_PATH,
    serverUrl: ML_BASE,
    serverReady,
  };
}

module.exports = {
  startMlServer,
  detectAnomaly,
  getMlStatus,
  predictDeviceAction,
  scheduleRetrain,
};
