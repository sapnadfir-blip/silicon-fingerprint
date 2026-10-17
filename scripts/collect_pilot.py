#!/usr/bin/env python3
"""
WebGPU Contention Pilot Collection Server & Trace Aggregator
Used for aggregating multi-scale contention profiles across PES University lab machines.

Usage:
    python3 scripts/collect_pilot.py --port 8080
"""

import http.server
import socketserver
import os
import json
import time
import argparse

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data", "traces")
os.makedirs(DATA_DIR, exist_ok=True)

class TraceCollectorHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        if self.path == '/api/submit_trace':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                trace_json = json.loads(post_data.decode('utf-8'))
                label = trace_json.get('deviceLabel', 'unlabeled').replace(' ', '_').replace('/', '_')
                timestamp = int(time.time())
                filename = f"{label}_{timestamp}.json"
                filepath = os.path.join(DATA_DIR, filename)
                
                with open(filepath, 'w') as f:
                    json.dump(trace_json, f, indent=2)
                
                print(f"[+] Successfully recorded trace from device {device_id} -> {filepath}")
                
                response = {
                    "status": "success",
                    "saved": filename,
                    "total_traces": len(os.listdir(DATA_DIR))
                }
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(response).encode('utf-8'))
                return
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
                return

        self.send_response(404)
        self.end_headers()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="WebGPU Contention Pilot Collection Server")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on (default: 8080)")
    args = parser.parse_args()

    print("=" * 70)
    print("  WebGPU Contention Pilot Trace Collector")
    print(f"  Target Storage Directory: {DATA_DIR}")
    print(f"  Web Interface URL:        http://localhost:{args.port}")
    print("=" * 70)

    with socketserver.TCPServer(("", args.port), TraceCollectorHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[+] Collector shut down cleanly.")
