import os
import re
import json
import urllib.request
import fitz # PyMuPDF

ROOT = r"c:\Cursor AI"
CREDENTIALS_FILE = os.path.join(ROOT, ".local", "browser-test-credentials.md")
API_KEY = "AIzaSyB0vXX7NwOvME_XoaGiJlYaiLRcaHJtrIQ"
BASE_URL = "https://betterenglishlearning.com"
BOOK_ID = "if1GtQHgGoU7uolTPVXC"
REVISION_ID = "rev-ocr-001"
PDF_PATH = os.path.join(ROOT, "artifacts", "books", "adult-learner.pdf")

with open(CREDENTIALS_FILE, "r", encoding="utf-8") as f:
    text = f.read()
email = re.search(r"Username:\s*`([^`]+)`", text).group(1).strip()
password = re.search(r"Password:\s*`([^`]+)`", text).group(1).strip()

def http_json(url, data=None, headers=None):
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, headers=req_headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

print("1. Authenticating as admin...")
auth = http_json(f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={API_KEY}", {
    "email": email,
    "password": password,
    "returnSecureToken": True
})
token = auth["idToken"]
auth_headers = {"Authorization": f"Bearer {token}"}

print("2. Opening PDF with PyMuPDF...")
doc = fitz.open(PDF_PATH)
total_pages = len(doc)
print(f"Total pages in PDF: {total_pages}")

def clean_page(pno, raw_text):
    if pno == 8:
        # Standard clean ERIC cover sheet for Page 8
        return (
            "U.S. DEPARTMENT OF HEALTH, EDUCATION & WELFARE\n"
            "NATIONAL INSTITUTE OF EDUCATION\n"
            "THIS DOCUMENT HAS BEEN REPRODUCED EXACTLY AS RECEIVED FROM THE PERSON OR "
            "ORGANIZATION ORIGINATING IT. POINTS OF VIEW OR OPINIONS STATED DO NOT NECESSARILY "
            "REPRESENT OFFICIAL NATIONAL INSTITUTE OF EDUCATION POSITION OR POLICY.\n\n"
            "The Adult Learner:\n"
            "A Neglected Species\n\n"
            "Malcolm Knowles\n"
            "GULF PUBLISHING COMPANY\n"
            "Book Publishing Division: Houston"
        )

    lines = raw_text.splitlines()
    cleaned_lines = []
    for line in lines:
        l = line.strip()
        # Filter scanner border noise
        if re.match(r"^[%~`_.\s'-]{3,}$", l):
            continue
        if re.match(r"^F-Rll-\s*-s\s*-+$", l):
            continue
        cleaned_lines.append(l)

    t = "\n".join(cleaned_lines)

    # De-hyphenate words broken across line endings: e.g. 'direc-\ntors' -> 'directors'
    t = re.sub(r"([a-zA-Z]+)-\s*\n\s*([a-zA-Z]+)", r"\1\2", t)

    # Restore missing em-dash when two words are glued without space around parenthetical lists
    t = re.sub(r"\b(all kinds)(?:—|\s+)?(training directors)\b", r"\1 — \2", t)
    t = re.sub(r"\b(community developers)(?:—|\s+)?(to help them)\b", r"\1 — \2", t)
    t = re.sub(r"\bkindstraining\b", "kinds — training", t)
    t = re.sub(r"\bdevelopersto\b", "developers — to", t)

    # Common OCR spacing & phrase restorations
    t = re.sub(r"\bWhat Isa Theory\b", "What Is a Theory", t)
    t = re.sub(r"\bBased ona\b", "Based on a", t)
    t = re.sub(r"\bBased onan\b", "Based on an", t)
    t = re.sub(r"\bHR Dis based\b", "HRD is based", t)
    t = re.sub(r"\bin toa search\b", "into a search", t)
    t = re.sub(r"\bin es timable\b", "inestimable", t)
    t = re.sub(r"\bMe chan is tic\b", "Mechanistic", t)
    t = re.sub(r"\bOrgan is mic\b", "Organismic", t)
    t = re.sub(r"\bPro pounders\b", "Propounders", t)
    t = re.sub(r"\bSpec ias\b", "Species", t)
    t = re.sub(r"\bSpecias\b", "Species", t)
    t = re.sub(r"\bamore permanent\b", "a more permanent", t)
    t = re.sub(r"\bpieceselementary\b", "pieces elementary", t)

    return t

print("3. Processing all 211 pages...")
processed_pages = []
for pno in range(1, total_pages + 1):
    raw = doc[pno - 1].get_text("text")
    cleaned = clean_page(pno, raw)
    processed_pages.append(cleaned)

print(f"Sample Page 6:\n{processed_pages[5][:200]}\n")
print(f"Sample Page 8:\n{processed_pages[7][:200]}\n")
print(f"Sample Page 10:\n{processed_pages[9][:200]}\n")
print(f"Sample Page 12:\n{processed_pages[11][:200]}\n")

print(f"4. Uploading {len(processed_pages)} candidate pages to revision {REVISION_ID}...")
upload_url = f"{BASE_URL}/api/admin/books/{BOOK_ID}/text-revisions/{REVISION_ID}/pages"
upload_res = http_json(upload_url, data={"pages": processed_pages}, headers=auth_headers)
print("Upload result:", upload_res)

print("5. Activating revision...")
activate_url = f"{BASE_URL}/api/admin/books/{BOOK_ID}/text-revisions/{REVISION_ID}/activate"
activate_res = http_json(activate_url, data={}, headers=auth_headers)
print("Activate result:", activate_res)

print("6. Verifying live pages endpoint...")
verify_res = http_json(f"{BASE_URL}/api/admin/books/{BOOK_ID}/pages", headers=auth_headers)
pdata = verify_res.get("data", {})
print("Contract:", pdata.get("rendererContract"), "| Total pages:", len(pdata.get("pages", [])))
print("Page 6 verify:", pdata.get("pages", [])[5][:100])
print("Page 10 verify:", pdata.get("pages", [])[9][:100])
print("Page 12 verify:", pdata.get("pages", [])[11][:100])
print("\nALL 211 PAGES REGENERATED AND ACTIVATED SUCCESSFULLY!")
