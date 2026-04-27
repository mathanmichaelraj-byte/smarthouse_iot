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
- live alerts and buzzer pulse for suspicious nighttime motion
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
- `GET /api/health`
  broker, MongoDB, and ML status summary

## Setup

### 1. Backend

```powershell
cd backend/mqtt-server
npm install
npm start
```

The backend starts:
- embedded MQTT TCP broker on `1883`
- embedded MQTT WebSocket broker on `8000`
- REST API on `3001`

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

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

## Finished State

The project is considered complete when:
- backend starts cleanly
- `npm run smoke-test` passes
- frontend loads and shows live status
- ESP32 logs `[SENSOR] Published OK`
- backend logs `[SENSOR] Reading stored in MongoDB`
