from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO
import random

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# State
players = {}     # sid -> {x, y, color}
buildings = []   # list of {x, y, owner}

def random_color():
    return "#" + "".join(random.choices("0123456789ABCDEF", k=6))

# Serve files
@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/static/<path:path>")
def send_static(path):
    return send_from_directory("static", path)

# Helper to emit current state
def emit_state():
    socketio.emit("state", {"players": players, "buildings": buildings})

# Socket events
@socketio.on("connect")
def on_connect():
    sid = request.sid
    players[sid] = {"x": 0, "y": 0, "color": random_color()}
    emit_state()

@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    players.pop(sid, None)
    # Remove all buildings owned by this player
    global buildings
    buildings = [b for b in buildings if b["owner"] != sid]
    emit_state()

@socketio.on("update")
def on_update(data):
    sid = request.sid
    if sid in players:
        players[sid]["x"] = data.get("x", players[sid]["x"])
        players[sid]["y"] = data.get("y", players[sid]["y"])
    emit_state()

@socketio.on("place_building")
def place_building(data):
    sid = request.sid
    buildings.append({"x": data["x"], "y": data["y"], "owner": sid})
    emit_state()

# Run server
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=8080)
