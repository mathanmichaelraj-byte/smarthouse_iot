#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include "esp_system.h"

// ---------------- WIFI ----------------
const char* ssid = "mahii";
const char* password = "hidamayulu";

// ---------------- MQTT ----------------
const char* mqttServer = "10.41.23.199"; // Laptop IP on mobile hotspot
const uint16_t mqttPort = 1883;
const char* deviceId = "home1";

// ---------------- PINS ----------------
#define DHTPIN 5
#define DHTTYPE DHT11
#define PIR1_PIN 4
#define LDR_PIN 34

#define RELAY_LIGHT1_PIN 18
#define RELAY_LIGHT2_PIN 19
#define RELAY_FAN1_PIN 22
#define RELAY_FAN2_PIN 23

#define BUZZER_PIN 21
#define SERVO_PIN 25

#define SW_LIGHT1_PIN 32
#define SW_LIGHT2_PIN 33
#define SW_FAN1_PIN 26
#define SW_FAN2_PIN 27

#define BTN_ML_TOGGLE_PIN 14
#define BTN_BUZZER_MUTE_PIN 16

// ---------------- CONSTANTS ----------------
const int DEVICE_COUNT = 4;
const size_t MQTT_PACKET_SIZE = 1024;
const size_t SENSOR_DOC_CAPACITY = 512;
const size_t SENSOR_PAYLOAD_BUFFER = 512;

const unsigned long SENSOR_INTERVAL_MS = 2000;
const unsigned long PIR_PUBLISH_COOLDOWN_MS = 500;
const unsigned long PIR_HOLD_MS = 3000;
const unsigned long SWITCH_DEBOUNCE_MS = 80;
const unsigned long BUTTON_DEBOUNCE_MS = 200;
const unsigned long WIFI_RECONNECT_MS = 10000;
const unsigned long MQTT_RECONNECT_MS = 5000;
const unsigned long SERVO_HOLD_MS = 700;

// ---------------- DEVICE MAP ----------------
const char* DEVICE_NAMES[DEVICE_COUNT] = { "light1", "light2", "fan1", "fan2" };
const int RELAY_PINS[DEVICE_COUNT] = {
  RELAY_LIGHT1_PIN,
  RELAY_LIGHT2_PIN,
  RELAY_FAN1_PIN,
  RELAY_FAN2_PIN
};
const int SWITCH_PINS[DEVICE_COUNT] = {
  SW_LIGHT1_PIN,
  SW_LIGHT2_PIN,
  SW_FAN1_PIN,
  SW_FAN2_PIN
};

#define BTN_ML_TOGGLE BTN_ML_TOGGLE_PIN
#define BTN_BUZZER_MUTE BTN_BUZZER_MUTE_PIN

// ---------------- OBJECTS ----------------
DHT dht(DHTPIN, DHTTYPE);
WiFiClient espClient;
PubSubClient client(espClient);
Servo doorServo;

// ---------------- STATES ----------------
bool relayState[DEVICE_COUNT] = { false, false, false, false };
bool mlEnabled = true;
bool buzzerMuted = false;
bool servoAttached = false;

int lastSwitchReading[DEVICE_COUNT];
int stableSwitchReading[DEVICE_COUNT];
unsigned long lastSwitchDebounce[DEVICE_COUNT];

int lastBtnMlReading = HIGH;
int stableBtnMlReading = HIGH;
unsigned long lastBtnMlDebounce = 0;

int lastBtnBuzzerReading = HIGH;
int stableBtnBuzzerReading = HIGH;
unsigned long lastBtnBuzzerDebounce = 0;

unsigned long lastSensorPublish = 0;
unsigned long lastWiFiAttempt = 0;
unsigned long lastMqttAttempt = 0;
unsigned long servoDetachAt = 0;
unsigned long lastPirPublish = 0;
bool lastPirState = false;
unsigned long pirDetectedAt = 0;

// ---------------- HELPERS ----------------
const char* resetReasonToString(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_UNKNOWN: return "UNKNOWN";
    case ESP_RST_POWERON: return "POWERON_RESET";
    case ESP_RST_EXT: return "EXTERNAL_RESET";
    case ESP_RST_SW: return "SOFTWARE_RESET";
    case ESP_RST_PANIC: return "EXCEPTION_RESET";
    case ESP_RST_INT_WDT: return "INT_WDT_RESET";
    case ESP_RST_TASK_WDT: return "TASK_WDT_RESET";
    case ESP_RST_WDT: return "OTHER_WDT_RESET";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP_RESET";
    case ESP_RST_BROWNOUT: return "BROWNOUT_RESET";
    case ESP_RST_SDIO: return "SDIO_RESET";
    default: return "UNMAPPED_RESET";
  }
}

String controlTopicFor(int index) {
  return String(deviceId) + "/" + DEVICE_NAMES[index];
}

String manualTopicFor(int index) {
  return controlTopicFor(index) + "_manual";
}

String topicFor(const char* suffix) {
  return String(deviceId) + "/" + suffix;
}

void setRelay(int index, bool state) {
  relayState[index] = state;
  digitalWrite(RELAY_PINS[index], state ? LOW : HIGH);
}

void ensureServoAttached() {
  if (servoAttached) return;

  doorServo.setPeriodHertz(50);
  doorServo.attach(SERVO_PIN, 500, 2400);
  servoAttached = true;
}

void commandDoorServo(int angle) {
  ensureServoAttached();
  doorServo.write(angle);
  servoDetachAt = millis() + SERVO_HOLD_MS;
  Serial.printf("[SERVO] Angle -> %d\n", angle);
}

void serviceServo() {
  if (!servoAttached) return;
  if ((long)(millis() - servoDetachAt) < 0) return;

  doorServo.detach();
  servoAttached = false;
  Serial.println("[SERVO] Detached to reduce idle current draw");
}

bool publishTopic(const String& topic, const char* payload, bool retain = false) {
  if (!client.connected()) {
    Serial.printf("[MQTT] Publish skipped, client disconnected topic=%s\n", topic.c_str());
    return false;
  }

  const bool ok = client.publish(topic.c_str(), payload, retain);
  if (!ok) {
    Serial.printf(
      "[MQTT] Publish failed topic=%s bytes=%u rc=%d connected=%d\n",
      topic.c_str(),
      strlen(payload),
      client.state(),
      client.connected()
    );
  }

  return ok;
}

void publishSystemTopic(const char* suffix, bool state) {
  publishTopic(topicFor(suffix), state ? "ON" : "OFF", true);
}

void subscribeCoreTopics() {
  for (int index = 0; index < DEVICE_COUNT; index++) {
    const String controlTopic = controlTopicFor(index);
    if (client.subscribe(controlTopic.c_str())) {
      Serial.printf("[MQTT] Subscribed %s\n", controlTopic.c_str());
    } else {
      Serial.printf("[MQTT] Subscribe failed %s\n", controlTopic.c_str());
    }
  }

  const String buzzerTopic = topicFor("buzzer");
  const String mlTopic = topicFor("ml_mode");
  const String muteTopic = topicFor("buzzer_mute");
  const String doorTopic = topicFor("door");

  client.subscribe(buzzerTopic.c_str());
  client.subscribe(mlTopic.c_str());
  client.subscribe(muteTopic.c_str());
  client.subscribe(doorTopic.c_str());
}

void beginWiFi() {
  Serial.printf("[WIFI] Connecting to %s\n", ssid);
  WiFi.begin(ssid, password);
  lastWiFiAttempt = millis();
}

bool waitForWiFi(unsigned long timeoutMs) {
  const unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}

void serviceWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWiFiAttempt < WIFI_RECONNECT_MS) return;

  Serial.printf("[WIFI] Disconnected, status=%d. Retrying...\n", WiFi.status());
  beginWiFi();
}

bool connectMQTT() {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (client.connected()) return true;
  if (millis() - lastMqttAttempt < MQTT_RECONNECT_MS) return false;

  lastMqttAttempt = millis();

  const String statusTopic = topicFor("status");
  const String clientId = String("esp32-") + deviceId + "-" + String((uint32_t)(ESP.getEfuseMac() & 0xFFFFFFFF), HEX);

  Serial.printf("[MQTT] Connecting to %s:%u as %s\n", mqttServer, mqttPort, clientId.c_str());

  const bool connected = client.connect(clientId.c_str(), statusTopic.c_str(), 0, true, "offline");
  if (!connected) {
    Serial.printf("[MQTT] Connect failed rc=%d wifi=%d\n", client.state(), WiFi.status());
    return false;
  }

  Serial.println("[MQTT] Connected");
  subscribeCoreTopics();
  publishTopic(statusTopic, "online", true);

  for (int index = 0; index < DEVICE_COUNT; index++) {
    publishTopic(controlTopicFor(index), relayState[index] ? "ON" : "OFF", true);
  }
  publishSystemTopic("ml_mode", mlEnabled);
  publishSystemTopic("buzzer_mute", buzzerMuted);

  return true;
}

// ---------------- MQTT CALLBACK ----------------
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message;
  for (unsigned int index = 0; index < length; index++) {
    message += (char)payload[index];
  }
  message.trim();

  const String incomingTopic = String(topic);
  Serial.println("[MQTT] " + incomingTopic + " -> " + message);

  if (incomingTopic == topicFor("buzzer")) {
    digitalWrite(BUZZER_PIN, message == "ON" ? HIGH : LOW);
    return;
  }

  if (incomingTopic == topicFor("ml_mode")) {
    mlEnabled = (message == "ON");
    return;
  }

  if (incomingTopic == topicFor("buzzer_mute")) {
    buzzerMuted = (message == "ON");
    if (buzzerMuted) {
      digitalWrite(BUZZER_PIN, LOW);
    }
    return;
  }

  if (incomingTopic == topicFor("door")) {
    if (message == "OPEN") {
      commandDoorServo(90);
    } else if (message == "CLOSE") {
      commandDoorServo(0);
    }
    return;
  }

  for (int index = 0; index < DEVICE_COUNT; index++) {
    if (incomingTopic == controlTopicFor(index)) {
      setRelay(index, message == "ON");
      return;
    }
  }
}

// ---------------- SENSOR DATA ----------------
float cachedTemp = NAN;
float cachedHum = NAN;
bool cachedPir = false;

void publishSensorData() {
  if (!client.connected()) {
    Serial.println("[SENSOR] MQTT offline, skipping sensor publish");
    return;
  }

  const float temp = dht.readTemperature();
  const float hum = dht.readHumidity();

  if (!isnan(temp)) cachedTemp = temp;
  if (!isnan(hum)) cachedHum = hum;

  if (isnan(cachedTemp) || isnan(cachedHum)) {
    Serial.println("[SENSOR] DHT read failed, no cached value yet");
    return;
  }

  // Use latched PIR state (set by loop)
  const bool pir1 = cachedPir;
  const bool motion = pir1;
  const int ldr = analogRead(LDR_PIN);

  StaticJsonDocument<SENSOR_DOC_CAPACITY> doc;
  doc["device"] = deviceId;
  doc["temp"] = cachedTemp;
  doc["humidity"] = cachedHum;
  doc["pir1"] = pir1;
  doc["motion"] = motion;
  doc["ldr"] = ldr;
  doc["sw_light1"] = digitalRead(SW_LIGHT1_PIN) == LOW;
  doc["sw_light2"] = digitalRead(SW_LIGHT2_PIN) == LOW;
  doc["sw_fan1"] = digitalRead(SW_FAN1_PIN) == LOW;
  doc["sw_fan2"] = digitalRead(SW_FAN2_PIN) == LOW;
  doc["relay_light1"] = relayState[0];
  doc["relay_light2"] = relayState[1];
  doc["relay_fan1"] = relayState[2];
  doc["relay_fan2"] = relayState[3];
  doc["ml_enabled"] = mlEnabled;
  doc["buzzer_muted"] = buzzerMuted;
  doc["timestamp"] = millis() / 1000;

  const size_t requiredBytes = measureJson(doc);
  if (requiredBytes >= SENSOR_PAYLOAD_BUFFER) {
    Serial.printf("[SENSOR] Payload too large bytes=%u buffer=%u\n", requiredBytes, SENSOR_PAYLOAD_BUFFER);
    return;
  }

  char payload[SENSOR_PAYLOAD_BUFFER];
  const size_t written = serializeJson(doc, payload, sizeof(payload));
  if (written == 0) {
    Serial.println("[SENSOR] JSON serialization failed");
    return;
  }

  Serial.printf(
    "[SENSOR] Publishing bytes=%u temp=%.1f humidity=%.1f motion=%d ldr=%d\n",
    written,
    cachedTemp,
    cachedHum,
    motion,
    ldr
  );
  Serial.println(payload);

  const bool ok = publishTopic(topicFor("sensor"), payload, false);
  Serial.println(ok ? "[SENSOR] Published OK" : "[SENSOR] Publish failed");
}

// ---------------- MANUAL ACTION ----------------
void publishManual(int index, bool state) {
  setRelay(index, state);

  const bool ok = publishTopic(manualTopicFor(index), state ? "ON" : "OFF");
  Serial.printf(
    "[MANUAL] %s -> %s (%s)\n",
    DEVICE_NAMES[index],
    state ? "ON" : "OFF",
    ok ? "synced" : "mqtt-offline"
  );
}

// ---------------- BUTTON HANDLING ----------------
void handleButtons() {
  int reading = digitalRead(BTN_ML_TOGGLE);
  if (reading != lastBtnMlReading) {
    lastBtnMlReading = reading;
    lastBtnMlDebounce = millis();
  }
  if (millis() - lastBtnMlDebounce > BUTTON_DEBOUNCE_MS) {
    if (reading != stableBtnMlReading) {
      stableBtnMlReading = reading;
      if (reading == LOW) {
        mlEnabled = !mlEnabled;
        publishSystemTopic("ml_mode", mlEnabled);
        Serial.println("[SYSTEM] ML mode -> " + String(mlEnabled ? "ON" : "OFF"));
      }
    }
  }

  reading = digitalRead(BTN_BUZZER_MUTE);
  if (reading != lastBtnBuzzerReading) {
    lastBtnBuzzerReading = reading;
    lastBtnBuzzerDebounce = millis();
  }
  if (millis() - lastBtnBuzzerDebounce > BUTTON_DEBOUNCE_MS) {
    if (reading != stableBtnBuzzerReading) {
      stableBtnBuzzerReading = reading;
      if (reading == LOW) {
        buzzerMuted = !buzzerMuted;
        publishSystemTopic("buzzer_mute", buzzerMuted);
        if (buzzerMuted) {
          digitalWrite(BUZZER_PIN, LOW);
        }
        Serial.println("[SYSTEM] Buzzer mute -> " + String(buzzerMuted ? "ON" : "OFF"));
      }
    }
  }
}

// ---------------- SWITCH HANDLING ----------------
void handleSwitches() {
  for (int index = 0; index < DEVICE_COUNT; index++) {
    const int reading = digitalRead(SWITCH_PINS[index]);

    if (reading != lastSwitchReading[index]) {
      lastSwitchReading[index] = reading;
      lastSwitchDebounce[index] = millis();
    }

    if (millis() - lastSwitchDebounce[index] < SWITCH_DEBOUNCE_MS) {
      continue;
    }

    if (reading != stableSwitchReading[index]) {
      stableSwitchReading[index] = reading;
      publishManual(index, reading == LOW);
    }
  }
}

// ---------------- SETUP ----------------
void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.printf("\n[BOOT] Reset reason: %s\n", resetReasonToString(esp_reset_reason()));

  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);

  pinMode(PIR1_PIN, INPUT_PULLDOWN);
  pinMode(LDR_PIN, INPUT);

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  for (int index = 0; index < DEVICE_COUNT; index++) {
    pinMode(RELAY_PINS[index], OUTPUT);
    setRelay(index, false);
  }

  for (int index = 0; index < DEVICE_COUNT; index++) {
    pinMode(SWITCH_PINS[index], INPUT_PULLUP);
    const int initialReading = digitalRead(SWITCH_PINS[index]);
    lastSwitchReading[index] = initialReading;
    stableSwitchReading[index] = initialReading;
    lastSwitchDebounce[index] = 0;
  }

  pinMode(BTN_ML_TOGGLE, INPUT_PULLUP);
  lastBtnMlReading = digitalRead(BTN_ML_TOGGLE);
  stableBtnMlReading = lastBtnMlReading;
  lastBtnMlDebounce = 0;

  pinMode(BTN_BUZZER_MUTE, INPUT_PULLUP);
  lastBtnBuzzerReading = digitalRead(BTN_BUZZER_MUTE);
  stableBtnBuzzerReading = lastBtnBuzzerReading;
  lastBtnBuzzerDebounce = 0;

  dht.begin();

  client.setServer(mqttServer, mqttPort);
  client.setCallback(mqttCallback);
  client.setBufferSize(MQTT_PACKET_SIZE);
  client.setKeepAlive(30);
  client.setSocketTimeout(10);
  espClient.setTimeout(1000);

  beginWiFi();
  if (waitForWiFi(15000)) {
    const String ip = WiFi.localIP().toString();
    Serial.printf("[WIFI] Connected IP=%s RSSI=%d dBm\n", ip.c_str(), WiFi.RSSI());
  } else {
    Serial.printf("[WIFI] Startup connect timed out, status=%d\n", WiFi.status());
  }
}

// ---------------- LOOP ----------------
void loop() {
  serviceWiFi();

  if (WiFi.status() == WL_CONNECTED) {
    connectMQTT();
    client.loop();
  }

  serviceServo();
  handleSwitches();
  handleButtons();

  // PIR: latch HIGH for PIR_HOLD_MS, publish immediately on rising edge
  const bool rawPir = digitalRead(PIR1_PIN) == HIGH;
  const unsigned long now = millis();
  if (rawPir) pirDetectedAt = now;
  const bool currentPir = (now - pirDetectedAt) < PIR_HOLD_MS;
  cachedPir = currentPir;

  if (currentPir != lastPirState && now - lastPirPublish >= PIR_PUBLISH_COOLDOWN_MS) {
    lastPirState = currentPir;
    lastPirPublish = now;
    publishSensorData();
    lastSensorPublish = now;
  }

  if (now - lastSensorPublish >= SENSOR_INTERVAL_MS) {
    lastSensorPublish = now;
    publishSensorData();
  }

  delay(10);
}
