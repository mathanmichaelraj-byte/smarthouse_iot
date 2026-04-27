"""
Predict device states for the smart home.

Args: temp humidity motion ldr
Output:
{
  "light1": bool,
  "light2": bool,
  "fan1": bool,
  "fan2": bool,
  "confidence": float
}
"""

import json
import os
import pickle
import sys


MODEL_FILE = os.path.join(os.path.dirname(__file__), "model_decision_tree.pkl")
TARGETS = ["light1", "light2", "fan1", "fan2"]


def emit_null():
    print(json.dumps(None))


def main():
    if not os.path.exists(MODEL_FILE):
        emit_null()
        return

    args = sys.argv[1:]
    if len(args) < 4:
        emit_null()
        return

    try:
        temp = float(args[0])
        humidity = float(args[1])
        motion = int(args[2])
        ldr = int(args[3])
    except ValueError:
        emit_null()
        return

    try:
        with open(MODEL_FILE, "rb") as handle:
            model = pickle.load(handle)
    except Exception:
        emit_null()
        return

    features = [[temp, humidity, motion, ldr]]
    predictions = model.predict(features)[0]
    # predictions is a 1-D array [light1, light2, fan1, fan2] for multi-output models
    if hasattr(predictions, '__len__') and len(predictions) == len(TARGETS):
        result = {target: bool(predictions[index]) for index, target in enumerate(TARGETS)}
    else:
        emit_null()
        return

    confidence = 0.0
    try:
        probabilities = model.predict_proba(features)
        if isinstance(probabilities, list):
            per_output_confidences = [max(map(float, prob[0])) for prob in probabilities]
        else:
            per_output_confidences = [max(map(float, probabilities[0]))]
        confidence = min(per_output_confidences) if per_output_confidences else 0.0
    except Exception:
        confidence = 0.0

    result["confidence"] = round(confidence, 3)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
