# Self-Learning Smart Home System

An end-to-end smart home project using ESP32, MQTT, Node.js, MongoDB, Python ML, and React.

This version supports:
- 4 controllable outputs: `light1`, `light2`, `fan1`, `fan2`
- manual override via dedicated MQTT topics
- behavior learning from manual actions
- hybrid ML + fallback automation
- anomaly alerts and buzzer control

## Architecture

```text
ESP32 -> MQTT -> Node backend -> ML inference -> decision -> MQTT -> ESP32
Manual switch/dashboard -> MQTT *_manual -> backend -> MongoDB + dataset -> retraining
Frontend -> MQTT + REST -> live dashboard + alerts
```

## Main Features

- Real-time sensor flow from `home1/sensor`
- Retained control topics for 4 devices
- Per-device 5 minute manual override cooldown
- MongoDB persistence for readings, device state, manual actions, and alerts
- DecisionTreeClassifier for control prediction
- IsolationForest for anomaly detection
- Hybrid decision logic:
  - use ML when `confidence > 0.7`
  - otherwise fall back to built-in rules
- Security alert when motion is detected at night while all lights are off

## MQTT Topics

| Topic | Direction | Payload | Purpose |
|---|---|---|---|
| `home1/sensor` | ESP32 -> backend/frontend | JSON | Current temp, humidity, motion, and all 4 device states |
| `home1/light1` | backend/frontend -> ESP32/frontend | `ON` / `OFF` | Canonical control/state topic |
| `home1/light2` | backend/frontend -> ESP32/frontend | `ON` / `OFF` | Canonical control/state topic |
| `home1/fan1` | backend/frontend -> ESP32/frontend | `ON` / `OFF` | Canonical control/state topic |
| `home1/fan2` | backend/frontend -> ESP32/frontend | `ON` / `OFF` | Canonical control/state topic |
| `home1/light1_manual` | dashboard/ESP32 -> backend | `ON` / `OFF` | Manual action + learning input |
| `home1/light2_manual` | dashboard/ESP32 -> backend | `ON` / `OFF` | Manual action + learning input |
| `home1/fan1_manual` | dashboard/ESP32 -> backend | `ON` / `OFF` | Manual action + learning input |
| `home1/fan2_manual` | dashboard/ESP32 -> backend | `ON` / `OFF` | Manual action + learning input |
| `home1/alert` | backend -> frontend/clients | text | Human-readable alert |
| `home1/buzzer` | backend -> ESP32 | `ON` / `OFF` | Buzzer pulse for suspicious activity |

### Example sensor payload

```json
{
  "device": "home1",
  "temp": 28.4,
  "humidity": 62.1,
  "motion": true,
  "light1": false,
  "light2": true,
  "fan1": false,
  "fan2": false,
  "timestamp": 1713168000
}
```

## Backend Behavior

The backend:
- subscribes to `home1/sensor`
- subscribes to all 4 control topics
- subscribes to all 4 `*_manual` topics
- stores current device state in MongoDB
- stores manual actions and alert logs
- appends training rows to `backend/python-ml/train_data.json`
- retrains ML on a schedule and with debounce after new samples

### Hybrid decision rules

- If ML returns `confidence > 0.7`, use ML output
- Otherwise:
  - `fan1 = fan2 = temp > 30 && motion`
  - `light1 = light2 = (hour >= 18 || hour < 6) && motion`
- Manual override blocks automation for that target for 5 minutes

### Security alert rule

If all of the following are true:
- night time (`18:00-05:59`)
- motion is detected
- `light1 == false`
- `light2 == false`

Then the backend:
- logs an alert
- publishes `home1/alert` with `Suspicious activity`
- publishes `home1/buzzer = ON`
- auto-publishes `home1/buzzer = OFF` after 10 seconds

## ML Design

### Features

```text
[temp, humidity, motion, hour]
```

### Targets

```text
[light1, light2, fan1, fan2]
```

### Models

- `DecisionTreeClassifier` for control prediction
- `IsolationForest` for anomaly detection

### Training data sources

- explicit manual actions
- sensor readings captured while manual override is active

### ML files

- [backend/python-ml/train.py](/home/mahes/Desktop/PROJECT/smarthouse_iot/backend/python-ml/train.py)
- [backend/python-ml/predict.py](/home/mahes/Desktop/PROJECT/smarthouse_iot/backend/python-ml/predict.py)
- [backend/python-ml/anomaly.py](/home/mahes/Desktop/PROJECT/smarthouse_iot/backend/python-ml/anomaly.py)
- [backend/python-ml/requirements.txt](/home/mahes/Desktop/PROJECT/smarthouse_iot/backend/python-ml/requirements.txt)

If `scikit-learn` is not installed, training will fail with a clear message and inference will safely fall back instead of crashing the backend.

## REST API

### `GET /api/devices`

Returns current device state documents from MongoDB.

### `GET /api/readings?device=home1&limit=100`

Returns historical readings for the given device.

### `POST /api/control`

Manual control endpoint.

Request body:

```json
{
  "device": "home1",
  "target": "light1",
  "state": "ON"
}
```

This endpoint publishes the matching `*_manual` topic internally.

### `GET /api/rules`

Returns the active fallback rules exposed by the backend.

## Frontend

The React dashboard:
- loads initial state from REST
- subscribes directly to MQTT over WebSocket
- shows live temp/humidity history
- shows current motion status
- shows 4 device cards
- publishes manual actions to `*_manual`
- listens to `home1/alert` for alert banner updates

Main files:
- [frontend/src/Dashboard.jsx](/home/mahes/Desktop/PROJECT/smarthouse_iot/frontend/src/Dashboard.jsx)
- [frontend/src/mqtt-hooks.js](/home/mahes/Desktop/PROJECT/smarthouse_iot/frontend/src/mqtt-hooks.js)

## Firmware

Both firmware paths now follow the same MQTT contract:
- Arduino: [firmware/ESP32/main/main.ino](/home/mahes/Desktop/PROJECT/smarthouse_iot/firmware/ESP32/main/main.ino)
- MicroPython: [firmware/ESP32/main.py](/home/mahes/Desktop/PROJECT/smarthouse_iot/firmware/ESP32/main.py)

They support:
- 4 relay outputs
- 4 manual switch inputs
- 1 PIR input
- 1 DHT input
- 1 buzzer output
- subscriptions to the 4 control topics plus `home1/buzzer`
- publishing `*_manual` when a local switch changes

## Project Structure

```text
smarthouse_iot/
├── backend/
│   ├── mqtt-server/
│   │   ├── index.js
│   │   ├── init_mongodb.js
│   │   ├── ml_integration.js
│   │   ├── rules.js
│   │   └── package.json
│   └── python-ml/
│       ├── anomaly.py
│       ├── predict.py
│       ├── requirements.txt
│       ├── train.py
│       └── train_data.json
├── firmware/ESP32/
│   ├── main.py
│   └── main/main.ino
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.jsx
│       ├── Dashboard.jsx
│       ├── main.jsx
│       └── mqtt-hooks.js
├── .env.example
└── README.md
```

## Setup

### 1. Backend

```bash
cd backend/mqtt-server
npm install
cp ../../.env.example .env
npm run init-db
npm start
```

### 2. Python ML environment

```bash
cd backend/python-ml
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python train.py
```

### 3. Frontend

```bash
cd frontend
npm install
npm start
```

### 4. Firmware

Update WiFi credentials in the firmware file you are using, flash the ESP32, and confirm it publishes to `home1/sensor`.

## Environment Variables

Example values are in [.env.example](/home/mahes/Desktop/PROJECT/smarthouse_iot/.env.example).

Backend:

```env
MQTT_BROKER=mqtt://broker.hivemq.com
MONGO_URI=mongodb://localhost:27017/smarthome
PORT=3001
```

Frontend:

```env
VITE_API=http://localhost:3001
VITE_MQTT_WS=ws://broker.hivemq.com:8000/mqtt
```

## Notes

- Control topics are retained so reconnecting clients recover the latest state
- Manual topics are not retained
- Ack topics are no longer part of the contract
- Telegram integration is not implemented in this version
- `package-lock.json` files may still contain older dependencies until `npm install` is run again

## Quick Verification

Useful checks:

```bash
node --check backend/mqtt-server/index.js
python3 -m py_compile backend/python-ml/train.py backend/python-ml/predict.py backend/python-ml/anomaly.py firmware/ESP32/main.py
cd frontend && npm run build
```

## Current Status

Implemented in the repo:
- four-device MQTT backend flow
- MongoDB persistence updates
- frontend dashboard upgrade
- both firmware paths
- ML script contract upgrade

Still required on a fresh machine:
- install Python ML dependencies from `requirements.txt`
- run `npm install` where needed to refresh lockfiles after dependency cleanup
