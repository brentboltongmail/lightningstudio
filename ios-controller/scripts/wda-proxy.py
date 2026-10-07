#!/usr/bin/env python3
"""Proxy WDA HTTP (8100) + MJPEG (9100) from USB IPv6 tunnel to localhost."""
import asyncio
import json
import os
import sys
import urllib.request

TUNNEL_API = os.environ.get("WDA_TUNNEL_API", "http://127.0.0.1:49151/")
PORTS = [
    (int(os.environ.get("WDA_LOCAL_PORT", "8100")), int(os.environ.get("WDA_REMOTE_PORT", "8100"))),
    (int(os.environ.get("WDA_MJPEG_LOCAL_PORT", "9100")), int(os.environ.get("WDA_MJPEG_REMOTE_PORT", "9100"))),
]


def resolve_tunnel_addr():
    explicit = os.environ.get("WDA_TUNNEL_ADDR")
    if explicit:
        return explicit
    with urllib.request.urlopen(TUNNEL_API, timeout=3) as resp:
        data = json.load(resp)
    for _udid, tunnels in data.items():
        if tunnels:
            return tunnels[0]["tunnel-address"]
    raise RuntimeError("No active USB tunnel — is tunneld running?")


async def pipe(reader, writer):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


def make_handler(remote, rport):
    async def handle(local_reader, local_writer):
        try:
            remote_reader, remote_writer = await asyncio.open_connection(remote, rport)
        except Exception as e:
            print(f"connect {remote}:{rport} failed: {e}", flush=True)
            local_writer.close()
            return
        await asyncio.gather(
            pipe(local_reader, remote_writer),
            pipe(remote_reader, local_writer),
        )

    return handle


async def main():
    remote = resolve_tunnel_addr()
    print(f"tunnel {remote}", flush=True)
    servers = []
    for lport, rport in PORTS:
        server = await asyncio.start_server(make_handler(remote, rport), "127.0.0.1", lport)
        servers.append(server)
        print(f"proxy 127.0.0.1:{lport} -> [{remote}]:{rport}", flush=True)
    await asyncio.gather(*(s.serve_forever() for s in servers))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
