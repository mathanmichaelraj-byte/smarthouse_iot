import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useMQTTPublish, useMQTTSubscribe } from "./mqtt-hooks";

const API = import.meta.env.VITE_API || "http://localhost:3001";
const DEVICE = "home1";
const HISTORY_LIMIT = 60;

const DEVICE_CONFIG = [
  { key: "light1", label: "Light 1", accent: "#f59e0b" },
  { key: "light2", label: "Light 2", accent: "#f97316" },
  { key: "fan1", label: "Fan 1", accent: "#38bdf8" },
  { key: "fan2", label: "Fan 2", accent: "#22d3ee" },
];

const EMPTY_DEVICE_STATE = {
  light1: false,
  light2: false,
  fan1: false,
  fan2: false,
};

function SensorCard({ label, value, unit, accent }) {
  return (
    <div style={{ ...styles.card, borderTop: `3px solid ${accent}` }}>
      <span style={styles.eyebrow}>{label}</span>
      <span style={styles.sensorValue}>
        {value ?? "--"}
        {unit ? <span style={styles.sensorUnit}> {unit}</span> : null}
      </span>
    </div>
  );
}

function DeviceCard({ label, target, accent, isOn, onChange }) {
  return (
    <div style={styles.deviceCard}>
      <div style={styles.deviceHeader}>
        <span style={styles.deviceLabel}>{label}</span>
        <span
          style={{
            ...styles.deviceBadge,
            background: isOn ? `${accent}22` : "#334155",
            color: isOn ? accent : "#94a3b8",
            borderColor: isOn ? `${accent}66` : "#475569",
          }}
        >
          {isOn ? "ON" : "OFF"}
        </span>
      </div>

      <div style={styles.buttonRow}>
        <button style={{ ...styles.button, ...styles.onButton }} onClick={() => onChange(target, true)}>
          Turn On
        </button>
        <button style={{ ...styles.button, ...styles.offButton }} onClick={() => onChange(target, false)}>
          Turn Off
        </button>
      </div>

      <div style={styles.deviceHint}>Manual override topic · cooldown 5 min</div>
    </div>
  );
}

export default function Dashboard() {
  const publish = useMQTTPublish();
  const [sensor, setSensor] = useState({
    temp: null,
    humidity: null,
    motion: null,
  });
  const [deviceStates, setDeviceStates] = useState(EMPTY_DEVICE_STATE);
  const [history, setHistory] = useState([]);
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        const [devicesResponse, readingsResponse] = await Promise.all([
          fetch(`${API}/api/devices`),
          fetch(`${API}/api/readings?device=${DEVICE}&limit=${HISTORY_LIMIT}`),
        ]);

        const [devices, readings] = await Promise.all([
          devicesResponse.json(),
          readingsResponse.json(),
        ]);

        if (cancelled) return;

        const currentDevice = Array.isArray(devices) ? devices.find((item) => item.device === DEVICE) : null;
        if (currentDevice) {
          setSensor({
            temp: currentDevice.temp ?? null,
            humidity: currentDevice.humidity ?? null,
            motion: currentDevice.motion ?? null,
          });
          setDeviceStates({
            light1: Boolean(currentDevice.light1),
            light2: Boolean(currentDevice.light2),
            fan1: Boolean(currentDevice.fan1),
            fan2: Boolean(currentDevice.fan2),
          });
        }

        if (Array.isArray(readings)) {
          setHistory(
            readings.map((reading) => ({
              time: new Date(reading.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              }),
              temp: reading.temp,
              humidity: reading.humidity,
            }))
          );

          const latest = readings[readings.length - 1];
          if (!currentDevice && latest) {
            setSensor({
              temp: latest.temp ?? null,
              humidity: latest.humidity ?? null,
              motion: latest.motion ?? null,
            });
            setDeviceStates({
              light1: Boolean(latest.light1),
              light2: Boolean(latest.light2),
              fan1: Boolean(latest.fan1),
              fan2: Boolean(latest.fan2),
            });
          }
        }
      } catch (error) {
        console.error("[Dashboard] Initial load failed:", error.message);
      }
    }

    loadInitialData();

    return () => {
      cancelled = true;
    };
  }, []);

  useMQTTSubscribe(`${DEVICE}/sensor`, (message) => {
    try {
      const parsed = JSON.parse(message);
      setSensor({
        temp: parsed.temp ?? null,
        humidity: parsed.humidity ?? null,
        motion: parsed.motion ?? null,
      });
      setDeviceStates((previous) => ({
        ...previous,
        light1: typeof parsed.light1 === "boolean" ? parsed.light1 : previous.light1,
        light2: typeof parsed.light2 === "boolean" ? parsed.light2 : previous.light2,
        fan1: typeof parsed.fan1 === "boolean" ? parsed.fan1 : previous.fan1,
        fan2: typeof parsed.fan2 === "boolean" ? parsed.fan2 : previous.fan2,
      }));
      setHistory((previous) => [
        ...previous.slice(-(HISTORY_LIMIT - 1)),
        {
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          temp: parsed.temp,
          humidity: parsed.humidity,
        },
      ]);
    } catch (error) {
      console.error("[Dashboard] Bad sensor payload:", error.message);
    }
  });

  useMQTTSubscribe(`${DEVICE}/alert`, (message) => {
    setAlerts((previous) => [
      {
        message,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      },
      ...previous.slice(0, 4),
    ]);
  });

  useMQTTSubscribe(`${DEVICE}/light1`, (message) => {
    setDeviceStates((previous) => ({ ...previous, light1: message === "ON" }));
  });
  useMQTTSubscribe(`${DEVICE}/light2`, (message) => {
    setDeviceStates((previous) => ({ ...previous, light2: message === "ON" }));
  });
  useMQTTSubscribe(`${DEVICE}/fan1`, (message) => {
    setDeviceStates((previous) => ({ ...previous, fan1: message === "ON" }));
  });
  useMQTTSubscribe(`${DEVICE}/fan2`, (message) => {
    setDeviceStates((previous) => ({ ...previous, fan2: message === "ON" }));
  });

  const latestAlert = alerts[0] || null;
  const motionLabel = sensor.motion === null ? "Unknown" : sensor.motion ? "Detected" : "Clear";

  function handleManualChange(target, nextState) {
    publish(`${DEVICE}/${target}_manual`, nextState ? "ON" : "OFF");
  }

  return (
    <div style={styles.page}>
      <div style={styles.hero}>
        <div>
          <div style={styles.kicker}>Self-Learning Smart Home</div>
          <h1 style={styles.title}>Device automation with manual override and live alerts</h1>
          <p style={styles.subtitle}>
            Home ID <strong>{DEVICE}</strong> · MQTT live control · Manual actions pause automation for 5 minutes
          </p>
        </div>
      </div>

      {latestAlert ? (
        <div style={styles.alertBanner}>
          <div style={styles.alertLabel}>ALERT</div>
          <div style={styles.alertContent}>
            <strong>{latestAlert.message}</strong>
            <span style={styles.alertMeta}>Received at {latestAlert.time}</span>
          </div>
        </div>
      ) : null}

      <section style={styles.sensorGrid}>
        <SensorCard label="Temperature" value={sensor.temp} unit="°C" accent="#f97316" />
        <SensorCard label="Humidity" value={sensor.humidity} unit="%" accent="#38bdf8" />
        <SensorCard label="Motion" value={motionLabel} unit="" accent="#22c55e" />
      </section>

      <section style={styles.controlsGrid}>
        {DEVICE_CONFIG.map((device) => (
          <DeviceCard
            key={device.key}
            label={device.label}
            target={device.key}
            accent={device.accent}
            isOn={deviceStates[device.key]}
            onChange={handleManualChange}
          />
        ))}
      </section>

      <section style={styles.chartCard}>
        <div style={styles.sectionHeader}>
          <div>
            <div style={styles.sectionEyebrow}>Environment History</div>
            <h2 style={styles.sectionTitle}>Real-time temperature and humidity</h2>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={history}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="time" tick={{ fill: "#94a3b8", fontSize: 11 }} minTickGap={24} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
            <Tooltip contentStyle={styles.tooltip} />
            <Legend />
            <Line type="monotone" dataKey="temp" stroke="#f97316" strokeWidth={3} dot={false} name="Temp (°C)" />
            <Line type="monotone" dataKey="humidity" stroke="#38bdf8" strokeWidth={3} dot={false} name="Humidity (%)" />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <section style={styles.alertsCard}>
        <div style={styles.sectionEyebrow}>Alert Stream</div>
        <h2 style={styles.sectionTitle}>Recent notifications</h2>

        {alerts.length === 0 ? (
          <div style={styles.emptyState}>No live alerts yet. The banner will light up when `home1/alert` receives a message.</div>
        ) : (
          alerts.map((alert, index) => (
            <div key={`${alert.time}-${index}`} style={styles.alertRow}>
              <span style={styles.alertTimestamp}>{alert.time}</span>
              <span style={styles.alertMessage}>{alert.message}</span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    padding: "28px 24px 40px",
    background:
      "radial-gradient(circle at top left, rgba(56,189,248,0.18), transparent 26%), linear-gradient(180deg, #07111f 0%, #0f172a 50%, #111827 100%)",
    color: "#e5eef9",
    fontFamily: "'JetBrains Mono', monospace",
  },
  hero: {
    marginBottom: 22,
    padding: "28px",
    borderRadius: 24,
    background: "linear-gradient(135deg, rgba(15,23,42,0.96), rgba(17,24,39,0.92))",
    border: "1px solid rgba(148,163,184,0.18)",
    boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
  },
  kicker: {
    fontSize: 12,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: "#38bdf8",
    marginBottom: 10,
  },
  title: {
    margin: "0 0 10px",
    fontSize: "clamp(28px, 4vw, 44px)",
    lineHeight: 1.05,
    maxWidth: 760,
  },
  subtitle: {
    margin: 0,
    color: "#93a4bb",
    fontSize: 14,
    maxWidth: 700,
  },
  alertBanner: {
    display: "flex",
    gap: 14,
    alignItems: "stretch",
    flexWrap: "wrap",
    marginBottom: 22,
    borderRadius: 18,
    overflow: "hidden",
    border: "1px solid rgba(248,113,113,0.35)",
    background: "linear-gradient(90deg, rgba(127,29,29,0.96), rgba(69,10,10,0.9))",
  },
  alertLabel: {
    padding: "18px 20px",
    background: "rgba(248,113,113,0.2)",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 2,
  },
  alertContent: {
    flex: 1,
    minWidth: 220,
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  alertMeta: {
    color: "#fecaca",
    fontSize: 12,
  },
  sensorGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: 16,
    marginBottom: 20,
  },
  controlsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 16,
    marginBottom: 20,
  },
  card: {
    background: "rgba(15,23,42,0.8)",
    borderRadius: 18,
    padding: "20px 22px",
    border: "1px solid rgba(148,163,184,0.12)",
  },
  eyebrow: {
    display: "block",
    marginBottom: 10,
    color: "#8fa4bd",
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  sensorValue: {
    fontSize: 32,
    fontWeight: 700,
  },
  sensorUnit: {
    fontSize: 14,
    color: "#94a3b8",
  },
  deviceCard: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    background: "rgba(15,23,42,0.84)",
    borderRadius: 18,
    padding: "20px 22px",
    border: "1px solid rgba(148,163,184,0.12)",
  },
  deviceHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  deviceLabel: {
    fontSize: 18,
    fontWeight: 700,
  },
  deviceBadge: {
    borderRadius: 999,
    border: "1px solid transparent",
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 1,
  },
  buttonRow: {
    display: "flex",
    gap: 10,
  },
  button: {
    flex: 1,
    border: "none",
    borderRadius: 12,
    padding: "12px 10px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    transition: "transform 120ms ease, opacity 120ms ease",
  },
  onButton: {
    background: "#16a34a",
    color: "#f8fafc",
  },
  offButton: {
    background: "#dc2626",
    color: "#f8fafc",
  },
  deviceHint: {
    color: "#8fa4bd",
    fontSize: 12,
  },
  chartCard: {
    marginBottom: 20,
    padding: "20px 22px",
    borderRadius: 20,
    background: "rgba(15,23,42,0.84)",
    border: "1px solid rgba(148,163,184,0.12)",
  },
  alertsCard: {
    padding: "20px 22px",
    borderRadius: 20,
    background: "rgba(15,23,42,0.84)",
    border: "1px solid rgba(148,163,184,0.12)",
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  sectionEyebrow: {
    color: "#8fa4bd",
    fontSize: 12,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 20,
  },
  tooltip: {
    background: "#020617",
    border: "1px solid #334155",
    borderRadius: 10,
  },
  alertRow: {
    display: "grid",
    gridTemplateColumns: "90px 1fr",
    gap: 12,
    padding: "12px 0",
    borderTop: "1px solid rgba(148,163,184,0.12)",
  },
  alertTimestamp: {
    color: "#fca5a5",
    fontSize: 12,
    fontWeight: 700,
  },
  alertMessage: {
    color: "#f8fafc",
    fontSize: 14,
    lineHeight: 1.5,
  },
  emptyState: {
    color: "#94a3b8",
    fontSize: 14,
    lineHeight: 1.6,
  },
};
