import { useCallback, useEffect, useRef, useState } from "react";
import mqtt from "mqtt";

const BROKER_WS = import.meta.env.VITE_MQTT_WS || "ws://broker.hivemq.com:8000/mqtt";

let sharedClient = null;
const subscribers = {};

function getClient() {
  if (!sharedClient || sharedClient.disconnected) {
    sharedClient = mqtt.connect(BROKER_WS, {
      clientId: `smart-home-dashboard-${Math.random().toString(16).slice(2)}`,
      clean: true,
      reconnectPeriod: 1000,
    });

    sharedClient.on("connect", () => console.log("[MQTT] Connected"));
    sharedClient.on("reconnect", () => console.log("[MQTT] Reconnecting"));
    sharedClient.on("error", (error) => console.error("[MQTT] Error:", error.message));
    sharedClient.on("message", (topic, payload) => {
      const handlers = subscribers[topic];
      if (!handlers) return;

      const message = payload.toString();
      handlers.forEach((callback) => callback(message, topic));
    });
  }

  return sharedClient;
}

export function useMQTTSubscribe(topic, onMessage) {
  const callbackRef = useRef(onMessage);
  callbackRef.current = onMessage;

  useEffect(() => {
    if (!topic) return undefined;

    const client = getClient();
    const handler = (message, currentTopic) => callbackRef.current(message, currentTopic);

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

export function useMQTTPublish() {
  return useCallback((topic, message, options) => {
    getClient().publish(topic, message, options);
  }, []);
}

export function useMQTTTopicState(topic, initialValue = null) {
  const [value, setValue] = useState(initialValue);
  useMQTTSubscribe(topic, (message) => setValue(message));
  return value;
}
