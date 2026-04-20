#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <ArduinoJson.h>

// ---------------- WIFI ----------------
const char* ssid = "realme X7 5G";
const char* password = "kapne7u4";

// ---------------- MQTT ----------------
const char* mqttServer = "broker.hivemq.com";
const int mqttPort = 1883;
const char* deviceId = "home1";

// ---------------- PINS ----------------
#define DHTPIN 4
#define DHTTYPE DHT11
#define PIR_PIN 27
#define BUZZER_PIN 23

const int DEVICE_COUNT = 4;

// Devices
const char* DEVICE_NAMES[DEVICE_COUNT] = { "light1", "light2", "fan1", "fan2" };

// Relay pins (ACTIVE LOW)
const int RELAY_PINS[DEVICE_COUNT] = { 13, 12, 25, 26 };

// Switch pins (INPUT_PULLUP)
const int SWITCH_PINS[DEVICE_COUNT] = { 16, 17, 18, 19 };

// ---------------- TIMING ----------------
const unsigned long SENSOR_INTERVAL = 5000;
const unsigned long SWITCH_DEBOUNCE_MS = 80;

// ---------------- OBJECTS ----------------
DHT dht(DHTPIN, DHTTYPE);
WiFiClient espClient;
PubSubClient client(espClient);

// ---------------- STATES ----------------
bool relayState[DEVICE_COUNT] = { false, false, false, false };

int lastSwitchReading[DEVICE_COUNT];
int stableSwitchReading[DEVICE_COUNT];
unsigned long lastSwitchDebounce[DEVICE_COUNT];

unsigned long lastSensorPublish = 0;

// ---------------- TOPICS ----------------
String controlTopicFor(int i) {
  return String(deviceId) + "/" + DEVICE_NAMES[i];
}

String manualTopicFor(int i) {
  return controlTopicFor(i) + "_manual";
}

// ---------------- RELAY CONTROL ----------------
void setRelay(int i, bool state) {
  relayState[i] = state;
  digitalWrite(RELAY_PINS[i], state ? LOW : HIGH); // ACTIVE LOW
}

// ---------------- WIFI ----------------
void connectWiFi() {
  Serial.print("Connecting WiFi...");
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nConnected IP: " + WiFi.localIP().toString());
}

// ---------------- MQTT CALLBACK ----------------
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) {
    msg += (char)payload[i];
  }
  msg.trim();

  String t = String(topic);

  Serial.println("MQTT [" + t + "] -> " + msg);

  // Buzzer control
  if (t == String(deviceId) + "/buzzer") {
    digitalWrite(BUZZER_PIN, msg == "ON" ? HIGH : LOW);
    return;
  }

  // Device control
  for (int i = 0; i < DEVICE_COUNT; i++) {
    if (t == controlTopicFor(i)) {
      setRelay(i, msg == "ON");
      return;
    }
  }
}

// ---------------- MQTT RECONNECT ----------------
void reconnectMQTT() {
  while (!client.connected()) {
    Serial.print("Connecting MQTT...");

    String clientId = "ESP32-" + String(random(0xffff), HEX);

    if (client.connect(clientId.c_str())) {
      Serial.println("Connected");

      for (int i = 0; i < DEVICE_COUNT; i++) {
        client.subscribe(controlTopicFor(i).c_str());
      }

      client.subscribe((String(deviceId) + "/buzzer").c_str());

    } else {
      Serial.print("Failed rc=");
      Serial.println(client.state());
      delay(3000);
    }
  }
}

// ---------------- SENSOR DATA ----------------
void publishSensorData() {
  float temp = dht.readTemperature();
  float hum = dht.readHumidity();

  if (isnan(temp) || isnan(hum)) {
    Serial.println("DHT error");
    return;
  }

  // PIR filter
  static int motionCount = 0;
  if (digitalRead(PIR_PIN)) motionCount++;
  else motionCount = 0;

  bool motion = motionCount > 2;

  StaticJsonDocument<512> doc;

  doc["device"] = deviceId;
  doc["temp"] = temp;
  doc["humidity"] = hum;
  doc["motion"] = motion;

  doc["light1"] = relayState[0];
  doc["light2"] = relayState[1];
  doc["fan1"] = relayState[2];
  doc["fan2"] = relayState[3];

  doc["time"] = millis() / 1000;

  char payload[512];
  serializeJson(doc, payload);

  if (!client.publish((String(deviceId) + "/sensor").c_str(), payload, true)) {
    Serial.println("Publish failed");
  } else {
    Serial.println("Sensor data sent");
  }
}

// ---------------- MANUAL ACTION ----------------
void publishManual(int i, bool state) {
  client.publish(manualTopicFor(i).c_str(), state ? "ON" : "OFF", true);
}

// ---------------- SWITCH HANDLING ----------------
void handleSwitches() {
  for (int i = 0; i < DEVICE_COUNT; i++) {
    int reading = digitalRead(SWITCH_PINS[i]);

    if (reading != lastSwitchReading[i]) {
      lastSwitchReading[i] = reading;
      lastSwitchDebounce[i] = millis();
    }

    if (millis() - lastSwitchDebounce[i] < SWITCH_DEBOUNCE_MS) continue;

    if (reading != stableSwitchReading[i]) {
      stableSwitchReading[i] = reading;

      bool newState = (reading == LOW);

      if (relayState[i] != newState) {
        setRelay(i, newState);
        publishManual(i, newState);

        Serial.println("Manual toggle: " + String(DEVICE_NAMES[i]));
      }
    }
  }
}

// ---------------- SETUP ----------------
void setup() {
  Serial.begin(115200);

  pinMode(PIR_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  for (int i = 0; i < DEVICE_COUNT; i++) {
    pinMode(RELAY_PINS[i], OUTPUT);
    pinMode(SWITCH_PINS[i], INPUT_PULLUP);

    setRelay(i, false);

    int r = digitalRead(SWITCH_PINS[i]);
    lastSwitchReading[i] = r;
    stableSwitchReading[i] = r;
    lastSwitchDebounce[i] = 0;
  }

  dht.begin();
  connectWiFi();

  client.setServer(mqttServer, mqttPort);
  client.setCallback(mqttCallback);
}

// ---------------- LOOP ----------------
void loop() {

  // WIFI reconnect
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // MQTT reconnect
  if (!client.connected()) {
    reconnectMQTT();
  }

  client.loop();

  // switches
  handleSwitches();

  // sensor publish
  if (millis() - lastSensorPublish > SENSOR_INTERVAL) {
    lastSensorPublish = millis();
    publishSensorData();
  }
}