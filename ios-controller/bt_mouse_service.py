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

    # Create Report Characteristic (Notify + Read + WriteWithoutResponse)
    params = GattLocalCharacteristicParameters()
    params.characteristic_properties = (
        GattCharacteristicProperties.NOTIFY |
        GattCharacteristicProperties.READ |
        GattCharacteristicProperties.WRITE_WITHOUT_RESPONSE
    )
    params.read_protection_level = GattProtectionLevel.PLAIN

    char_res = await service_provider.service.create_characteristic_async(REPORT_CHAR_UUID, params)
    report_char = char_res.characteristic

    # Start Advertising
    adv_params = GattServiceProviderAdvertisingParameters()
    adv_params.is_connectable = True
    adv_params.is_discoverable = True
    service_provider.start_advertising_with_parameters(adv_params)
    print("[+] ========================================================")
    print("[+] Windows Bluetooth Mouse is now BROADCASTING & ADVERTISING!")
    print("[+] Open your iPhone: Settings > Accessibility > Touch > AssistiveTouch > Devices")
    print("[+] ========================================================")
    return True

async def send_mouse_report(buttons, dx, dy):
    global report_char
    if not report_char:
        return
    writer = DataWriter()
    clamped_x = max(-127, min(127, int(dx))) & 0xFF
    clamped_y = max(-127, min(127, int(dy))) & 0xFF
    writer.write_bytes(bytes([buttons & 0x07, clamped_x, clamped_y]))
    buffer = writer.detach_buffer()
    await report_char.notify_value_async(buffer)

async def handle_click(request):
    data = await request.json()
    buttons = data.get('buttons', 1)
    dx = data.get('dx', 0)
    dy = data.get('dy', 0)

    # Mouse Down
    await send_mouse_report(buttons, dx, dy)
    await asyncio.sleep(0.05)
    # Mouse Up
    await send_mouse_report(0, 0, 0)

    return web.json_response({"success": True})

async def main():
    await init_ble_mouse()
    app = web.Application()
    app.router.add_post('/click', handle_click)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 8200)
    await site.start()
    print("[+] Mouse HTTP Bridge active on http://127.0.0.1:8200/click")

    while True:
        await asyncio.sleep(3600)

if __name__ == '__main__':
    asyncio.run(main())
