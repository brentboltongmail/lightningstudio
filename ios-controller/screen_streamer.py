import shutil
import subprocess
import asyncio
from aiohttp import web


def _python_bin():
    """Prefer python3 (macOS/Homebrew); fall back to python."""
    return shutil.which("python3") or shutil.which("python") or "python3"


async def handle_screen(request):
    try:
        # Run CLI screenshot command using the active connection
        cmd = [_python_bin(), "-m", "pymobiledevice3", "developer", "dvt", "screenshot", "temp_screen.png"]
        proc = await asyncio.create_subprocess_exec(*cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        await proc.communicate()

        with open("temp_screen.png", "rb") as f:
            png_bytes = f.read()

        return web.Response(body=png_bytes, content_type='image/png', headers={
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Access-Control-Allow-Origin': '*'
        })
    except Exception as e:
        return web.Response(text=str(e), status=500, headers={'Access-Control-Allow-Origin': '*'})

async def main():
    print("[*] Screen server active on http://127.0.0.1:8150/screen.png")
    app = web.Application()
    app.router.add_get('/screen.png', handle_screen)
    app.router.add_get('/', handle_screen)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 8150)
    await site.start()

    while True:
        await asyncio.sleep(3600)

if __name__ == '__main__':
    asyncio.run(main())
