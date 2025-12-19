from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Allow frontend requests

@app.route('/')
def home():
    return jsonify({
        "message": "Backend API",
        "version": "1.0",
        "endpoints": {
            "/api/health": "GET - Check API health"
        }
    })

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy"})

if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', 5000))
    host = os.environ.get('HOST', '0.0.0.0')
    debug = os.environ.get('DEBUG', 'True').lower() == 'true'
    
    print("\n" + "="*60)
    print(f"🚀 Server starting on http://{host}:{port}")
    print("="*60 + "\n")
    app.run(debug=debug, port=port, host=host)

