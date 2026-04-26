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
PIR1_PIN = 5
LDR_PIN = 34
RELAY_PINS = [18, 19, 22, 23]
BUZZER_PIN = 21
SERVO_PIN = 25
SWITCH_PINS = [32, 33, 26, 27]
BTN_ML_TOGGLE_PIN = 14
BTN_BUZZER_MUTE_PIN = 16
TARGET_NAMES = ["light1", "light2", "fan1", "fan2"]

SENSOR_INTERVAL_MS = 5000
SWITCH_DEBOUNCE_MS = 80
BUTTON_DEBOUNCE_MS = 200

pir1_pin = machine.Pin(PIR1_PIN, machine.Pin.IN)
ldr_pin = machine.ADC(machine.Pin(LDR_PIN))
ldr_pin.atten(machine.ADC.ATTN_11DB)
buzzer_pin = machine.Pin(BUZZER_PIN, machine.Pin.OUT, value=0)
relay_pins = [machine.Pin(pin, machine.Pin.OUT, value=0) for pin in RELAY_PINS]
switch_pins = [machine.Pin(pin, machine.Pin.IN, machine.Pin.PULL_UP) for pin in SWITCH_PINS]
btn_ml_pin = machine.Pin(BTN_ML_TOGGLE_PIN, machine.Pin.IN, machine.Pin.PULL_UP)
btn_buzzer_pin = machine.Pin(BTN_BUZZER_MUTE_PIN, machine.Pin.IN, machine.Pin.PULL_UP)
dht_sensor = dht.DHT11(machine.Pin(DHT_PIN))

relay_state = {name: False for name in TARGET_NAMES}
ml_enabled = True
buzzer_muted = False
last_switch_readings = [pin.value() for pin in switch_pins]
stable_switch_readings = list(last_switch_readings)
last_switch_debounce = [time.ticks_ms() for _ in switch_pins]

last_btn_ml_reading = btn_ml_pin.value()
stable_btn_ml_reading = last_btn_ml_reading
last_btn_ml_debounce = time.ticks_ms()

last_btn_buzzer_reading = btn_buzzer_pin.value()
stable_btn_buzzer_reading = last_btn_buzzer_reading
last_btn_buzzer_debounce = time.ticks_ms()


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
    global ml_enabled, buzzer_muted
    topic = topic.decode()
    msg = msg.decode().strip()
    print("MQTT [{}] -> {}".format(topic, msg))

    if topic == "{}/buzzer".format(DEVICE_ID):
        buzzer_pin.value(1 if msg == "ON" else 0)
        return

    if topic == "{}/ml_mode".format(DEVICE_ID):
        ml_enabled = (msg == "ON")
        return

    if topic == "{}/buzzer_mute".format(DEVICE_ID):
        buzzer_muted = (msg == "ON")
        if buzzer_muted:
            buzzer_pin.value(0)
        return

    if topic == "{}/door".format(DEVICE_ID):
        # Assume servo is attached
        # servo.write(90 if msg == "OPEN" else 0)
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
        return None, None, None, None, None

    pir1 = bool(pir1_pin.value())
    ldr = ldr_pin.read()
    motion = pir1

    return temp, humidity, pir1, motion, ldr


def publish_data(temp, humidity, pir1, motion, ldr):
    payload = json.dumps(
        {
            "device": DEVICE_ID,
            "temp": temp,
            "humidity": humidity,
            "pir1": pir1,
            "motion": motion,
            "ldr": ldr,
            "sw_light1": not switch_pins[0].value(),
            "sw_light2": not switch_pins[1].value(),
            "sw_fan1": not switch_pins[2].value(),
            "sw_fan2": not switch_pins[3].value(),
            "relay_light1": relay_state["light1"],
            "relay_light2": relay_state["light2"],
            "relay_fan1": relay_state["fan1"],
            "relay_fan2": relay_state["fan2"],
            "ml_enabled": ml_enabled,
            "buzzer_muted": buzzer_muted,
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


def check_buttons():
    global ml_enabled, buzzer_muted
    global last_btn_ml_reading, stable_btn_ml_reading, last_btn_ml_debounce
    global last_btn_buzzer_reading, stable_btn_buzzer_reading, last_btn_buzzer_debounce
    now = time.ticks_ms()

    # ML toggle
    reading = btn_ml_pin.value()
    if reading != last_btn_ml_reading:
        last_btn_ml_reading = reading
        last_btn_ml_debounce = now

    if time.ticks_diff(now, last_btn_ml_debounce) > BUTTON_DEBOUNCE_MS:
        if reading != stable_btn_ml_reading:
            stable_btn_ml_reading = reading
            if reading == 0:  # pressed
                ml_enabled = not ml_enabled
                client.publish("{}/ml_mode".format(DEVICE_ID), "ON" if ml_enabled else "OFF", True)
                print("ML mode toggled:", ml_enabled)

    # Buzzer mute
    reading = btn_buzzer_pin.value()
    if reading != last_btn_buzzer_reading:
        last_btn_buzzer_reading = reading
        last_btn_buzzer_debounce = now

    if time.ticks_diff(now, last_btn_buzzer_debounce) > BUTTON_DEBOUNCE_MS:
        if reading != stable_btn_buzzer_reading:
            stable_btn_buzzer_reading = reading
            if reading == 0:  # pressed
                buzzer_muted = not buzzer_muted
                client.publish("{}/buzzer_mute".format(DEVICE_ID), "ON" if buzzer_muted else "OFF", True)
                if buzzer_muted:
                    buzzer_pin.value(0)
                print("Buzzer mute toggled:", buzzer_muted)


connect_wifi()

client = MQTTClient(CLIENT_ID, MQTT_HOST, MQTT_PORT)
client.set_callback(mqtt_callback)
client.connect()

for name in TARGET_NAMES:
    client.subscribe(control_topic(name).encode())
client.subscribe("{}/buzzer".format(DEVICE_ID).encode())
client.subscribe("{}/ml_mode".format(DEVICE_ID).encode())
client.subscribe("{}/buzzer_mute".format(DEVICE_ID).encode())
client.subscribe("{}/door".format(DEVICE_ID).encode())

print("MQTT connected and subscribed.")

last_publish = time.ticks_ms()

while True:
    client.check_msg()
    check_manual_switches()
    check_buttons()

    now = time.ticks_ms()
    if time.ticks_diff(now, last_publish) >= SENSOR_INTERVAL_MS:
        temp, humidity, pir1, motion, ldr = read_sensors()
        if temp is not None:
            publish_data(temp, humidity, pir1, motion, ldr)
        last_publish = now

    time.sleep_ms(100)
