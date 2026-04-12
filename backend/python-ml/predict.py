"""
predict.py
Called by ml_integration.js with args: temp humidity motion hour
Outputs JSON: { "light_on": true/false }
"""
import sys
import json
import pickle
import os

MODEL_FILE = os.path.join(os.path.dirname(__file__), "model_decision_tree.pkl")

def main():
    if not os.path.exists(MODEL_FILE):
        # Model not trained yet – return null
        print(json.dumps(None))
        return

    args = sys.argv[1:]
    if len(args) < 4:
        print(json.dumps(None))
        return

    try:
        temp     = float(args[0])
        humidity = float(args[1])
        motion   = int(args[2])
        hour     = int(args[3])
    except ValueError:
        print(json.dumps(None))
        return

    with open(MODEL_FILE, "rb") as f:
        model = pickle.load(f)

    X = [[hour, temp, humidity, motion]]
    prediction = model.predict(X)[0]
    prob = model.predict_proba(X)[0].tolist()

    result = {
        "light_on":    bool(prediction),
        "confidence":  round(max(prob), 3),
    }
    print(json.dumps(result))

if __name__ == "__main__":
    main()
