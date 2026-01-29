#!/usr/bin/env python3
"""
Simple HTTPS server for localhost
Run: python server.py
"""

import http.server
import ssl
import socketserver
import os
import subprocess
import sys

PORT = 8443

# Check if certificates exist
if not (os.path.exists('cert.pem') and os.path.exists('key.pem')):
    print("SSL certificates not found!")
    print("\nTo create certificates, run one of these commands:")
    print("\nOption 1: Using OpenSSL (if installed):")
    print('  openssl req -x509 -newkey rsa:4096 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost"')
    print("\nOption 2: Using mkcert (recommended):")
    print("  1. Install from: https://github.com/FiloSottile/mkcert")
    print("  2. Run: mkcert -install")
    print("  3. Run: mkcert localhost")
    print("  4. Rename to cert.pem and key.pem")
    print("\nFor now, starting HTTP server on port 8080 instead...")
    
    # Fallback to HTTP
    Handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer(("", 8080), Handler) as httpd:
        print(f"Server running at http://localhost:8080/")
        print("Note: For microphone access, HTTPS is recommended.")
        httpd.serve_forever()
else:
    Handler = http.server.SimpleHTTPRequestHandler
    
    class MyHTTPRequestHandler(Handler):
        def end_headers(self):
            # Add CORS headers if needed
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            Handler.end_headers(self)

        def do_OPTIONS(self):
            self.send_response(200)
            self.end_headers()

        def do_POST(self):
            # Basic proxy handling or 404/501 mitigation
            if self.path.startswith('/api/'):
                self.send_response(503) # Service Unavailable - redirect to Node.js
                self.end_headers()
                self.wfile.write(b'{"error": "Please restart using Node.js server"}')
            else:
                self.send_error(501, "Unsupported method ('POST')")
    
    with socketserver.TCPServer(("", PORT), MyHTTPRequestHandler) as httpd:
        # Create SSL context
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain('cert.pem', 'key.pem')
        
        httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
        
        print(f"Server running at https://localhost:{PORT}/")
        print("Note: Your browser will show a security warning for the self-signed certificate.")
        print("Click 'Advanced' and then 'Proceed to localhost' to continue.")
        httpd.serve_forever()

