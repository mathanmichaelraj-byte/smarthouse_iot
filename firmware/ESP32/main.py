"""
MicroPython firmware for the four-device smart home node.
"""

import dht
import json
import machine
import network
import time
from umqtt.simple import MQTTClient


SSID = "YourSSID"
PASSWORD = "YourPassword"
MQTT_HOST = "broker.hivemq.com"
MQTT_PORT = 1883
CLIENT_ID = b"esp32-mp-home1"
DEVICE_ID = "home1"

DHT_PIN = 4
PIR_PIN = 27
BUZZER_PIN = 23
RELAY_PINS = [13, 12, 25, 26]
SWITCH_PINS = [16, 17, 18, 19]
TARGET_NAMES = ["light1", "light2", "fan1", "fan2"]

SENSOR_INTERVAL_MS = 5000
SWITCH_DEBOUNCE_MS = 80

pir_pin = machine.Pin(PIR_PIN, machine.Pin.IN)
buzzer_pin = machine.Pin(BUZZER_PIN, machine.Pin.OUT, value=0)
relay_pins = [machine.Pin(pin, machine.Pin.OUT, value=0) for pin in RELAY_PINS]
switch_pins = [machine.Pin(pin, machine.Pin.IN, machine.Pin.PULL_UP) for pin in SWITCH_PINS]
dht_sensor = dht.DHT11(machine.Pin(DHT_PIN))

relay_state = {name: False for name in TARGET_NAMES}
last_switch_readings = [pin.value() for pin in switch_pins]
stable_switch_readings = list(last_switch_readings)
last_switch_debounce = [time.ticks_ms() for _ in switch_pins]


def control_topic(name):
    return "{}/{}".format(DEVICE_ID, name)


def manual_topic(name):
    return "{}/{}_manual".format(DEVICE_ID, name)


def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)

    if not wlan.isconnected():
        print("Connecting to WiFi...")
        wlan.connect(SSID, PASSWORD)
        while not wlan.isconnected():
            time.sleep(1)

    print("WiFi connected:", wlan.ifconfig()[0])


def set_relay(index, state):
    relay_pins[index].value(1 if state else 0)
    relay_state[TARGET_NAMES[index]] = state


def mqtt_callback(topic, msg):
    topic = topic.decode()
    msg = msg.decode().strip()
    print("MQTT [{}] -> {}".format(topic, msg))

    if topic == "{}/buzzer".format(DEVICE_ID):
        buzzer_pin.value(1 if msg == "ON" else 0)
        return

    for index, name in enumerate(TARGET_NAMES):
        if topic == control_topic(name):
            set_relay(index, msg == "ON")
            return


def read_sensors():
    try:
        dht_sensor.measure()
        temp = dht_sensor.temperature()
        humidity = dht_sensor.humidity()
    except Exception as error:
        print("DHT error:", error)
        return None, None, None

    return temp, humidity, bool(pir_pin.value())


def publish_data(temp, humidity, motion):
    payload = json.dumps(
        {
            "device": DEVICE_ID,
            "temp": temp,
            "humidity": humidity,
            "motion": motion,
            "light1": relay_state["light1"],
            "light2": relay_state["light2"],
            "fan1": relay_state["fan1"],
            "fan2": relay_state["fan2"],
            "timestamp": time.time(),
        }
    )
    client.publish("{}/sensor".format(DEVICE_ID), payload)
    print("Published:", payload)


def check_manual_switches():
    now = time.ticks_ms()

    for index, pin in enumerate(switch_pins):
        reading = pin.value()

        if reading != last_switch_readings[index]:
            last_switch_readings[index] = reading
            last_switch_debounce[index] = now

        if time.ticks_diff(now, last_switch_debounce[index]) < SWITCH_DEBOUNCE_MS:
            continue

        if reading != stable_switch_readings[index]:
            stable_switch_readings[index] = reading
            next_state = reading == 0

            if relay_state[TARGET_NAMES[index]] != next_state:
                set_relay(index, next_state)
                client.publish(manual_topic(TARGET_NAMES[index]), "ON" if next_state else "OFF")
                print("Manual switch ->", manual_topic(TARGET_NAMES[index]))


connect_wifi()

client = MQTTClient(CLIENT_ID, MQTT_HOST, MQTT_PORT)
client.set_callback(mqtt_callback)
client.connect()

for name in TARGET_NAMES:
    client.subscribe(control_topic(name).encode())
client.subscribe("{}/buzzer".format(DEVICE_ID).encode())

print("MQTT connected and subscribed.")

last_publish = time.ticks_ms()

while True:
    client.check_msg()
    check_manual_switches()

    now = time.ticks_ms()
    if time.ticks_diff(now, last_publish) >= SENSOR_INTERVAL_MS:
        temp, humidity, motion = read_sensors()
        if temp is not None:
            publish_data(temp, humidity, motion)
        last_publish = now

    time.sleep_ms(100)
