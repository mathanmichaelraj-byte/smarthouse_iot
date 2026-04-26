#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// ---------------- WIFI ----------------
const char* ssid = "mahii";
const char* password = "hidamayulu";

// ---------------- MQTT ----------------
const char* mqttServer = "test.mosquitto.org";
const int mqttPort = 1883;
const char* deviceId = "home1";

// ---------------- PINS ----------------
#define DHTPIN 4
#define DHTTYPE DHT11
#define PIR1_PIN 5
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

const int DEVICE_COUNT = 4;

// Devices
const char* DEVICE_NAMES[DEVICE_COUNT] = { "light1", "light2", "fan1", "fan2" };

// Relay pins
const int RELAY_PINS[DEVICE_COUNT] = { RELAY_LIGHT1_PIN, RELAY_LIGHT2_PIN, RELAY_FAN1_PIN, RELAY_FAN2_PIN };

// Switch pins (INPUT_PULLUP)
const int SWITCH_PINS[DEVICE_COUNT] = { SW_LIGHT1_PIN, SW_LIGHT2_PIN, SW_FAN1_PIN, SW_FAN2_PIN };

// Push button pins (INPUT_PULLUP)
#define BTN_ML_TOGGLE BTN_ML_TOGGLE_PIN
#define BTN_BUZZER_MUTE BTN_BUZZER_MUTE_PIN

// ---------------- TIMING ----------------
const unsigned long SENSOR_INTERVAL = 5000;
const unsigned long SWITCH_DEBOUNCE_MS = 80;
const unsigned long BUTTON_DEBOUNCE_MS = 200;

// ---------------- OBJECTS ----------------
DHT dht(DHTPIN, DHTTYPE);
WiFiClient espClient;
PubSubClient client(espClient);
Servo doorServo;

// ---------------- STATES ----------------
bool relayState[DEVICE_COUNT] = { false, false, false, false };
bool mlEnabled = true;
bool buzzerMuted = false;

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

// ---------------- TOPICS ----------------
String controlTopicFor(int i) {
  return String(deviceId) + "/" + DEVICE_NAMES[i];
}

String manualTopicFor(int i) {
  return controlTopicFor(i) + "_manual";
}

String topicFor(const char* suffix) {
  return String(deviceId) + "/" + suffix;
}

void publishSystemTopic(const char* suffix, bool state) {
  client.publish(topicFor(suffix).c_str(), state ? "ON" : "OFF", true);
}

// ---------------- RELAY CONTROL ----------------
void setRelay(int i, bool state) {
  relayState[i] = state;
  // Relay modules are typically active-LOW: LOW=ON, HIGH=OFF
  digitalWrite(RELAY_PINS[i], state ? LOW : HIGH);
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
  if (t == topicFor("buzzer")) {
    digitalWrite(BUZZER_PIN, msg == "ON" ? HIGH : LOW);
    return;
  }

  // ML mode
  if (t == topicFor("ml_mode")) {
    mlEnabled = (msg == "ON");
    return;
  }

  if (t == topicFor("buzzer_mute")) {
    buzzerMuted = (msg == "ON");
    if (buzzerMuted) {
      digitalWrite(BUZZER_PIN, LOW);
    }
    return;
  }

  // Door servo
  if (t == topicFor("door")) {
    if (msg == "OPEN") {
      doorServo.write(90); // open position
    } else if (msg == "CLOSE") {
      doorServo.write(0); // close position
    }
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

      client.subscribe(topicFor("buzzer").c_str());
      client.subscribe(topicFor("ml_mode").c_str());
      client.subscribe(topicFor("buzzer_mute").c_str());
      client.subscribe(topicFor("door").c_str());

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

  bool pir1 = digitalRead(PIR1_PIN);
  int ldr = analogRead(LDR_PIN);
  bool motion = pir1;

  StaticJsonDocument<512> doc;

  doc["device"] = deviceId;
  doc["temp"] = temp;
  doc["humidity"] = hum;
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

  char payload[512];
  serializeJson(doc, payload);

  if (!client.publish((String(deviceId) + "/sensor").c_str(), payload)) {
    Serial.println("Publish failed");
  } else {
    Serial.println("Sensor data sent");
  }
}

// ---------------- MANUAL ACTION ----------------
void publishManual(int i, bool state) {
  client.publish(manualTopicFor(i).c_str(), state ? "ON" : "OFF");
  setRelay(i, state);  // Update relay when manual switch changes
}

// ---------------- BUTTON HANDLING ----------------
void handleButtons() {
  // ML toggle button
  int reading = digitalRead(BTN_ML_TOGGLE);
  if (reading != lastBtnMlReading) {
    lastBtnMlReading = reading;
    lastBtnMlDebounce = millis();
  }
  if (millis() - lastBtnMlDebounce > BUTTON_DEBOUNCE_MS) {
    if (reading != stableBtnMlReading) {
      stableBtnMlReading = reading;
      if (reading == LOW) { // button pressed
        mlEnabled = !mlEnabled;
        publishSystemTopic("ml_mode", mlEnabled);
        Serial.println("ML mode toggled: " + String(mlEnabled ? "ON" : "OFF"));
      }
    }
  }

  // Buzzer mute button
  reading = digitalRead(BTN_BUZZER_MUTE);
  if (reading != lastBtnBuzzerReading) {
    lastBtnBuzzerReading = reading;
    lastBtnBuzzerDebounce = millis();
  }
  if (millis() - lastBtnBuzzerDebounce > BUTTON_DEBOUNCE_MS) {
    if (reading != stableBtnBuzzerReading) {
      stableBtnBuzzerReading = reading;
      if (reading == LOW) { // button pressed
        buzzerMuted = !buzzerMuted;
        publishSystemTopic("buzzer_mute", buzzerMuted);
        if (buzzerMuted) {
          digitalWrite(BUZZER_PIN, LOW);
        }
        Serial.println("Buzzer mute toggled: " + String(buzzerMuted ? "ON" : "OFF"));
      }
    }
  }
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

    // Only publish when the switch position actually CHANGES
    if (reading != stableSwitchReading[i]) {
      stableSwitchReading[i] = reading;

      bool newState = (reading == LOW);  // LOW = pressed/ON, HIGH = released/OFF
      publishManual(i, newState);

      Serial.println("Manual toggle: " + String(DEVICE_NAMES[i]) + " -> " + String(newState ? "ON" : "OFF"));
    }
  }
}

// ---------------- SETUP ----------------
void setup() {
  Serial.begin(115200);

  // Sensor pins
  pinMode(PIR1_PIN, INPUT);
  pinMode(LDR_PIN, INPUT);

  // Output pins
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // Servo
  doorServo.attach(SERVO_PIN);
  doorServo.write(0); // closed

  // Relays
  for (int i = 0; i < DEVICE_COUNT; i++) {
    pinMode(RELAY_PINS[i], OUTPUT);
    setRelay(i, false);
  }

  // Switches
  for (int i = 0; i < DEVICE_COUNT; i++) {
    pinMode(SWITCH_PINS[i], INPUT_PULLUP);
    int r = digitalRead(SWITCH_PINS[i]);
    lastSwitchReading[i] = r;
    stableSwitchReading[i] = r;
    lastSwitchDebounce[i] = 0;
  }

  // Buttons
  pinMode(BTN_ML_TOGGLE, INPUT_PULLUP);
  lastBtnMlReading = digitalRead(BTN_ML_TOGGLE);
  stableBtnMlReading = lastBtnMlReading;
  lastBtnMlDebounce = 0;

  pinMode(BTN_BUZZER_MUTE, INPUT_PULLUP);
  lastBtnBuzzerReading = digitalRead(BTN_BUZZER_MUTE);
  stableBtnBuzzerReading = lastBtnBuzzerReading;
  lastBtnBuzzerDebounce = 0;

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

  // buttons
  handleButtons();

  // sensor publish
  if (millis() - lastSensorPublish > SENSOR_INTERVAL) {
    lastSensorPublish = millis();
    publishSensorData();
  }
}
