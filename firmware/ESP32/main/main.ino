#include <WiFi.h>
#include <PubSubClient.h>
#include "DHT.h"
#include <ESP32Servo.h>

#define DHTPIN 4
#define DHTTYPE DHT11
#define PIR_PIN 5
#define RELAY_LIGHT 18
#define RELAY_FAN 19
#define BUZZER 21
#define SERVO_PIN 23

#define RELAY_ON LOW
#define RELAY_OFF HIGH

DHT dht(DHTPIN, DHTTYPE);
Servo myServo;

const char* ssid = "mahii";
const char* password = "hidamayulu";
const char* mqtt_server = "broker.hivemq.com";
const int mqtt_port = 1883;

WiFiClient espClient;
PubSubClient client(espClient);

bool lightState = false;
bool fanState = false;

String mqttClientId;

unsigned long lastPublish = 0;
const unsigned long publishInterval = 3000;

void setLight(bool on) {
  lightState = on;
  digitalWrite(RELAY_LIGHT, on ? RELAY_ON : RELAY_OFF);
  client.publish("home1/light/ack", on ? "ON" : "OFF", true);
}

void setFan(bool on) {
  fanState = on;
  digitalWrite(RELAY_FAN, on ? RELAY_ON : RELAY_OFF);
  client.publish("home1/fan/ack", on ? "ON" : "OFF", true);
}

void setDoor(bool openDoor) {
  myServo.write(openDoor ? 90 : 0);
  client.publish("home1/door/ack", openDoor ? "OPEN" : "CLOSE", true);
}

void setup_wifi() {
  Serial.println("Connecting to WiFi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    attempts++;
    if (attempts > 30) {
      Serial.println("\nWiFi Failed!");
      return;
    }
  }

  Serial.println("\nWiFi Connected!");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

void callback(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) {
    msg += (char)payload[i];
  }

  Serial.print("Message received on topic: ");
  Serial.println(topic);
  Serial.print("Message: ");
  Serial.println(msg);

  String topicStr = String(topic);

  if (topicStr == "home1/light") {
    setLight(msg == "ON");
  }
  else if (topicStr == "home1/fan") {
    setFan(msg == "ON");
  }
  else if (topicStr == "home1/all") {
    bool on = (msg == "ON");
    setLight(on);
    setFan(on);
    client.publish("home1/all/ack", on ? "ON" : "OFF", true);
  }
  else if (topicStr == "home1/door") {
    if (msg == "OPEN") {
      setDoor(true);
    } else if (msg == "CLOSE") {
      setDoor(false);
    }
  }
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Connecting to MQTT...");

    if (client.connect(mqttClientId.c_str())) {
      Serial.println("Connected!");

      client.subscribe("home1/light");
      client.subscribe("home1/fan");
      client.subscribe("home1/all");
      client.subscribe("home1/door");

      client.publish("home1/light/ack", lightState ? "ON" : "OFF", true);
      client.publish("home1/fan/ack", fanState ? "ON" : "OFF", true);
      client.publish("home1/all/ack", "OFF", true);
      client.publish("home1/door/ack", "CLOSE", true);
    } else {
      Serial.print("Failed, rc=");
      Serial.print(client.state());
      Serial.println(" retrying in 2 sec...");
      delay(2000);
    }
  }
}

void publishSensorData() {
  float temp = dht.readTemperature();
  float humidity = dht.readHumidity();
  bool motion = digitalRead(PIR_PIN);

  if (isnan(temp) || isnan(humidity)) {
    Serial.println("DHT11 read failed");
    return;
  }

  digitalWrite(BUZZER, motion ? HIGH : LOW);

  Serial.print("Temp: ");
  Serial.print(temp);
  Serial.print(" | Humidity: ");
  Serial.print(humidity);
  Serial.print(" | Motion: ");
  Serial.println(motion ? 1 : 0);

  String payload = "{";
  payload += "\"device\":\"home1\",";
  payload += "\"temp\":" + String(temp, 2) + ",";
  payload += "\"humidity\":" + String(humidity, 2) + ",";
  payload += "\"motion\":" + String(motion ? "true" : "false") + ",";
  payload += "\"light_on\":" + String(lightState ? "true" : "false") + ",";
  payload += "\"fan_on\":" + String(fanState ? "true" : "false");
  payload += "}";

  client.publish("home1/sensor", payload.c_str());
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("ESP32 STARTED");

  pinMode(PIR_PIN, INPUT);
  pinMode(RELAY_LIGHT, OUTPUT);
  pinMode(RELAY_FAN, OUTPUT);
  pinMode(BUZZER, OUTPUT);

  digitalWrite(RELAY_LIGHT, RELAY_OFF);
  digitalWrite(RELAY_FAN, RELAY_OFF);
  digitalWrite(BUZZER, LOW);

  myServo.attach(SERVO_PIN, 500, 2400);
  myServo.write(0);

  dht.begin();

  setup_wifi();

  mqttClientId = "ESP32-" + String((uint32_t)(ESP.getEfuseMac() & 0xFFFFFFFF), HEX);

  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setBufferSize(512);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    setup_wifi();
  }

  if (!client.connected()) {
    reconnect();
  }

  client.loop();

  if (millis() - lastPublish >= publishInterval) {
    lastPublish = millis();
    publishSensorData();
  }
}