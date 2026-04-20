"""
Train smart-home control and anomaly models.

Control model:
  Features -> [temp, humidity, motion, hour]
  Targets  -> [light1, light2, fan1, fan2]

Anomaly model:
  Features -> [temp, humidity, motion, hour]
"""

import json
import os
import pickle
import sys

try:
    import numpy as np
    import pandas as pd
    from sklearn.ensemble import IsolationForest
    from sklearn.metrics import classification_report
    from sklearn.model_selection import train_test_split
    from sklearn.tree import DecisionTreeClassifier
except ModuleNotFoundError as error:
    print(
        "[TRAIN] Missing Python dependency: {}. Install packages from requirements.txt before training.".format(
            error.name
        ),
        file=sys.stderr,
    )
    sys.exit(1)


DATA_FILE = os.path.join(os.path.dirname(__file__), "train_data.json")
DT_MODEL_FILE = os.path.join(os.path.dirname(__file__), "model_decision_tree.pkl")
ISO_MODEL_FILE = os.path.join(os.path.dirname(__file__), "model_iso_forest.pkl")

FEATURES = ["temp", "humidity", "motion", "hour"]
TARGETS = ["light1", "light2", "fan1", "fan2"]


def _to_bool_int(value):
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value != 0)
    if isinstance(value, str):
        normalized = value.strip().upper()
        if normalized in {"ON", "TRUE", "1", "YES"}:
            return 1
        if normalized in {"OFF", "FALSE", "0", "NO"}:
            return 0
    return None


def normalize_record(record):
    temp = record.get("temp")
    humidity = record.get("humidity")
    motion = record.get("motion")
    hour = record.get("hour")

    if temp is None or humidity is None or motion is None or hour is None:
        return None

    try:
        temp = float(temp)
        humidity = float(humidity)
        motion = int(_to_bool_int(motion))
        hour = int(hour)
    except (TypeError, ValueError):
        return None

    light1 = _to_bool_int(record.get("light1", record.get("light_on")))
    light2 = _to_bool_int(record.get("light2", record.get("light_on")))
    fan1 = _to_bool_int(record.get("fan1", record.get("fan_on")))
    fan2 = _to_bool_int(record.get("fan2", record.get("fan_on")))

    if None in {light1, light2, fan1, fan2}:
        return None

    return {
        "temp": round(temp, 2),
        "humidity": round(humidity, 2),
        "motion": motion,
        "hour": max(0, min(23, hour)),
        "light1": light1,
        "light2": light2,
        "fan1": fan1,
        "fan2": fan2,
    }


def load_data():
    if not os.path.exists(DATA_FILE):
        print("[TRAIN] No dataset found. Generating synthetic data.")
        return generate_synthetic_data()

    with open(DATA_FILE, "r", encoding="utf-8") as handle:
        raw_records = json.load(handle)

    normalized = [normalize_record(record) for record in raw_records]
    normalized = [record for record in normalized if record is not None]

    if not normalized:
        print("[TRAIN] Dataset empty after normalization. Generating synthetic data.")
        return generate_synthetic_data()

    return pd.DataFrame(normalized)


def generate_synthetic_data(samples=1200):
    np.random.seed(42)

    hours = np.random.randint(0, 24, samples)
    temp = np.random.normal(27, 4, samples).clip(16, 40)
    humidity = np.random.normal(58, 12, samples).clip(20, 90)
    motion = (np.random.rand(samples) > 0.45).astype(int)

    is_night = ((hours >= 18) | (hours < 6)).astype(int)
    hot_and_active = ((temp > 30) & (motion == 1)).astype(int)
    lights_on = (is_night & (motion == 1)).astype(int)

    light1 = lights_on.copy()
    light2 = lights_on.copy()
    fan1 = hot_and_active.copy()
    fan2 = hot_and_active.copy()

    # Add light noise so the tree sees non-perfect behaviour patterns.
    noise_idx = np.random.choice(samples, int(samples * 0.06), replace=False)
    for idx in noise_idx:
        choice = np.random.randint(0, 4)
        if choice == 0:
            light1[idx] = 1 - light1[idx]
        elif choice == 1:
            light2[idx] = 1 - light2[idx]
        elif choice == 2:
            fan1[idx] = 1 - fan1[idx]
        else:
            fan2[idx] = 1 - fan2[idx]

    df = pd.DataFrame(
        {
            "temp": temp.round(2),
            "humidity": humidity.round(2),
            "motion": motion,
            "hour": hours,
            "light1": light1,
            "light2": light2,
            "fan1": fan1,
            "fan2": fan2,
        }
    )
    df.to_json(DATA_FILE, orient="records", indent=2)
    print(f"[TRAIN] Synthetic dataset saved ({samples} records) -> {DATA_FILE}")
    return df


def train_decision_tree(df):
    x_train, x_test, y_train, y_test = train_test_split(
        df[FEATURES],
        df[TARGETS],
        test_size=0.2,
        random_state=42,
    )

    model = DecisionTreeClassifier(max_depth=8, random_state=42)
    model.fit(x_train, y_train)

    predictions = model.predict(x_test)
    prediction_df = pd.DataFrame(predictions, columns=TARGETS)

    print("\n[DT] Classification reports:")
    for target in TARGETS:
        print(f"\n[{target}]")
        print(classification_report(y_test[target], prediction_df[target], zero_division=0))

    with open(DT_MODEL_FILE, "wb") as handle:
        pickle.dump(model, handle)
    print(f"[DT] Model saved -> {DT_MODEL_FILE}")


def train_isolation_forest(df):
    iso = IsolationForest(n_estimators=150, contamination=0.03, random_state=42)
    iso.fit(df[FEATURES])

    with open(ISO_MODEL_FILE, "wb") as handle:
        pickle.dump(iso, handle)
    print(f"[ISO] Model saved -> {ISO_MODEL_FILE}")


if __name__ == "__main__":
    dataset = load_data()
    print(f"[TRAIN] Dataset shape: {dataset.shape}")
    print(dataset.head(3))

    train_decision_tree(dataset)
    train_isolation_forest(dataset)
    print("\nTraining complete.")
