"""
train.py
Trains two models on collected sensor data:
  1. DecisionTreeClassifier  – predicts whether to turn light ON
  2. IsolationForest         – flags anomalous readings

Run:  python3 train.py
"""

import os
import json
import pickle
import numpy as np
import pandas as pd
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import IsolationForest
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

# ─── CONFIG ──────────────────────────────────────────────
DATA_FILE       = os.path.join(os.path.dirname(__file__), "train_data.json")
DT_MODEL_FILE   = os.path.join(os.path.dirname(__file__), "model_decision_tree.pkl")
ISO_MODEL_FILE  = os.path.join(os.path.dirname(__file__), "model_iso_forest.pkl")

# ─── LOAD DATA ───────────────────────────────────────────
def load_data():
    if not os.path.exists(DATA_FILE):
        print("[TRAIN] No data file found – generating synthetic data for demo.")
        return generate_synthetic_data()

    with open(DATA_FILE) as f:
        records = json.load(f)
    df = pd.DataFrame(records)
    return df

def generate_synthetic_data(n=1000):
    """Create plausible synthetic home sensor data."""
    np.random.seed(42)
    hours    = np.random.randint(0, 24, n)
    temp     = np.random.normal(25, 3, n).clip(15, 40)
    humidity = np.random.normal(55, 10, n).clip(20, 90)
    motion   = (np.random.rand(n) > 0.6).astype(int)

    # Rule: light is ON in the evening (18-23) when motion is detected
    light_on = (((hours >= 18) | (hours <= 6)) & (motion == 1)).astype(int)
    # Add some noise
    flip_idx = np.random.choice(n, int(n * 0.05), replace=False)
    light_on[flip_idx] = 1 - light_on[flip_idx]

    df = pd.DataFrame({
        "hour":     hours,
        "temp":     temp.round(1),
        "humidity": humidity.round(1),
        "motion":   motion,
        "light_on": light_on,
    })
    df.to_json(DATA_FILE, orient="records", indent=2)
    print(f"[TRAIN] Synthetic dataset saved ({n} records) → {DATA_FILE}")
    return df

# ─── FEATURE COLUMNS ─────────────────────────────────────
FEATURES = ["hour", "temp", "humidity", "motion"]
TARGET   = "light_on"

# ─── TRAIN DECISION TREE ─────────────────────────────────
def train_decision_tree(df):
    X = df[FEATURES]
    y = df[TARGET]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    model = DecisionTreeClassifier(max_depth=6, random_state=42)
    model.fit(X_train, y_train)

    print("\n[DT] Classification Report:")
    print(classification_report(y_test, model.predict(X_test)))

    with open(DT_MODEL_FILE, "wb") as f:
        pickle.dump(model, f)
    print(f"[DT] Model saved → {DT_MODEL_FILE}")
    return model

# ─── TRAIN ISOLATION FOREST ──────────────────────────────
def train_isolation_forest(df):
    # Train only on "normal" behavior (light_on correctly follows hour/motion)
    normal_df = df[(df["hour"] >= 6) & (df["hour"] <= 23)]
    X = normal_df[["temp", "humidity", "motion"]]

    iso = IsolationForest(n_estimators=100, contamination=0.02, random_state=42)
    iso.fit(X)

    with open(ISO_MODEL_FILE, "wb") as f:
        pickle.dump(iso, f)
    print(f"[ISO] IsolationForest saved → {ISO_MODEL_FILE}")
    return iso

# ─── MAIN ────────────────────────────────────────────────
if __name__ == "__main__":
    df = load_data()
    print(f"[TRAIN] Dataset shape: {df.shape}")
    print(df.head(3))

    train_decision_tree(df)
    train_isolation_forest(df)
    print("\n✅ Training complete.")
