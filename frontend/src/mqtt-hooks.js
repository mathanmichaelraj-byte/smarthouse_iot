/**
 * mqtt-hooks.js
 * Custom React hooks for MQTT over WebSockets.
 * Uses mqtt.js (npm install mqtt)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import mqtt from "mqtt";

const BROKER_WS = import.meta.env.VITE_MQTT_WS || "ws://broker.emqx.io:8083/mqtt";

// Singleton MQTT client shared across hooks
let sharedClient = null;
const subscribers = {};  // topic -> Set of callbacks

function getClient() {
  if (!sharedClient || sharedClient.disconnected) {
    sharedClient = mqtt.connect(BROKER_WS, {
      clientId: `react-dashboard-${Math.random().toString(16).slice(2)}`,
      clean:    true,
    });
    sharedClient.on("connect",    () => console.log("[MQTT] Connected to broker"));
    sharedClient.on("error",      (e) => console.error("[MQTT] Error:", e.message));
    sharedClient.on("message",    (topic, payload) => {
      const msg = payload.toString();
      (subscribers[topic] || []).forEach((cb) => cb(msg, topic));
    });
  }
  return sharedClient;
}

// ─── useMQTTSubscribe ────────────────────────────────────
/**
 * Subscribe to an MQTT topic and receive messages.
 * @param {string}   topic
 * @param {function} onMessage  (msg: string, topic: string) => void
 */
export function useMQTTSubscribe(topic, onMessage) {
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage;

  useEffect(() => {
    if (!topic) return;
    const client = getClient();
    const handler = (msg, t) => cbRef.current(msg, t);

    if (!subscribers[topic]) subscribers[topic] = new Set();
    subscribers[topic].add(handler);
    client.subscribe(topic);

    return () => {
      subscribers[topic]?.delete(handler);
      if (subscribers[topic]?.size === 0) {
        client.unsubscribe(topic);
        delete subscribers[topic];
      }
    };
  }, [topic]);
}

// ─── useMQTTPublish ──────────────────────────────────────
/**
 * Returns a stable publish function.
 * @returns {function} publish(topic: string, message: string) => void
 */
export function useMQTTPublish() {
  return useCallback((topic, message) => {
    getClient().publish(topic, message);
  }, []);
}

// ─── useSensorData ───────────────────────────────────────
/**
 * Convenience hook: returns latest sensor reading for a device.
 * @param {string} device  e.g. "home1"
 * @returns {{ temp, humidity, motion, light_on, fan_on } | null}
 */
export function useSensorData(device = "home1") {
  const [data, setData] = useState(null);
  useMQTTSubscribe(`${device}/sensor`, (msg) => {
    try { setData(JSON.parse(msg)); } catch {}
  });
  return data;
}

// ─── useDeviceAck ─────────────────────────────────────────
/**
 * Tracks acknowledged device state (light, fan, etc.)
 * @param {string} device  e.g. "home1"
 * @param {string} type    e.g. "light" | "fan"
 * @returns {string}  "ON" | "OFF" | "unknown"
 */
export function useDeviceAck(device, type) {
  const [state, setState] = useState("unknown");
  useMQTTSubscribe(`${device}/${type}/ack`, (msg) => setState(msg));
  return state;
}
