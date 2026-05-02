# Smart House IoT

An end-to-end smart home project using:
- `ESP32` firmware
- a local embedded `MQTT` broker
- `Node.js + Express` backend
- `MongoDB Atlas`
- optional `Python` ML scripts
- `React` dashboard

## Final Architecture

```text
ESP32 -> local MQTT broker -> Node backend -> MongoDB Atlas
Dashboard -> REST + MQTT over WebSocket -> local broker/backend
Python ML -> invoked by backend when Python is available
```

## Features

- 4 controllable devices: `light1`, `light2`, `fan1`, `fan2`
- 1 PIR motion sensor, DHT11, and LDR telemetry
- local manual switches plus dashboard control
- retained control topics for fast recovery after reconnect
- manual override learning dataset capture
- fallback automation rules even when ML is unavailable
- live alerts and buzzer pulse for suspicious nighttime motion (ldr > 3000 + motion + lights off)
- ML anomaly detection via IsolationForest with alert publishing
- periodic model retraining triggered by manual override actions
- live MQTT WebSocket connection status indicator in dashboard
- LDR history chart alongside temperature and humidity
- backend smoke test for verifying `MQTT -> backend -> MongoDB`

## Project Layout

```text
smarthouse_iot/
├── backend/
│   ├── mqtt-server/
│   │   ├── index.js
│   │   ├── init_mongodb.js
│   │   ├── ml_integration.js
│   │   ├── rules.js
│   │   ├── smoke_test.js
│   │   └── .env
│   └── python-ml/
│       ├── predict.py
│       ├── anomaly.py
│       ├── train.py
│       ├── requirements.txt
│       └── train_data.json
├── firmware/
│   └── ESP32/
│       ├── main.py
│       └── main/main.ino
├── frontend/
│   ├── .env
│   └── src/
└── README.md
```

## MQTT Topics

- `home1/sensor`
  ESP32 publishes live sensor + relay state JSON
- `home1/light1`, `home1/light2`, `home1/fan1`, `home1/fan2`
  canonical retained control/state topics
- `home1/light1_manual`, `home1/light2_manual`, `home1/fan1_manual`, `home1/fan2_manual`
  manual override topics from dashboard or physical switches
- `home1/ml_mode`
  retained ML enable/disable state
- `home1/buzzer_mute`
  retained buzzer mute state
- `home1/alert`
  backend alert text for dashboard banner
- `home1/buzzer`
  backend buzzer pulse command

## Backend API

- `GET /api/devices`
  current device state
- `GET /api/readings?device=home1&limit=100`
  recent reading history
- `POST /api/control`
  publishes a manual control command
- `GET /api/rules`
  current fallback rule set
- `GET /api/alerts?device=home1&limit=50`
  recent alert log from MongoDB
- `GET /api/health`
  broker, MongoDB, and ML status summary

## Setup

### 1. Backend

```powershell
cd backend/mqtt-server
npm install
npm start
```

For development with auto-restart on file changes:

```powershell
npm run dev
```

The backend starts:
- embedded MQTT TCP broker on `1883`
- embedded MQTT WebSocket broker on `8000`
- REST API on `3001`

To initialise MongoDB indexes and seed the default device state (run once):

```powershell
npm run init-db
```

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Dashboard runs at `http://localhost:3000`.

### 3. Python ML

Python is optional for the core pipeline. If Python is available and dependencies are installed, the backend enables ML prediction and anomaly detection.

```powershell
cd backend/python-ml
python -m pip install -r requirements.txt
python train.py
```

### 4. ESP32 Firmware

Open [firmware/ESP32/main/main.ino](d:/PROJECT/smarthouse_iot/firmware/ESP32/main/main.ino:1) and update:
- Wi-Fi SSID/password
- `mqttServer`

`mqttServer` must be your laptop's current LAN IP address while the backend is running.

> **University/campus Wi-Fi note:** Most campus networks block direct device-to-device traffic (client isolation). Use your laptop's **Mobile Hotspot** instead. The hotspot adapter IP is always `192.168.137.1` on Windows — set that as `mqttServer` and connect the ESP32 to the hotspot SSID.

## Current Local Configuration

Backend `.env`:

```env
ENABLE_EMBEDDED_BROKER=true
LOCAL_MQTT_HOST=0.0.0.0
LOCAL_MQTT_PORT=1883
LOCAL_MQTT_WS_PORT=8000
MQTT_BROKER=mqtt://127.0.0.1:1883
PYTHON_PATH=C:\Users\Mahes\AppData\Local\Programs\Python\Python314\python.exe
PORT=3001
```

Frontend `.env`:

```env
VITE_API=http://localhost:3001
VITE_MQTT_WS=ws://localhost:8000/mqtt
```

## Verification

### Backend smoke test

Start the backend first, then run:

```powershell
cd backend/mqtt-server
npm run smoke-test
```

This publishes a sample `home1/sensor` payload and confirms a new MongoDB reading was inserted.

### Frontend build

```powershell
cd frontend
npm run build
```

## Troubleshooting

- If the ESP32 cannot connect to MQTT, make sure the laptop IP in `main.ino` is correct and Windows Firewall allows inbound TCP `1883`.
- If the dashboard cannot connect, make sure the backend is running and WebSocket MQTT is available on `ws://localhost:8000/mqtt`.
- If ML is unavailable, the backend will continue running with fallback rules instead of crashing.
- If controls appear inverted, adjust the switch interpretation in the firmware where `reading == LOW` is mapped to `ON`.
- If the backend logs `MQTT error: connack timeout` on startup, a stale `node` process is likely holding port `1883`. Run `netstat -ano | findstr :1883` to find the PID and kill it with `taskkill /PID <pid> /F`, then restart.
- MongoDB Atlas connection failures (`querySrv ECONNREFUSED`) mean your current IP is not whitelisted. Go to Atlas → Security → Network Access and add your current IP.

## Finished State

The project is considered complete when:
- backend starts cleanly
- `npm run smoke-test` passes
- frontend loads and shows live status
- ESP32 logs `[SENSOR] Published OK`
- backend logs `[SENSOR] Reading stored in MongoDB`

## Recent Updates

- **Aedes broker fix** — downgraded from `aedes@1.0.2` to `aedes@0.51.3` to fix `connack timeout` on Node.js v22+. The 1.x release is broken on Node 22+ (never sends CONNACK); 0.51.3 is stable. Constructor API changed from `new Aedes()` to `Aedes()`.
- **Broker readiness check** — backend now actively polls port 1883 before connecting the MQTT client instead of using a blind delay.
- **MQTT client deduplication** — fixed a bug in `mqtt-hooks.js` where a new WebSocket client was created on every reconnect, causing multiple simultaneous dashboard connections to the broker. Client is now created once and topics are resubscribed on reconnect.
- **Sensor boolean coercion** — fixed dashboard not updating relay states from live sensor messages. ESP32 sends `1`/`0` integers; the previous `typeof x === "boolean"` check silently ignored them.
- **LDR chart** — LDR values are now plotted on a dedicated right-side Y axis in the environment history chart.
- **Dashboard WS status** — status panel now shows live MQTT WebSocket connection state (`Connected` / `Connecting...`).
- **`GET /api/alerts`** — new endpoint to query the alert log from MongoDB.
- **ML retrain scheduling** — periodic 6-hour retrain no longer fires on startup before any training data exists. It now starts only after the first debounced retrain triggered by a manual override action.
- **Dead code removed** — `systemTopicFor` (duplicate of `controlTopicFor`), `isNightHour` (unused export), and `retrainModels` (unused external export) have been removed.
