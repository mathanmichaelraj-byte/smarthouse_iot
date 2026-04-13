/**
 * Dashboard.js
 * Main smart home dashboard: live sensor data, device controls, charts, anomaly alerts.
 */

import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  useDeviceAck,
  useMQTTPublish,
  useMQTTSubscribe,
} from "./mqtt-hooks";

const API = import.meta.env.VITE_API || "http://localhost:3001";
const DEVICE = "home1";

// ─── CONTROL BUTTON ──────────────────────────────────────
function DeviceToggle({ label, device, type }) {
  const publish = useMQTTPublish();
  const ackState = useDeviceAck(device, type);
  const isOn = ackState === "ON";

  return (
    <div style={styles.card}>
      <span style={styles.cardLabel}>{label}</span>
      <div style={{ ...styles.badge, background: isOn ? "#22c55e" : "#64748b" }}>
        {ackState}
      </div>
      <div style={styles.btnRow}>
        <button style={styles.btnOn} onClick={() => publish(`${device}/${type}`, "ON")}>
          ON
        </button>
        <button style={styles.btnOff} onClick={() => publish(`${device}/${type}`, "OFF")}>
          OFF
        </button>
      </div>
    </div>
  );
}

// ─── SENSOR CARD ─────────────────────────────────────────
function SensorCard({ label, value, unit, color }) {
  return (
    <div style={{ ...styles.card, borderTop: `3px solid ${color}` }}>
      <span style={styles.cardLabel}>{label}</span>
      <span style={{ fontSize: 32, fontWeight: 700, color }}>
        {value ?? "–"}
        <span style={{ fontSize: 14, color: "#94a3b8" }}> {unit}</span>
      </span>
    </div>
  );
}

// ─── MAIN DASHBOARD ──────────────────────────────────────
export default function Dashboard() {
  const [history, setHistory] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [ruleFire, setRuleFire] = useState([]);
  const [temp, setTemp] = useState(null);
  const [humidity, setHumidity] = useState(null);
  const [motion, setMotion] = useState(null);

  // Load initial cards + chart history from backend
  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        const [devicesRes, readingsRes] = await Promise.all([
          fetch(`${API}/api/devices`),
          fetch(`${API}/api/readings?device=${DEVICE}&limit=60`),
        ]);

        const devices = await devicesRes.json();
        const readings = await readingsRes.json();

        if (cancelled) return;

        if (Array.isArray(devices) && devices.length > 0) {
          const d = devices[0];
          setTemp(d.temp ?? null);
          setHumidity(d.humidity ?? null);
          setMotion(d.motion ?? null);
        }

        if (Array.isArray(readings)) {
          const mapped = readings.map((d) => ({
            time: new Date(d.timestamp).toLocaleTimeString(),
            temp: d.temp,
            humidity: d.humidity,
            motion: d.motion ? 1 : 0,
          }));
          setHistory(mapped);
        }
      } catch {
        // keep UI usable even if API is temporarily unavailable
      }
    }

    loadInitialData();

    return () => {
      cancelled = true;
    };
  }, []);

  // One sensor subscription updates both cards and graph
  useMQTTSubscribe(`${DEVICE}/sensor`, (msg) => {
    try {
      const d = JSON.parse(msg);

      setTemp(d.temp ?? null);
      setHumidity(d.humidity ?? null);
      setMotion(d.motion ?? null);

      setHistory((prev) => [
        ...prev.slice(-59),
        {
          time: new Date().toLocaleTimeString(),
          temp: d.temp,
          humidity: d.humidity,
          motion: d.motion ? 1 : 0,
        },
      ]);
    } catch {
      // ignore malformed payloads
    }
  });

  // These will work only if your backend publishes MQTT topics for them
  useMQTTSubscribe(`${DEVICE}/anomaly`, (msg) => {
    setAlerts((prev) => [{ msg, ts: new Date().toLocaleTimeString() }, ...prev.slice(0, 4)]);
  });

  useMQTTSubscribe(`${DEVICE}/rule_triggered`, (msg) => {
    setRuleFire((prev) => [{ msg, ts: new Date().toLocaleTimeString() }, ...prev.slice(0, 4)]);
  });

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>🏠 Smart Home Dashboard</h1>
      <p style={styles.sub}>
        Device: <b>{DEVICE}</b> · Live MQTT
      </p>

      <section style={styles.row}>
        <SensorCard label="Temperature" value={temp} unit="°C" color="#f97316" />
        <SensorCard label="Humidity" value={humidity} unit="%" color="#3b82f6" />
        <SensorCard
          label="Motion"
          value={motion === null ? null : motion ? "YES" : "NO"}
          unit=""
          color="#a855f7"
        />
      </section>

      <section style={styles.row}>
        <DeviceToggle label="💡 Light" device={DEVICE} type="light" />
        <DeviceToggle label="🌀 Fan" device={DEVICE} type="fan" />
        <DeviceToggle label="🏠 All" device={DEVICE} type="all" />
      </section>

      <div style={styles.chartBox}>
        <h2 style={styles.sectionTitle}>Sensor History</h2>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={history} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#94a3b8" }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
            <Legend />
            <Line type="monotone" dataKey="temp" stroke="#f97316" dot={false} name="Temp (°C)" />
            <Line type="monotone" dataKey="humidity" stroke="#3b82f6" dot={false} name="Humidity (%)" />
            <Line type="monotone" dataKey="motion" stroke="#a855f7" dot={false} name="Motion" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {alerts.length > 0 && (
        <div style={styles.alertBox}>
          <h2 style={{ ...styles.sectionTitle, color: "#ef4444" }}>⚠️ Anomaly Alerts</h2>
          {alerts.map((a, i) => (
            <div key={i} style={styles.alertItem}>
              [{a.ts}] {a.msg}
            </div>
          ))}
        </div>
      )}

      {ruleFire.length > 0 && (
        <div style={styles.alertBox}>
          <h2 style={{ ...styles.sectionTitle, color: "#22c55e" }}>⚡ Rule Triggered</h2>
          {ruleFire.map((r, i) => (
            <div key={i} style={styles.alertItem}>
              [{r.ts}] {r.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── INLINE STYLES ───────────────────────────────────────
const styles = {
  page: {
    background: "#0f172a",
    minHeight: "100vh",
    padding: "24px 32px",
    fontFamily: "'JetBrains Mono', monospace",
    color: "#e2e8f0",
  },
  title: { fontSize: 28, fontWeight: 800, marginBottom: 4, letterSpacing: "-0.5px" },
  sub: { color: "#64748b", marginBottom: 28, fontSize: 13 },
  row: { display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 },
  card: {
    background: "#1e293b",
    borderRadius: 12,
    padding: "20px 24px",
    minWidth: 160,
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  cardLabel: {
    fontSize: 12,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  badge: {
    display: "inline-block",
    borderRadius: 6,
    padding: "2px 10px",
    fontSize: 12,
    fontWeight: 700,
    alignSelf: "flex-start",
  },
  btnRow: { display: "flex", gap: 8 },
  btnOn: {
    flex: 1,
    padding: "8px 0",
    borderRadius: 8,
    border: "none",
    background: "#22c55e",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 13,
  },
  btnOff: {
    flex: 1,
    padding: "8px 0",
    borderRadius: 8,
    border: "none",
    background: "#ef4444",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 13,
  },
  chartBox: { background: "#1e293b", borderRadius: 12, padding: 24, marginBottom: 24 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 16,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: "#94a3b8",
  },
  alertBox: { background: "#1e293b", borderRadius: 12, padding: 20, marginBottom: 20 },
  alertItem: {
    fontSize: 13,
    padding: "6px 0",
    borderBottom: "1px solid #0f172a",
    color: "#fbbf24",
  },
};