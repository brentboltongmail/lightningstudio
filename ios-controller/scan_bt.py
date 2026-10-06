import asyncio
from bleak import BleakScanner

async def main():
    print("[*] Scanning for Bluetooth devices...")
    devices = await BleakScanner.discover(timeout=4.0)
    for d in devices:
        if d.name:
            print(f" -> Found: {d.name} ({d.address})")

if __name__ == '__main__':
    asyncio.run(main())
