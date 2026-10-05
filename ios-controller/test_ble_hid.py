import asyncio
import sys
from winrt.windows.devices.bluetooth.genericattributeprofile import (
    GattServiceProvider,
    GattLocalCharacteristicParameters,
    GattCharacteristicProperties,
    GattProtectionLevel,
    GattServiceProviderAdvertisingParameters
)
from winrt.windows.devices.bluetooth import BluetoothUuidHelper
from winrt.windows.storage.streams import DataWriter

# Standard HID Service UUID (0x1812)
HID_SERVICE_UUID = BluetoothUuidHelper.from_short_id(0x1812)
# Report Characteristic UUID (0x2A4D)
REPORT_CHAR_UUID = BluetoothUuidHelper.from_short_id(0x2A4D)
# HID Information (0x2A4A)
HID_INFO_UUID = BluetoothUuidHelper.from_short_id(0x2A4A)
# Report Map (0x2A4B)
REPORT_MAP_UUID = BluetoothUuidHelper.from_short_id(0x2A4B)
# Protocol Mode (0x2A4E)
PROTOCOL_MODE_UUID = BluetoothUuidHelper.from_short_id(0x2A4E)

# Standard Mouse HID Report Descriptor
MOUSE_REPORT_DESCRIPTOR = bytes([
    0x05, 0x01,        # Usage Page (Generic Desktop Ctrls)
    0x09, 0x02,        # Usage (Mouse)
    0xA1, 0x01,        # Collection (Application)
    0x09, 0x01,        #   Usage (Pointer)
    0xA1, 0x00,        #   Collection (Physical)
    0x05, 0x09,        #     Usage Page (Button)
    0x19, 0x01,        #     Usage Minimum (0x01)
    0x29, 0x03,        #     Usage Maximum (0x03)
    0x15, 0x00,        #     Logical Minimum (0)
    0x25, 0x01,        #     Logical Maximum (1)
    0x95, 0x03,        #     Report Count (3)
    0x75, 0x01,        #     Report Size (1)
    0x81, 0x02,        #     Input (Data,Var,Abs)
    0x95, 0x01,        #     Report Count (1)
    0x75, 0x05,        #     Report Size (5)
    0x81, 0x03,        #     Input (Const,Var,Abs)
    0x05, 0x01,        #     Usage Page (Generic Desktop Ctrls)
    0x09, 0x30,        #     Usage (X)
    0x09, 0x31,        #     Usage (Y)
    0x15, 0x81,        #     Logical Minimum (-127)
    0x25, 0x7F,        #     Logical Maximum (127)
    0x75, 0x08,        #     Report Size (8)
    0x95, 0x02,        #     Report Count (2)
    0x81, 0x06,        #     Input (Data,Var,Rel)
    0xC0,              #   End Collection
    0xC0               # End Collection
])

async def start_hid_mouse():
    print("[*] Initializing Windows BLE HID Mouse Service...")
    result = await GattServiceProvider.create_async(HID_SERVICE_UUID)
    if result.error != 0:
        print(f"[-] Failed to create HID service: {result.error}")
        return

    service_provider = result.service_provider
    print("[+] Created GATT HID Service Provider successfully.")

if __name__ == '__main__':
    asyncio.run(start_hid_mouse())
