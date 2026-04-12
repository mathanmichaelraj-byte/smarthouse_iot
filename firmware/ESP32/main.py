"""
MicroPython firmware for Smart Home ESP32 node.
Publishes DHT11 + PIR sensor data and listens for relay commands via MQTT.
"""
import network
import time
import machine
import json
import dht
from umqtt.simple import MQTTClient

# ─── CONFIG ──────────────────────────────────────────────
SSID       = "YourSSID"
PASSWORD   = "YourPassword"
MQTT_HOST  = "broker.emqx.io"
MQTT_PORT  = 1883
CLIENT_ID  = b"esp32-mp-home1"
DEVICE_ID  = "home1"

# ─── PINS ────────────────────────────────────────────────
pir_pin   = machine.Pin(27, machine.Pin.IN)
relay_light = machine.Pin(13, machine.Pin.OUT, value=0)
relay_fan   = machine.Pin(12, machine.Pin.OUT, value=0)
d = dht.DHT11(machine.Pin(4))

# ─── WIFI ────────────────────────────────────────────────
def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if not wlan.isconnected():
        print("Connecting to WiFi...")
        wlan.connect(SSID, PASSWORD)
        timeout = 15
        while not wlan.isconnected() and timeout > 0:
            time.sleep(1)
            timeout -= 1
    if wlan.isconnected():
        print("WiFi connected:", wlan.ifconfig()[0])
    else:
        raise RuntimeError("WiFi connection failed")

# ─── MQTT CALLBACK ───────────────────────────────────────
def mqtt_callback(topic, msg):
    topic = topic.decode()
    msg   = msg.decode().strip()
    print(f"CMD [{topic}]: {msg}")

    if topic == f"{DEVICE_ID}/light":
        relay_light.value(1 if msg == "ON" else 0)
        client.publish(f"{DEVICE_ID}/light/ack", msg)
    elif topic == f"{DEVICE_ID}/fan":
        relay_fan.value(1 if msg == "ON" else 0)
        client.publish(f"{DEVICE_ID}/fan/ack", msg)
    elif topic == f"{DEVICE_ID}/all":
        relay_light.value(1 if msg == "ON" else 0)
        relay_fan.value(1 if msg == "ON" else 0)
        client.publish(f"{DEVICE_ID}/all/ack", msg)

# ─── READ SENSORS ────────────────────────────────────────
def read_sensors():
    try:
        d.measure()
        temp = d.temperature()
        hum  = d.humidity()
    except Exception as e:
        print("DHT error:", e)
        temp, hum = None, None
    motion = pir_pin.value()
    return temp, hum, bool(motion)

# ─── PUBLISH ─────────────────────────────────────────────
def publish_data(temp, hum, motion):
    payload = json.dumps({
        "device":   DEVICE_ID,
        "temp":     temp,
        "humidity": hum,
        "motion":   motion,
        "light_on": bool(relay_light.value()),
        "fan_on":   bool(relay_fan.value()),
    })
    client.publish(f"{DEVICE_ID}/sensor", payload)
    print("Published:", payload)

# ─── MAIN ────────────────────────────────────────────────
connect_wifi()

client = MQTTClient(CLIENT_ID, MQTT_HOST, MQTT_PORT)
client.set_callback(mqtt_callback)
client.connect()
client.subscribe(f"{DEVICE_ID}/light".encode())
client.subscribe(f"{DEVICE_ID}/fan".encode())
client.subscribe(f"{DEVICE_ID}/all".encode())
print("MQTT connected and subscribed.")

INTERVAL = 5000  # ms
last_publish = 0

while True:
    now = time.ticks_ms()
    if time.ticks_diff(now, last_publish) >= INTERVAL:
        temp, hum, motion = read_sensors()
        publish_data(temp, hum, motion)
        last_publish = now
    client.check_msg()
    time.sleep_ms(200)
