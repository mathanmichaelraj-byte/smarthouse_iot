"""
Persistent ML server for smart home.
Loads models once at startup, serves predictions via HTTP.

POST /predict  { temp, humidity, motion, ldr, hour }
POST /anomaly  { temp, humidity, motion, ldr, hour }
POST /retrain  {}
GET  /status
"""

import json
import os
import pickle
import threading

import numpy as np
from flask import Flask, jsonify, request

try:
    import pandas as pd
    from sklearn.ensemble import IsolationForest
    from sklearn.model_selection import train_test_split
    from sklearn.tree import DecisionTreeClassifier
except ModuleNotFoundError as e:
    raise SystemExit(f"[ML] Missing dependency: {e.name}. Run: pip install -r requirements.txt")

ML_DIR = os.path.dirname(__file__)
DATA_FILE = os.path.join(ML_DIR, "train_data.json")
DT_MODEL_FILE = os.path.join(ML_DIR, "model_decision_tree.pkl")
ISO_MODEL_FILE = os.path.join(ML_DIR, "model_iso_forest.pkl")

FEATURES = ["temp", "humidity", "motion", "ldr", "hour"]
TARGETS = ["light1", "light2", "fan1", "fan2"]

app = Flask(__name__)

dt_model = None
iso_model = None
model_lock = threading.Lock()
retrain_lock = threading.Lock()


# ── helpers ──────────────────────────────────────────────────────────────────

def _to_bool_int(value):
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value != 0)
    if isinstance(value, str):
        v = value.strip().upper()
        if v in {"ON", "TRUE", "1", "YES"}:
            return 1
        if v in {"OFF", "FALSE", "0", "NO"}:
            return 0
    return None


def normalize_record(r):
    try:
        temp = float(r["temp"])
        humidity = float(r["humidity"])
        motion = int(_to_bool_int(r["motion"]))
        ldr = int(r["ldr"])
        hour = max(0, min(23, int(r.get("hour", 12))))
    except (TypeError, ValueError, KeyError):
        return None

    targets = {}
    for t in TARGETS:
        v = _to_bool_int(r.get(t, r.get(f"relay_{t}")))
        if v is None:
            return None
        targets[t] = v

    return {"temp": temp, "humidity": humidity, "motion": motion,
            "ldr": ldr, "hour": hour, **targets}


def generate_synthetic_data(samples=1200):
    np.random.seed(42)
    hours = np.random.randint(0, 24, samples)
    temp = np.random.normal(27, 4, samples).clip(16, 40)
    humidity = np.random.normal(58, 12, samples).clip(20, 90)
    motion = (np.random.rand(samples) > 0.45).astype(int)
    ldr = np.where(
        hours >= 18,
        np.random.normal(3500, 500, samples),
        np.random.normal(500, 200, samples)
    ).clip(0, 4095).astype(int)

    is_night = ldr < 1000
    hot = ((temp > 30) & (motion == 1)).astype(int)
    lights = (is_night & (motion == 1)).astype(int)

    # Simulate user patterns: lights on in evening (18-23) even without motion
    evening = ((hours >= 18) & (hours <= 23)).astype(int)
    lights = np.clip(lights + evening * (np.random.rand(samples) > 0.3).astype(int), 0, 1)

    # Fan on when hot OR in afternoon (12-17) with motion
    afternoon_motion = ((hours >= 12) & (hours <= 17) & (motion == 1)).astype(int)
    fans = np.clip(hot + afternoon_motion, 0, 1)

    df = pd.DataFrame({
        "temp": temp.round(2), "humidity": humidity.round(2),
        "motion": motion, "ldr": ldr, "hour": hours,
        "light1": lights, "light2": lights,
        "fan1": fans, "fan2": fans,
    })
    df.to_json(DATA_FILE, orient="records", indent=2)
    print(f"[ML] Synthetic dataset saved ({samples} records)")
    return df


def load_data():
    if not os.path.exists(DATA_FILE):
        print("[ML] No dataset, generating synthetic data.")
        return generate_synthetic_data()

    with open(DATA_FILE, "r", encoding="utf-8") as f:
        raw = json.load(f)

    records = [normalize_record(r) for r in raw]
    records = [r for r in records if r is not None]

    if len(records) < 10:
        print(f"[ML] Only {len(records)} valid records, merging with synthetic data.")
        synthetic = generate_synthetic_data(800)
        real_df = pd.DataFrame(records) if records else pd.DataFrame()
        return pd.concat([synthetic, real_df], ignore_index=True) if not real_df.empty else synthetic

    print(f"[ML] Loaded {len(records)} training records.")
    return pd.DataFrame(records)


# ── training ─────────────────────────────────────────────────────────────────

def do_train():
    global dt_model, iso_model
    df = load_data()

    x = df[FEATURES]
    y = df[TARGETS]

    x_train, x_test, y_train, y_test = train_test_split(x, y, test_size=0.2, random_state=42)

    dt = DecisionTreeClassifier(max_depth=10, min_samples_leaf=3, random_state=42)
    dt.fit(x_train, y_train)

    iso = IsolationForest(n_estimators=150, contamination=0.03, random_state=42)
    iso.fit(x[["temp", "humidity", "motion", "ldr"]])

    with open(DT_MODEL_FILE, "wb") as f:
        pickle.dump(dt, f)
    with open(ISO_MODEL_FILE, "wb") as f:
        pickle.dump(iso, f)

    with model_lock:
        dt_model = dt
        iso_model = iso

    acc = (dt.predict(x_test) == y_test.values).all(axis=1).mean()
    print(f"[ML] Training complete. Exact-match accuracy: {acc:.2%} on {len(df)} records.")
    return round(float(acc), 4)


def load_models():
    global dt_model, iso_model
    loaded = []
    if os.path.exists(DT_MODEL_FILE):
        with open(DT_MODEL_FILE, "rb") as f:
            dt_model = pickle.load(f)
        loaded.append("decision_tree")
    if os.path.exists(ISO_MODEL_FILE):
        with open(ISO_MODEL_FILE, "rb") as f:
            iso_model = pickle.load(f)
        loaded.append("isolation_forest")

    if not loaded:
        print("[ML] No saved models found, training now...")
        do_train()
    else:
        print(f"[ML] Loaded models: {loaded}")


# ── routes ────────────────────────────────────────────────────────────────────

@app.post("/predict")
def predict():
    body = request.get_json(silent=True) or {}
    try:
        temp = float(body["temp"])
        humidity = float(body["humidity"])
        motion = int(bool(body["motion"]))
        ldr = int(body["ldr"])
        hour = int(body.get("hour", 12))
    except (KeyError, TypeError, ValueError) as e:
        return jsonify({"error": str(e)}), 400

    with model_lock:
        model = dt_model

    if model is None:
        return jsonify(None)

    features = [[temp, humidity, motion, ldr, hour]]
    preds = model.predict(features)[0]

    if not hasattr(preds, "__len__") or len(preds) != len(TARGETS):
        return jsonify(None)

    result = {t: bool(preds[i]) for i, t in enumerate(TARGETS)}

    confidence = 0.0
    try:
        probas = model.predict_proba(features)
        if isinstance(probas, list):
            confidence = min(max(map(float, p[0])) for p in probas)
        else:
            confidence = float(max(probas[0]))
    except Exception:
        confidence = 0.0

    result["confidence"] = round(confidence, 3)
    return jsonify(result)


@app.post("/anomaly")
def anomaly():
    body = request.get_json(silent=True) or {}
    try:
        temp = float(body["temp"])
        humidity = float(body["humidity"])
        motion = int(bool(body["motion"]))
        ldr = int(body["ldr"])
    except (KeyError, TypeError, ValueError) as e:
        return jsonify({"error": str(e)}), 400

    with model_lock:
        model = iso_model

    if model is None:
        return jsonify({"anomaly": False, "score": 0.0})

    features = [[temp, humidity, motion, ldr]]
    label = model.predict(features)[0]
    score = model.score_samples(features)[0]
    return jsonify({"anomaly": bool(label == -1), "score": round(float(score), 4)})


@app.post("/retrain")
def retrain():
    if not retrain_lock.acquire(blocking=False):
        return jsonify({"ok": False, "message": "Retrain already in progress"}), 409

    def run():
        try:
            acc = do_train()
            print(f"[ML] Retrain done, accuracy={acc:.2%}")
        except Exception as e:
            print(f"[ML] Retrain failed: {e}")
        finally:
            retrain_lock.release()

    threading.Thread(target=run, daemon=True).start()
    return jsonify({"ok": True, "message": "Retrain started"})


@app.get("/status")
def status():
    with model_lock:
        has_dt = dt_model is not None
        has_iso = iso_model is not None
    data_rows = 0
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE) as f:
                data_rows = len(json.load(f))
        except Exception:
            pass
    return jsonify({
        "decision_tree": has_dt,
        "isolation_forest": has_iso,
        "training_rows": data_rows,
        "features": FEATURES,
    })


# ── startup ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    load_models()
    port = int(os.environ.get("ML_PORT", 5001))
    print(f"[ML] Server running on http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)
