import os
import requests
import base64
from io import BytesIO
from PIL import Image

API_KEY_VERTEX = "AQ.Ab8RN6LiBU7Uh09wMsJ0wdLshpXFSkf6tD8R9SLwDj1WsfroTg"
MODEL_IDS = ["imagen-4.0-generate-preview-06-06", "imagen-3.0-generate-001"]
PROJECT_ID = "gen-lang-client-0677756745"

def test_imagen4():
    # Simple prompt to test
    prompt = "Dragon Nest-style hand-painted HQ fantasy ability icon, 256x256. A forbidden grimoire releasing a bright blue-white beam."
    
    payload = {
        "instances": [{"prompt": prompt}],
        "parameters": {"sampleCount": 1}
    }
    
    print(f"Testing Imagen with prompt: {prompt}")
    tried = set()
    
    for model in MODEL_IDS:
        global_url = f"https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:predict?key={API_KEY_VERTEX}"
        project_url = (
            f"https://us-central1-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}"
            f"/locations/us-central1/publishers/google/models/{model}:predict?key={API_KEY_VERTEX}"
        )
        
        for url in (global_url, project_url):
            if url in tried: continue
            tried.add(url)
            print(f"  Trying URL: {url}")
            try:
                response = requests.post(url, json=payload, timeout=60)
                res_json = response.json()
                
                if "predictions" in res_json:
                    img_b64 = res_json["predictions"][0]["bytesBase64Encoded"]
                    image_data = base64.b64decode(img_b64)
                    img = Image.open(BytesIO(image_data))
                    img.save("public/assets/skill-icons/custom/test_imagen4.png")
                    print(f"Successfully saved test_imagen4.png using model {model}")
                    return
                else:
                    print(f"    Failed (Code {response.status_code}): {res_json.get('error', {}).get('message', 'No predictions')}")
            except Exception as e:
                print(f"    Error: {e}")
    
    print("ALL ATTEMPTS FAILED")

if __name__ == "__main__":
    test_imagen4()
