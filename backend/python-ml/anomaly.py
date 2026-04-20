"""
Anomaly detection for the smart home sensor stream.

Args: temp humidity motion hour
Output: { "anomaly": bool, "score": float }
"""

import json
import os
import pickle
import sys


MODEL_FILE = os.path.join(os.path.dirname(__file__), "model_iso_forest.pkl")


def emit_default():
    print(json.dumps({"anomaly": False, "score": 0.0}))


def main():
    if not os.path.exists(MODEL_FILE):
        emit_default()
        return

    args = sys.argv[1:]
    if len(args) < 4:
        emit_default()
        return

    try:
        temp = float(args[0])
        humidity = float(args[1])
        motion = int(args[2])
        hour = int(args[3])
    except ValueError:
        emit_default()
        return

    try:
        with open(MODEL_FILE, "rb") as handle:
            model = pickle.load(handle)
    except Exception:
        emit_default()
        return

    features = [[temp, humidity, motion, hour]]
    label = model.predict(features)[0]
    score = model.score_samples(features)[0]

    print(
        json.dumps(
            {
                "anomaly": bool(label == -1),
                "score": round(float(score), 4),
            }
        )
    )


if __name__ == "__main__":
    main()
