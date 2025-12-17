from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO
import random

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# State


players = {}     # sid -> {x, y, color}
buildings = []   # list of {x, y, owner}



# Add global state for trees
trees = []

# Function to generate a random tree
def generate_tree():
    return {"x": random.randint(-8000, 8000), "y": random.randint(-8000, 8000)}

# Function to generate n trees
def generate_trees(n=50):
    global trees
    for _ in range(n):
        trees.append(generate_tree())

# Emit trees to a client
def emit_trees(sid=None):
    if sid:
        socketio.emit("server_trees", trees, to=sid)
    else:
        socketio.emit("server_trees", trees)


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
    # Add player
    players[sid] = {"x": 0, "y": 0, "color": random_color(), "units": [
        {"x": 0, "y": 0, "hp":100, "tx":0, "ty":0, "anim":"idle", "frame":0, "attackFrame":0,"dir":"000", "selected": False}
    ]}
    
    # Generate trees once
    if not trees:
        generate_trees(100)  # for example, 100 trees

    # Send current state and trees
    emit_state()
    emit_trees(sid)



@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid

    # Remove player
    if sid in players:
        players.pop(sid)

    # Remove their buildings
    global buildings
    buildings = [b for b in buildings if b["owner"] != sid]

    # Tell ALL clients to hard-sync
    socketio.emit("state", {
        "players": players,
        "buildings": buildings
    })

@socketio.on("update")
def on_update(data):
    sid = request.sid
    if sid in players:
        players[sid]["x"] = data.get("x", players[sid]["x"])
        players[sid]["y"] = data.get("y", players[sid]["y"])
    emit_state()

@socketio.on("spawn_unit")
def spawn_unit(data):
    sid = request.sid
    if sid not in players: return
    unit = data["unit"]
    # Make sure server tracks hp, anim, attackFrame
    unit.setdefault("hp", 100)
    unit.setdefault("anim", "idle")
    unit.setdefault("attackFrame", 0)
    players[sid]["units"].append(unit)

    # Broadcast new unit to all clients
    socketio.emit("update_units", {"sid": sid, "units": players[sid]["units"]})


@socketio.on("attack_unit")
def handle_attack(data):
    target_sid = data["targetSid"]
    target_idx = data["targetIdx"]
    damage = data["damage"]

    if target_sid in players:
        units = players[target_sid].get("units", [])
        if 0 <= target_idx < len(units):
            # Apply damage
            units[target_idx]["hp"] = max(0, units[target_idx]["hp"] - damage)

            # Broadcast updated HP to all clients
            socketio.emit("unit_hp_update", {
                "sid": target_sid,
                "idx": target_idx,
                "hp": units[target_idx]["hp"]
            })

            # Remove the unit if HP is 0
            if units[target_idx]["hp"] == 0:
                units.pop(target_idx)
                socketio.emit("update_units", {"sid": target_sid, "units": units})

        # Optionally, remove player if all units are dead
        if len(units) == 0:
            # Remove player completely
            players.pop(target_sid)
            # Remove their buildings
            global buildings
            buildings = [b for b in buildings if b["owner"] != target_sid]
            # Broadcast updated state
            emit_state()






@socketio.on("update_units")
def on_update_units(data):
    sid = request.sid
    if sid not in players: return

    client_units = data.get("units", [])
    server_units = players[sid].get("units", [])

    for i, cu in enumerate(client_units):
        if i < len(server_units):
            # Only update position/animation/selection, NOT hp
            server_units[i].update({
                "x": cu.get("x", server_units[i]["x"]),
                "y": cu.get("y", server_units[i]["y"]),
                "tx": cu.get("tx", server_units[i].get("tx", 0)),
                "ty": cu.get("ty", server_units[i].get("ty", 0)),
                "anim": cu.get("anim", server_units[i].get("anim", "idle")),
                "dir": cu.get("dir", server_units[i].get("dir", "000")),
                "selected": cu.get("selected", server_units[i].get("selected", False))
            })
        else:
            # Add new unit with hp
            cu.setdefault("hp", 100)
            cu.setdefault("anim", "idle")
            cu.setdefault("attackFrame", 0)
            server_units.append(cu)

    players[sid]["units"] = server_units
    socketio.emit("update_units", {"sid": sid, "units": server_units})


@socketio.on("place_building")
def place_building(data):
    sid = request.sid
    buildings.append({"x": data["x"], "y": data["y"], "owner": sid})
    emit_state()

# Run server
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=8080)
