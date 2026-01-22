import http.server
import ssl
import os

PORT = 8443

# Get the project root (2 levels up from this file)
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Certificate files should be in project root
POSSIBLE_CERTS = [
    (os.path.join(PROJECT_ROOT, "localhost+2.pem"), os.path.join(PROJECT_ROOT, "localhost+2-key.pem")),
    (os.path.join(PROJECT_ROOT, "localhost.pem"), os.path.join(PROJECT_ROOT, "localhost-key.pem")),
    # Also check current directory as fallback
    ("localhost+2.pem", "localhost+2-key.pem"),
    ("localhost.pem", "localhost-key.pem")
]

def get_certs():
    for cert, key in POSSIBLE_CERTS:
        if os.path.exists(cert) and os.path.exists(key):
            return cert, key
    return None, None

def run_server():
    # Change to project root to serve files from there
    os.chdir(PROJECT_ROOT)
    print(f"Serving files from: {PROJECT_ROOT}")
    
    server_address = ('', PORT)
    httpd = http.server.HTTPServer(server_address, http.server.SimpleHTTPRequestHandler)

    cert_file, key_file = get_certs()
    if not cert_file:
        print(f"Error: Missing certificates. Checked: {POSSIBLE_CERTS}")
        print("Run 'generate_cert.ps1' or 'mkcert -install && mkcert localhost' to create them.")
        return

    print(f"Using cert: {cert_file}")
    print(f"Using key:  {key_file}")
    print(f"\n🚀 Starting HTTPS server on https://localhost:{PORT}")
    print("   Open this URL in your browser")
    print("-" * 50)
    
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=cert_file, keyfile=key_file)
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    httpd.serve_forever()

if __name__ == '__main__':
    run_server()
