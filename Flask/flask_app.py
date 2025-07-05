from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "https://spite.nz"}})

# === Shared game state ===
players = {}
placed_tiles = {}
building_tiles = {}

@app.route('/')
def index():
    return "Backend running!"

@app.route('/update_position', methods=['POST'])
def update_position():
    data = request.json
    sid = data.get('sid')
    if not sid:
        return jsonify(success=False, error="Missing sid"), 400
    name = data.get('name', 'Anon')
    players[sid] = {
        'x': data['x'],
        'y': data['y'],
        'name': name
    }
    return jsonify(success=True)

@app.route('/get_positions', methods=['GET'])
def get_positions():
    return jsonify(players)

@app.route('/place_tile', methods=['POST'])
def place_tile():
    data = request.json
    key = f"{data['x']},{data['y']}"
    placed_tiles[key] = data['tile']
    return jsonify(success=True)

@app.route('/get_tiles', methods=['GET'])
def get_tiles():
    return jsonify(placed_tiles)

@app.route('/build_cube', methods=['POST'])
def build_cube():
    data = request.json
    key = f"{data['x']},{data['y']}"
    height = data.get('height', 0)
    if height <= 0:
        building_tiles.pop(key, None)
    else:
        building_tiles[key] = height
    return jsonify(success=True)

@app.route('/get_buildings', methods=['GET'])
def get_buildings():
    return jsonify(building_tiles)

# Add after your other shared state:
chat_messages = []

# New routes:
@app.route('/send_chat', methods=['POST'])
def send_chat():
    data = request.json
    sid = data.get('sid')
    text = data.get('text', '').strip()
    if not sid or not text:
        return jsonify(success=False, error="Missing sid or text"), 400
    name = players.get(sid, {}).get('name', 'Anon')
    chat_messages.append({
        'sid': sid,
        'name': name,
        'text': text,
        'timestamp': datetime.utcnow().isoformat()
    })
    if len(chat_messages) > 100:
        chat_messages.pop(0)
    return jsonify(success=True)

@app.route('/get_chats', methods=['GET'])
def get_chats():
    return jsonify(chat_messages)

@app.route('/disconnect', methods=['POST'])
def disconnect():
    data = request.json
    sid = data.get('sid')
    if sid in players:
        del players[sid]
    return jsonify(success=True)

if __name__ == '__main__':
    app.run(debug=True)
