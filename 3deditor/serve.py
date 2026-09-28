import http.server
import socketserver
import webbrowser
import os
import sys
import subprocess
import time

PORT = 8080

def kill_process_on_port(port):
    """Find and kill any existing process listening on the given port (Windows & Unix)."""
    current_pid = os.getpid()
    if os.name == 'nt':
        try:
            cmd = f'netstat -ano -p tcp | findstr :{port}'
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            killed_any = False
            for line in result.stdout.strip().splitlines():
                parts = line.strip().split()
                if len(parts) >= 5 and 'LISTENING' in parts:
                    try:
                        pid = int(parts[-1])
                        if pid != 0 and pid != current_pid:
                            print(f"[*] Terminating prior server instance (PID {pid}) on port {port}...")
                            subprocess.run(f'taskkill /F /PID {pid}', shell=True, capture_output=True)
                            killed_any = True
                    except ValueError:
                        continue
            if killed_any:
                time.sleep(0.6)  # Give OS time to fully release the socket
        except Exception as e:
            print(f"Process cleanup note: {e}")
    else:
        try:
            cmd = f'lsof -ti:{port}'
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            for pid_str in result.stdout.strip().splitlines():
                try:
                    pid = int(pid_str)
                    if pid != current_pid:
                        os.kill(pid, 9)
                        time.sleep(0.5)
                except ValueError:
                    continue
        except Exception:
            pass

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS and disable caching so edits & models load immediately
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

def run_server():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    # 1. Kill any existing server on port 8080 to restart cleanly
    kill_process_on_port(PORT)
    
    # 2. Allow socket reuse
    socketserver.TCPServer.allow_reuse_address = True
    
    port = PORT
    for attempt in range(5):
        try:
            with socketserver.TCPServer(("", port), Handler) as httpd:
                url = f"http://localhost:{port}"
                print(f"=======================================================")
                print(f"   3D GLB Studio & Geometry Clipper Server Restarted  ")
                print(f"   URL: {url}")
                print(f"=======================================================")
                print(f"Opening your default browser...")
                webbrowser.open(url)
                print(f"Server is running. Press Ctrl+C to stop.")
                httpd.serve_forever()
                break
        except OSError as e:
            if attempt < 4:
                print(f"Port {port} busy, retrying cleanup...")
                kill_process_on_port(port)
                time.sleep(0.5)
            else:
                print(f"Error starting server on port {port}: {e}")
                sys.exit(1)

if __name__ == '__main__':
    try:
        run_server()
    except KeyboardInterrupt:
        print("\nServer stopped.")
