"""
anomaly.py
Called by ml_integration.js with args: temp humidity motion
Outputs JSON: { "anomaly": true/false, "score": float }
"""
import sys
import json
import pickle
import os

MODEL_FILE = os.path.join(os.path.dirname(__file__), "model_iso_forest.pkl")

def main():
    if not os.path.exists(MODEL_FILE):
        print(json.dumps({"anomaly": False, "score": 0}))
        return

    args = sys.argv[1:]
    if len(args) < 3:
        print(json.dumps({"anomaly": False, "score": 0}))
        return

    try:
        temp     = float(args[0])
        humidity = float(args[1])
        motion   = int(args[2])
    except ValueError:
        print(json.dumps({"anomaly": False, "score": 0}))
        return

    with open(MODEL_FILE, "rb") as f:
        iso = pickle.load(f)

    X = [[temp, humidity, motion]]
    label = iso.predict(X)[0]      # -1 = anomaly, 1 = normal
    score = iso.score_samples(X)[0]

    result = {
        "anomaly": bool(label == -1),
        "score":   round(float(score), 4),
    }
    print(json.dumps(result))

if __name__ == "__main__":
    main()
