import os
import ssl

def test_load():
    root = r"C:\Cursor AI"
    files = [
        ("localhost+2.pem", "localhost+2-key.pem"),
        ("localhost.pem", "localhost-key.pem"),
        ("cert.pem", "key.pem")
    ]
    
    for cert, key in files:
        cert_path = os.path.join(root, cert)
        key_path = os.path.join(root, key)
        
        print(f"Testing {cert} and {key}...")
        if os.path.exists(cert_path) and os.path.exists(key_path):
            print(f"  Files exist.")
            try:
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                context.load_cert_chain(certfile=cert_path, keyfile=key_path)
                print(f"  SUCCESS: Loaded into SSL context.")
            except Exception as e:
                print(f"  FAILED: {e}")
        else:
            print(f"  One or both files missing.")

if __name__ == "__main__":
    test_load()
