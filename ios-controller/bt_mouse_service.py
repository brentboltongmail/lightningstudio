import asyncio
import sys
import json
from aiohttp import web
from winrt.windows.devices.bluetooth.genericattributeprofile import (
    GattServiceProvider,
    GattLocalCharacteristicParameters,
    GattCharacteristicProperties,
    GattProtectionLevel,
    GattServiceProviderAdvertisingParameters
)
from winrt.windows.devices.bluetooth import BluetoothUuidHelper
from winrt.windows.storage.streams import DataWriter

# UUIDs
HID_SERVICE_UUID = BluetoothUuidHelper.from_short_id(0x1812)
REPORT_CHAR_UUID = BluetoothUuidHelper.from_short_id(0x2A4D)
REPORT_MAP_UUID = BluetoothUuidHelper.from_short_id(0x2A4B)
HID_INFO_UUID = BluetoothUuidHelper.from_short_id(0x2A4A)
HID_CONTROL_POINT_UUID = BluetoothUuidHelper.from_short_id(0x2A4C)
PROTOCOL_MODE_UUID = BluetoothUuidHelper.from_short_id(0x2A4E)

RELATIVE_MOUSE_REPORT_DESCRIPTOR = bytes([
    0x05, 0x01,        # Usage Page (Generic Desktop Ctrls)
    0x09, 0x02,        # Usage (Mouse)
    0xA1, 0x01,        # Collection (Application)
    
    0x85, 0x01,        #   Report ID (1)
    
    0x09, 0x01,        #   Usage (Pointer)
    0xA1, 0x00,        #   Collection (Physical)
    
    # Buttons
    0x05, 0x09,        #     Usage Page (Button)
    0x19, 0x01,        #     Usage Minimum (0x01)
    0x29, 0x03,        #     Usage Maximum (0x03)
    0x15, 0x00,        #     Logical Minimum (0)
    0x25, 0x01,        #     Logical Maximum (1)
    0x95, 0x03,        #     Report Count (3)
    0x75, 0x01,        #     Report Size (1)
    0x81, 0x02,        #     Input (Data,Var,Abs)
    
    # Padding
    0x95, 0x01,        #     Report Count (1)
    0x75, 0x05,        #     Report Size (5)
    0x81, 0x03,        #     Input (Const,Var,Abs)
    
    # X and Y (Relative)
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

service_provider = None
report_char = None

async def init_ble_mouse():
    global service_provider, report_char
    print("[*] Initializing Bluetooth HID Service...")
    res = await GattServiceProvider.create_async(HID_SERVICE_UUID)
    if res.error != 0:
        print(f"[-] Failed to create HID service: {res.error}")
        return False
    service_provider = res.service_provider

    # HID Information Characteristic
    hid_info_params = GattLocalCharacteristicParameters()
    hid_info_params.characteristic_properties = GattCharacteristicProperties.READ
    hid_info_params.read_protection_level = GattProtectionLevel.PLAIN
    writer = DataWriter()
    writer.write_bytes(bytes([0x11, 0x01, 0x00, 0x02])) # bcdHID=1.11, bCountryCode=0, Flags=Normal connectable
    hid_info_params.static_value = writer.detach_buffer()
    await service_provider.service.create_characteristic_async(HID_INFO_UUID, hid_info_params)

    # Protocol Mode Characteristic
    protocol_mode_params = GattLocalCharacteristicParameters()
    protocol_mode_params.characteristic_properties = GattCharacteristicProperties.READ | GattCharacteristicProperties.WRITE_WITHOUT_RESPONSE
    protocol_mode_params.read_protection_level = GattProtectionLevel.PLAIN
    writer = DataWriter()
    writer.write_bytes(bytes([0x01])) # 1 = Report Protocol
    protocol_mode_params.static_value = writer.detach_buffer()
    await service_provider.service.create_characteristic_async(PROTOCOL_MODE_UUID, protocol_mode_params)

    # HID Control Point Characteristic (Mandatory for iOS)
    control_point_params = GattLocalCharacteristicParameters()
    control_point_params.characteristic_properties = GattCharacteristicProperties.WRITE_WITHOUT_RESPONSE
    control_point_params.write_protection_level = GattProtectionLevel.PLAIN
    await service_provider.service.create_characteristic_async(HID_CONTROL_POINT_UUID, control_point_params)

    # Report Map Characteristic
    report_map_params = GattLocalCharacteristicParameters()
    report_map_params.characteristic_properties = GattCharacteristicProperties.READ
    report_map_params.read_protection_level = GattProtectionLevel.PLAIN
    writer = DataWriter()
    writer.write_bytes(RELATIVE_MOUSE_REPORT_DESCRIPTOR)
    report_map_params.static_value = writer.detach_buffer()
    await service_provider.service.create_characteristic_async(REPORT_MAP_UUID, report_map_params)

    # Report Characteristic
    params = GattLocalCharacteristicParameters()
    params.characteristic_properties = (
        GattCharacteristicProperties.NOTIFY |
        GattCharacteristicProperties.READ |
        GattCharacteristicProperties.WRITE_WITHOUT_RESPONSE
    )
    params.read_protection_level = GattProtectionLevel.PLAIN

    char_res = await service_provider.service.create_characteristic_async(REPORT_CHAR_UUID, params)
    report_char = char_res.characteristic

    # Report Reference Descriptor (Mandatory for HOGP)
    # Value: [Report ID, Report Type (1=Input)]
    from winrt.windows.devices.bluetooth.genericattributeprofile import GattLocalDescriptorParameters
    desc_params = GattLocalDescriptorParameters()
    desc_params.read_protection_level = GattProtectionLevel.PLAIN
    writer = DataWriter()
    writer.write_bytes(bytes([0x01, 0x01])) # Report ID 1, Input Report
    desc_params.static_value = writer.detach_buffer()
    await report_char.create_descriptor_async(BluetoothUuidHelper.from_short_id(0x2908), desc_params)

    # Start Advertising HID Service
    adv_params = GattServiceProviderAdvertisingParameters()
    adv_params.is_connectable = True
    adv_params.is_discoverable = True
    service_provider.start_advertising_with_parameters(adv_params)
    
    # ---------------------------------------------------------
    # Device Information Service (Mandatory for iOS HID!)
    # ---------------------------------------------------------
    DEVICE_INFO_SERVICE_UUID = BluetoothUuidHelper.from_short_id(0x180A)
    PNP_ID_UUID = BluetoothUuidHelper.from_short_id(0x2A50)
    
    res_di = await GattServiceProvider.create_async(DEVICE_INFO_SERVICE_UUID)
    if res_di.error == 0:
        di_provider = res_di.service_provider
        pnp_params = GattLocalCharacteristicParameters()
        pnp_params.characteristic_properties = GattCharacteristicProperties.READ
        pnp_params.read_protection_level = GattProtectionLevel.PLAIN
        
        # PnP ID Value: Source=0x02 (USB), VID=0x05AC (Apple), PID=0x022C (Magic Mouse), Version=0x0100
        pnp_writer = DataWriter()
        pnp_writer.write_bytes(bytes([0x02, 0xAC, 0x05, 0x2C, 0x02, 0x00, 0x01]))
        pnp_params.static_value = pnp_writer.detach_buffer()
        
        await di_provider.service.create_characteristic_async(PNP_ID_UUID, pnp_params)
        
        di_adv_params = GattServiceProviderAdvertisingParameters()
        di_adv_params.is_connectable = True
        di_adv_params.is_discoverable = False # HID is the primary advertisement
        di_provider.start_advertising_with_parameters(di_adv_params)
        print("[+] Device Information Service (PnP ID) BROADCASTING!")
    else:
        print("[-] Failed to create Device Information Service.")

    print("[+] Windows Bluetooth Relative Mouse is now BROADCASTING!")
    return True

async def send_mouse_report(buttons, dx, dy):
    global report_char
    if not report_char:
        return
    
    if report_char.subscribed_clients.size == 0:
        print("[!] Warning: iPhone has NOT subscribed to mouse movements (pairing/encryption issue?)")
    
    writer = DataWriter()
    
    clamped_x = max(-127, min(127, int(dx))) & 0xFF
    clamped_y = max(-127, min(127, int(dy))) & 0xFF
    
    # Payload: Buttons, dx, dy (Omit Report ID since there's only one in the map)
    writer.write_bytes(bytes([buttons & 0x07, clamped_x, clamped_y]))
    buffer = writer.detach_buffer()
    await report_char.notify_value_async(buffer)
    await asyncio.sleep(0.01)

async def handle_move(request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    dx = data.get('dx', 0)
    dy = data.get('dy', 0)
    print(f"[HTTP] Received move: dx={dx}, dy={dy}")
    await send_mouse_report(0, dx, dy)
    return web.json_response({"success": True})

async def handle_click(request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    buttons = data.get('buttons', 1)
    
    print(f"[HTTP] Received click: buttons={buttons}")
    # Mouse Down
    await send_mouse_report(buttons, 0, 0)
    await asyncio.sleep(0.05)
    # Mouse Up
    await send_mouse_report(0, 0, 0)
    return web.json_response({"success": True})

async def main():
    await init_ble_mouse()
    app = web.Application()
    app.router.add_post('/move', handle_move)
    app.router.add_post('/click', handle_click)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 8200)
    await site.start()
    print("[+] Mouse HTTP Bridge active on http://127.0.0.1:8200")

    while True:
        await asyncio.sleep(3600)

if __name__ == '__main__':
    asyncio.run(main())
