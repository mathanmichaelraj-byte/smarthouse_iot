# 🏠 AI-Based Predictive Smart Home Automation System

> An end-to-end IoT system using **ESP32**, **MQTT**, **Node.js**, **Python ML**, and **React** — with virtual simulation support via Wokwi before any hardware deployment.

![Version](https://img.shields.io/badge/version-1.5.0-blue) ![Status](https://img.shields.io/badge/status-active-green) ![DB](https://img.shields.io/badge/database-MongoDB%20Atlas-brightgreen)

---

## 📑 Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Hardware Components](#hardware-components)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Backend Setup](#backend-setup)
  - [Frontend Setup](#frontend-setup)
  - [Firmware Setup](#firmware-setup)
- [Virtual Testing (No Hardware Required)](#virtual-testing-no-hardware-required)
- [MQTT Topics](#mqtt-topics)
- [Machine Learning Modules](#machine-learning-modules)
- [API Reference](#api-reference)
- [Environment Variables](#environment-variables)
- [Moving to Real Hardware](#moving-to-real-hardware)
- [Contributing](#contributing)
- [Changelog](#changelog)
- [License](#license)

---

## Overview

This project implements a **fully code-driven smart home automation system** with predictive AI capabilities. A single ESP32 microcontroller reads temperature, humidity, and motion data and controls lights and fans via relay modules — all orchestrated over MQTT.

The system **learns from user behaviour** using Decision Trees, **detects anomalies** using Isolation Forest, and **automates devices** based on rules and predictions — all visible through a live React dashboard.

**Estimated hardware cost: ₹800 – ₹1500**
**Fully simulatable for ₹0 using Wokwi + MQTTLab**

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Smart Home Network                        │
│                                                                  │
│  ┌──────────┐      WiFi/MQTT       ┌──────────────────────────┐ │
│  │  ESP32   │ ─────────────────▶   │    MQTT Broker           │ │
│  │          │                      │  (broker.emqx.io)        │ │
│  │ DHT11    │ ◀─────────────────   │                          │ │
│  │ PIR      │   Control Commands   └──────────┬───────────────┘ │
│  │ Relay×2  │                                 │                  │
│  └──────────┘                                 ▼                  │
│                                    ┌──────────────────────────┐ │
│                                    │   Node.js Backend        │ │
│                                    │                          │ │
│                                    │  • MQTT Client           │ │
│                                    │  • Rule Engine           │ │
│                                    │  • REST API              │ │
│                                    │  • Socket.IO             │ │
│                                    └───┬──────────┬───────────┘ │
│                                        │          │              │
│                              ┌─────────▼─┐   ┌───▼──────────┐  │
│                              │  MongoDB  │   │  Python ML   │  │
│                              │           │   │              │  │
│                              │ Readings  │   │ DecisionTree │  │
│                              │ DevState  │   │ IsoForest    │  │
│                              └───────────┘   └──────────────┘  │
│                                                    │             │
│                                    ┌───────────────▼──────────┐ │
│                                    │   React Dashboard        │ │
│                                    │                          │ │
│                                    │  • Live sensor charts    │ │
│                                    │  • Device toggles        │ │
│                                    │  • Anomaly alerts        │ │
│                                    │  • Rule trigger log      │ │
│                                    └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Features

| Feature | Description |
|---|---|
| 🌡️ **Live sensor monitoring** | Temperature, humidity, and motion data every 5 seconds |
| 💡 **Device control** | Toggle light and fan via MQTT from dashboard or REST API |
| 🧠 **Behaviour prediction** | Decision Tree predicts whether to turn on light based on time + motion |
| ⚠️ **Anomaly detection** | Isolation Forest flags unusual sensor readings in real time |
| ⚡ **Rule engine** | Custom if-then rules (e.g. "temp > 30 → fan ON") with runtime evaluation |
| 📊 **Live charts** | Real-time temperature/humidity/motion time-series in React dashboard |
| 🔁 **Auto-retraining** | ML models retrain every 6 hours from collected data |
| 📱 **WebSocket push** | Dashboard updates instantly via Socket.IO — no polling |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Firmware** | Arduino C++ / MicroPython on ESP32 |
| **Communication** | MQTT (PubSubClient / umqtt.simple) |
| **Backend** | Node.js, Express, MQTT.js, Socket.IO |
| **Database** | MongoDB (Mongoose ODM) |
| **ML** | Python, scikit-learn (DecisionTree, IsolationForest), pandas |
| **Frontend** | React, recharts, mqtt.js over WebSocket |
| **Simulation** | Wokwi, MQTT Explorer, HiveMQ WebSocket Client |

---

## Hardware Components

| Component | Qty | Cost (₹) |
|---|---|---|
| ESP32 DevKit V1 | 1 | 300 – 500 |
| 2-Channel Relay Module (5V) | 1 | 150 – 300 |
| PIR Motion Sensor (HC-SR501) | 1 | 80 – 120 |
| DHT11 Temp/Humidity Sensor | 1 | 80 – 150 |
| Breadboard + Jumper Wires + Resistors | — | 200 – 300 |
| **Total** | | **₹800 – ₹1500** |

### Wiring Summary

```
DHT11  → DATA: GPIO4   VCC: 3.3V   GND: GND   (+ 10K pull-up on DATA)
PIR    → OUT:  GPIO27  VCC: 3.3V   GND: GND
Relay1 → IN1:  GPIO13  VCC: 5V(VIN) GND: GND
Relay2 → IN2:  GPIO12  VCC: 5V(VIN) GND: GND
```

---

## Project Structure

```
smart-home-automation/
│
├── firmware/ESP32/
│   ├── main.ino              # Arduino C++ firmware
│   └── main.py               # MicroPython alternative
│
├── backend/
│   ├── mqtt-server/
│   │   ├── index.js          # Main server (MQTT + Express + Socket.IO)
│   │   ├── init_mongodb.js   # DB init + indexes (run once via npm run init-db)
│   │   ├── rules.js          # Rule engine
│   │   ├── ml_integration.js # Node → Python ML bridge
│   │   └── package.json
│   ├── python-ml/
│   │   ├── train.py          # Train DecisionTree + IsolationForest
│   │   ├── predict.py        # Called per sensor reading
│   │   └── anomaly.py        # Anomaly detection inference
│   └── database/
│       └── (init_mongodb.js moved to mqtt-server/)
│
├── frontend/
│   ├── index.html            # Vite entry HTML
│   ├── vite.config.js        # Vite + React plugin config
│   ├── package.json
│   └── src/
│       ├── main.jsx          # React root (createRoot)
│       ├── App.jsx
│       ├── Dashboard.jsx     # Main dashboard component
│       └── mqtt-hooks.js     # useMQTTSubscribe, useMQTTPublish hooks
│
├── .env.example              # Environment variable template
└── README.md
```

---

## Getting Started

### Prerequisites

Install the following before anything else:

- [Node.js v18+](https://nodejs.org)
- [Python 3.10+](https://python.org)
- [MongoDB Community](https://www.mongodb.com/try/download/community) (or use [Atlas free tier](https://www.mongodb.com/atlas))
- [Arduino IDE 2.x](https://www.arduino.cc/en/software) with ESP32 board package
- Arduino libraries: `PubSubClient`, `DHT sensor library` (Adafruit), `ArduinoJson`

**Add ESP32 board to Arduino IDE:**
1. Go to File → Preferences
2. Add this URL to "Additional Boards Manager URLs":
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Go to Tools → Board → Boards Manager → search "esp32" → Install

---

### Backend Setup

```bash
# 1. Clone the repo
git clone https://github.com/mathanmichaelraj-byte/smart-home-automation.git
cd smart-home-automation

# 2. Install Node.js dependencies
cd backend/mqtt-server
npm install

# 3. Copy and configure environment variables
cp ../../.env.example .env
# Edit .env — set MQTT_BROKER, MONGO_URI, PORT

# 4. Initialize MongoDB (run once)
# All commands run from inside mqtt-server/ so node_modules is always found
npm run init-db

# 5. Install Python dependencies and train ML models (run once)
cd ../python-ml
pip install scikit-learn pandas numpy
python train.py
# → Creates model_decision_tree.pkl and model_iso_forest.pkl

# 6. Start the backend
cd ../mqtt-server
npm start
# → Backend running on http://localhost:3001
```

---

### Frontend Setup

Open a **second terminal window**:

```bash
cd frontend

# Set environment variables
echo "VITE_API=http://localhost:3001" >> .env
echo "VITE_MQTT_WS=ws://broker.emqx.io:8083/mqtt" >> .env


# Install all dependencies (React, Vite, mqtt, recharts, socket.io-client)
npm install

# Start the dev server
npm start
# → Dashboard at http://localhost:3000
```

**npm scripts (run from `frontend/`):**

| Script | Description |
|---|---|
| `npm start` | Start Vite dev server at http://localhost:3000 |
| `npm run dev` | Same as start |
| `npm run build` | Build for production (outputs to `dist/`) |
| `npm run preview` | Preview the production build locally |

---

### Firmware Setup

1. Open `firmware/ESP32/main.ino` in Arduino IDE
2. Update your WiFi credentials:
   ```cpp
   const char* ssid     = "YourActualSSID";
   const char* password = "YourActualPassword";
   ```
3. Select: **Tools → Board → ESP32 Dev Module**
4. Select the correct **Port** (COM on Windows, /dev/ttyUSB on Linux)
5. Click **Upload**
6. Open **Serial Monitor** at baud `115200` and verify connection

---

## Virtual Testing (No Hardware Required)

You can simulate the entire system before buying any hardware.

### Step 1 — Wokwi (ESP32 + sensor simulation)

1. Go to [wokwi.com](https://wokwi.com) → **New Project → ESP32**
2. In the diagram editor, add:
   - **DHT22** sensor → DATA pin → GPIO4
   - **PIR sensor** → OUT pin → GPIO27
   - **LED** (simulates relay) → GPIO13
3. Paste the contents of `main.ino` into the code editor
4. Change `ssid` to `"Wokwi-GUEST"` (leave password blank)
5. Click **▶ Run** — you'll see sensor data publishing in the Serial Monitor

### Step 2 — MQTT Explorer (monitor all messages)

1. Download [MQTT Explorer](https://mqtt-explorer.com)
2. Connect to `broker.emqx.io` on port `1883`
3. Subscribe to `home1/#`
4. Watch live sensor payloads from your Wokwi simulation
5. **Manually publish** `ON` or `OFF` to `home1/light` and watch the LED toggle in Wokwi

### Step 3 — Verify backend & dashboard

With Wokwi running and MQTT Explorer connected:
- Open `http://localhost:3001/api/readings` — should show sensor records
- Open `http://localhost:3000` — dashboard should display live sensor data and respond to toggles

### Step 4 — Load test with MQTTLab (optional)

Use [MQTTLab (IoTIFY)](https://mqttlab.iotsim.io) to simulate multiple virtual devices publishing simultaneously and verify your Node.js backend handles the load correctly.

---

## MQTT Topics

| Topic | Direction | Payload | Description |
|---|---|---|---|
| `home1/sensor` | ESP32 → Broker | JSON | Temperature, humidity, motion, device state |
| `home1/light` | Broker → ESP32 | `ON` / `OFF` | Control the light relay |
| `home1/fan` | Broker → ESP32 | `ON` / `OFF` | Control the fan relay |
| `home1/all` | Broker → ESP32 | `ON` / `OFF` | Control all devices at once |
| `home1/light/ack` | ESP32 → Broker | `ON` / `OFF` | Acknowledge light state change |
| `home1/fan/ack` | ESP32 → Broker | `ON` / `OFF` | Acknowledge fan state change |

**Example sensor payload:**
```json
{
  "device": "home1",
  "temp": 27.4,
  "humidity": 62.1,
  "motion": true,
  "light_on": false,
  "fan_on": true
}
```

---

## Machine Learning Modules

### Decision Tree — behaviour prediction

Trained on historical sensor readings to predict whether the light should be ON based on:
- Hour of day
- Temperature
- Humidity
- Motion detected

```bash
# Train
python3 backend/python-ml/train.py

# Outputs:
# model_decision_tree.pkl  — loaded per sensor reading
# model_iso_forest.pkl     — loaded for anomaly detection
```

Models are automatically retrained every 6 hours by the Node.js backend.

### Isolation Forest — anomaly detection

Trained on normal behaviour patterns. Flags readings that deviate significantly (e.g. motion at 3AM in an empty house, sensor glitches, unusual temperature spikes).

### Default Rule Engine rules

```
IF hour >= 18 AND motion == true AND light_on == false  → home1/light = ON
IF hour >= 23                                           → home1/light = OFF
IF temp > 30 AND fan_on == false                        → home1/fan = ON
IF temp <= 26 AND fan_on == true                        → home1/fan = OFF
IF hour >= 9 AND hour <= 17 AND motion == false         → home1/light = OFF
```

Add custom rules in `backend/mqtt-server/rules.js`.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/devices` | All device states |
| `GET` | `/api/readings?device=home1&limit=100` | Historical sensor data |
| `POST` | `/api/control` | Manual device control |
| `GET` | `/api/rules` | List active rules |

**POST /api/control — example:**
```bash
curl -X POST http://localhost:3001/api/control \
  -H "Content-Type: application/json" \
  -d '{"device": "home1", "type": "light", "state": "ON"}'
```

---

## Environment Variables

Copy `.env.example` to `.env` in `backend/mqtt-server/` and fill in your values:

```env
# Backend (backend/mqtt-server/.env)
MQTT_BROKER=mqtt://broker.emqx.io
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/smarthome?retryWrites=true&w=majority
PORT=3001

# Frontend (frontend/.env)
# Note: Vite requires VITE_ prefix — REACT_APP_ does NOT work
VITE_API=http://localhost:3001
VITE_MQTT_WS=ws://broker.emqx.io:8083/mqtt
```

For production, replace `broker.emqx.io` with your own MQTT broker (e.g. [EMQX Cloud](https://www.emqx.com/en/cloud) free tier).

### Using MongoDB Atlas (Cloud)

If you're using MongoDB Atlas instead of a local MongoDB instance:

1. Log in to [cloud.mongodb.com](https://cloud.mongodb.com)
2. Go to your cluster → **Connect** → **Drivers** → copy the connection string
3. Replace the database name in the URI with `smarthome`:
   ```
   mongodb+srv://youruser:yourpassword@yourcluster.xxxxx.mongodb.net/smarthome?retryWrites=true&w=majority
   ```
4. Paste it as `MONGO_URI` in your `.env` file

> **Tip:** If you already use Atlas for another project, you can reuse the same cluster — just change the database name to `smarthome` in the URI. Atlas keeps databases fully isolated inside the same cluster.

---

## Moving to Real Hardware

Once virtual testing passes completely:

1. Update `ssid` and `password` in `main.ino` to your home WiFi
2. Wire components as described in [Wiring Summary](#wiring-summary)
3. Select the correct board and port in Arduino IDE
4. Flash the firmware — behaviour is identical to the Wokwi simulation
5. Open Serial Monitor at 115200 baud to confirm connection

> **Tip:** If your laptop and ESP32 are on the same WiFi network, you can also run the MQTT broker locally using [Mosquitto](https://mosquitto.org) instead of the public EMQX broker.

---

## npm Scripts Reference

All scripts run from `backend/mqtt-server/`:

| Script | Command | Description |
|---|---|---|
| `npm install` | — | Install all Node.js dependencies |
| `npm run init-db` | `node init_mongodb.js` | Create collections + indexes in MongoDB (run once) |
| `npm start` | `node index.js` | Start the backend server |
| `npm run dev` | `nodemon index.js` | Start with auto-restart on file changes |

---

## Contributing

Pull requests are welcome. For major changes, open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'Add your feature'`
4. Push and open a pull request

---

## Changelog

### v1.5.0 — Fix Vite/Plugin Version Conflict
- **Fixed** `ERESOLVE` npm install failure — `@vitejs/plugin-react@4.x` only supports Vite 4–7 but Vite 8 was already installed
- **Upgraded** `@vitejs/plugin-react` from `^4.3.1` → `^5.0.0` (first version with Vite 8 support)
- **Removed** stray `process` polyfill package from dependencies (was a wrong workaround for the `process is not defined` error, already fixed properly in v1.4.0 via `import.meta.env`)

### v1.4.0 — Fix Vite Environment Variables
- **Fixed** `process is not defined` crash on frontend startup — Vite does not polyfill Node.js globals like `process.env` (unlike Create React App)
- **Replaced** all `process.env.REACT_APP_*` references with `import.meta.env.VITE_*` in `mqtt-hooks.js` and `Dashboard.jsx`
- **Renamed** env keys in `frontend/.env` from `REACT_APP_API` / `REACT_APP_MQTT_WS` → `VITE_API` / `VITE_MQTT_WS`
- **Updated** Environment Variables section in README with Vite prefix note

### v1.3.0 — Frontend Scaffold Fix
- **Fixed** frontend had no build tool, no `scripts`, no `index.html`, and no entry point — `npm start` would have failed with no error message
- **Added** Vite + `@vitejs/plugin-react` as the build tool (replaces create-react-app)
- **Added** `vite.config.js` with React plugin and port set to 3000
- **Added** `index.html` in frontend root (required by Vite)
- **Added** `src/main.jsx` as the React entry point (`createRoot`)
- **Added** `start`, `dev`, `build`, `preview` scripts to `frontend/package.json`
- **Added** `react` and `react-dom` to `package.json` dependencies (were installed but undeclared)
- **Renamed** `App.js` → `App.jsx`, `Dashboard.js` → `Dashboard.jsx` for proper JSX extension
- **Updated** project structure and Frontend Setup section in README

### v1.2.0 — Fix Module Resolution
- **Fixed** `Cannot find module 'mongoose'` error that persisted even with `npm run init-db` — root cause: Node.js v24 resolves `require()` relative to the **script file's directory**, not npm's working directory, so `../database/init_mongodb.js` never had access to `mqtt-server/node_modules`
- **Moved** `init_mongodb.js` from `backend/database/` into `backend/mqtt-server/` so it sits alongside `node_modules`
- **Updated** `.env` path in `init_mongodb.js` from `../mqtt-server/.env` to `./.env` to match new location
- **Updated** `npm run init-db` script from `node ../database/init_mongodb.js` to `node init_mongodb.js`
- **Updated** project structure in README to reflect new file location

### v1.1.0 — Database & Dev Experience
- **Added** MongoDB Atlas support — reuse existing Atlas cluster by changing the database name in the URI to `smarthome`
- **Added** `npm run init-db` script to `package.json` so `init_mongodb.js` always runs with the correct `node_modules` from `mqtt-server/`, fixing the `Cannot find module 'mongoose'` error when running the script from the `database/` folder directly
- **Updated** Backend Setup instructions to use `npm run init-db` instead of `node ../database/init_mongodb.js`
- **Added** Atlas setup guide and shared-cluster tip to Environment Variables section
- **Added** npm Scripts Reference table

### v1.0.0 — Initial Release
- ESP32 firmware (Arduino C++ + MicroPython)
- Node.js backend with MQTT client, rule engine, REST API, Socket.IO
- Python ML modules: Decision Tree (prediction) + Isolation Forest (anomaly detection)
- React dashboard with live sensor charts and device toggles
- MongoDB schema with 30-day TTL on sensor readings
- Wokwi virtual simulation support

---

## License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">
  Built with ESP32 · MQTT · Node.js · Python · React
</div>