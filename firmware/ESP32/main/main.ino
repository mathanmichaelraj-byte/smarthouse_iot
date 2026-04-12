#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <ArduinoJson.h>

// ─── CONFIG ──────────────────────────────────────────────
const char* ssid       = "realme X7 5G";
const char* password   = "kapne7u4";
const char* mqttServer = "broker.emqx.io";
const int   mqttPort   = 1883;
const char* deviceId   = "home1";

// ─── PINS ────────────────────────────────────────────────
#define DHTPIN    4
#define DHTTYPE   DHT11
#define PIR_PIN   27
#define RELAY_LIGHT  13
#define RELAY_FAN    12

// ─── GLOBALS ─────────────────────────────────────────────
DHT dht(DHTPIN, DHTTYPE);
WiFiClient espClient;
PubSubClient client(espClient);

unsigned long lastSensorPublish = 0;
const unsigned long SENSOR_INTERVAL = 5000;  // 5 s

// ─── SETUP ───────────────────────────────────────────────
void setup() {
  Serial.begin(115200);

  pinMode(PIR_PIN, INPUT);
  pinMode(RELAY_LIGHT, OUTPUT);
  pinMode(RELAY_FAN, OUTPUT);
  digitalWrite(RELAY_LIGHT, LOW);
  digitalWrite(RELAY_FAN, LOW);

  dht.begin();
  connectWiFi();

  client.setServer(mqttServer, mqttPort);
  client.setCallback(mqttCallback);
}

// ─── LOOP ────────────────────────────────────────────────
void loop() {
  if (!client.connected()) reconnectMQTT();
  client.loop();

  if (millis() - lastSensorPublish >= SENSOR_INTERVAL) {
    lastSensorPublish = millis();
    publishSensorData();
  }
}

// ─── WiFi ─────────────────────────────────────────────────
void connectWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected. IP: " + WiFi.localIP().toString());
}

// ─── MQTT RECONNECT ──────────────────────────────────────
void reconnectMQTT() {
  while (!client.connected()) {
    Serial.print("Connecting MQTT...");
    String clientId = "esp32-" + String(deviceId) + "-" + String(random(0xffff), HEX);
    if (client.connect(clientId.c_str())) {
      Serial.println(" connected.");
      // Subscribe to all control topics
      client.subscribe("home1/light");
      client.subscribe("home1/fan");
      client.subscribe("home1/all");
    } else {
      Serial.print(" failed rc="); Serial.println(client.state());
      delay(3000);
    }
  }
}

// ─── PUBLISH SENSOR DATA ─────────────────────────────────
void publishSensorData() {
  float temp = dht.readTemperature();
  float humi = dht.readHumidity();

  if (isnan(temp) || isnan(humi)) {
    Serial.println("DHT read failed");
    return;
  }

  bool motion = (digitalRead(PIR_PIN) == HIGH);

  StaticJsonDocument<256> doc;
  doc["device"]    = deviceId;
  doc["temp"]      = round(temp * 10.0) / 10.0;
  doc["humidity"]  = round(humi * 10.0) / 10.0;
  doc["motion"]    = motion;
  doc["light_on"]  = (digitalRead(RELAY_LIGHT) == HIGH);
  doc["fan_on"]    = (digitalRead(RELAY_FAN) == HIGH);
  doc["timestamp"] = millis() / 1000;

  char buf[256];
  serializeJson(doc, buf);

  String topic = String(deviceId) + "/sensor";
  client.publish(topic.c_str(), buf);
  Serial.println("Published: " + String(buf));
}

// ─── MQTT CALLBACK ───────────────────────────────────────
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  msg.trim();

  Serial.println("CMD [" + String(topic) + "]: " + msg);

  if (String(topic) == "home1/light") {
    setRelay(RELAY_LIGHT, msg);
    client.publish("home1/light/ack", msg.c_str());
  }
  else if (String(topic) == "home1/fan") {
    setRelay(RELAY_FAN, msg);
    client.publish("home1/fan/ack", msg.c_str());
  }
  else if (String(topic) == "home1/all") {
    // Turn all devices ON or OFF at once
    setRelay(RELAY_LIGHT, msg);
    setRelay(RELAY_FAN, msg);
    client.publish("home1/all/ack", msg.c_str());
  }
}

// ─── HELPER ──────────────────────────────────────────────
void setRelay(int pin, String cmd) {
  if (cmd == "ON")  digitalWrite(pin, HIGH);
  else if (cmd == "OFF") digitalWrite(pin, LOW);
}
