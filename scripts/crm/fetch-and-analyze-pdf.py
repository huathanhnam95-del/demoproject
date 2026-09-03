import os
import re
import json
import urllib.request
import fitz # PyMuPDF
import pdfplumber

ROOT = r"c:\Cursor AI"
CREDENTIALS_FILE = os.path.join(ROOT, ".local", "browser-test-credentials.md")
API_KEY = "AIzaSyB0vXX7NwOvME_XoaGiJlYaiLRcaHJtrIQ"
BASE_URL = "https://betterenglishlearning.com"
BOOK_ID = "if1GtQHgGoU7uolTPVXC"
PDF_PATH = os.path.join(ROOT, "artifacts", "books", "adult-learner.pdf")
os.makedirs(os.path.dirname(PDF_PATH), exist_ok=True)

with open(CREDENTIALS_FILE, "r", encoding="utf-8") as f:
    text = f.read()
email = re.search(r"Username:\s*`([^`]+)`", text).group(1).strip()
password = re.search(r"Password:\s*`([^`]+)`", text).group(1).strip()

def http_json(url, data=None, headers=None):
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, headers=req_headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

print("Authenticating...")
auth = http_json(f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={API_KEY}", {
    "email": email,
    "password": password,
    "returnSecureToken": True
})
token = auth["idToken"]
headers = {"Authorization": f"Bearer {token}"}

if not os.path.exists(PDF_PATH):
    print("Fetching download URL for source PDF...")
    res = http_json(f"{BASE_URL}/api/admin/books/{BOOK_ID}/download-source", headers=headers)
    dl_url = res["data"]["downloadUrl"]
    print("Downloading PDF...")
    urllib.request.urlretrieve(dl_url, PDF_PATH)
    print(f"Downloaded to {PDF_PATH} ({os.path.getsize(PDF_PATH)} bytes)")
else:
    print(f"PDF already exists at {PDF_PATH} ({os.path.getsize(PDF_PATH)} bytes)")

doc = fitz.open(PDF_PATH)
print(f"PyMuPDF open success: {len(doc)} pages")

for page_idx in [5, 7, 9, 10, 19]:
    p = doc[page_idx]
    text_default = p.get_text("text")
    text_blocks = p.get_text("blocks")
    print(f"\n==================== PyMuPDF Page {page_idx + 1} ====================")
    print("--- Default text extraction ---")
    print(text_default[:400])
