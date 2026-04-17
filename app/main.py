from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import json
from typing import Dict, Set
from datetime import datetime
import hashlib
from pathlib import Path

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/static", StaticFiles(directory="static"), name="static")

rooms_data = {}
rooms_list = set()
room_messages = {}
room_users = {}
room_keys = {}  # Хранилище ключей комнат
active_connections: Dict[str, Set[WebSocket]] = {}
user_rooms: Dict[WebSocket, Dict] = {}

class ChatRoom:
    async def create_room(self, room_name: str, password: str, creator: str, room_key: str = None):
        if room_name in rooms_list:
            return False, "Комната уже существует"
        
        hashed = hashlib.md5(password.encode()).hexdigest()
        
        rooms_data[room_name] = {
            "password": hashed,
            "creator": creator,
            "created_at": datetime.now().isoformat()
        }
        rooms_list.add(room_name)
        room_messages[room_name] = []
        room_users[room_name] = set()
        
        if room_key:
            room_keys[room_name] = room_key
        
        return True, "Комната создана"
    
    async def check_room_password(self, room_name: str, password: str) -> bool:
        if room_name not in rooms_data:
            return False
        hashed = hashlib.md5(password.encode()).hexdigest()
        return rooms_data[room_name]["password"] == hashed
    
    async def get_all_rooms(self) -> list:
        rooms_info = []
        for room in rooms_list:
            rooms_info.append({
                "name": room,
                "creator": rooms_data[room]["creator"]
            })
        return rooms_info
    
    async def connect(self, websocket: WebSocket, room: str, username: str, user_id: str):
        await websocket.accept()
        
        if room not in active_connections:
            active_connections[room] = set()
        
        active_connections[room].add(websocket)
        user_rooms[websocket] = {"room": room, "username": username, "user_id": user_id}
        
        if room not in room_users:
            room_users[room] = set()
        room_users[room].add(username)
        
        if room in room_messages:
            for msg in room_messages[room][-50:]:
                try:
                    await websocket.send_json(msg)
                except:
                    pass
        
        await self.broadcast_to_room(
            room,
            {
                "type": "system",
                "message": f"✨ {username} присоединился к чату",
                "timestamp": datetime.now().strftime("%H:%M")
            }
        )
        
        await self.send_user_list(room)
        
        # Отправляем ключ комнаты новому пользователю (если есть)
        if room in room_keys:
            await websocket.send_json({
                "type": "room_key",
                "key": room_keys[room]
            })
        
        print(f"✅ {username} подключился к комнате {room}")
        return True
    
    async def disconnect(self, websocket: WebSocket):
        if websocket in user_rooms:
            room = user_rooms[websocket]["room"]
            username = user_rooms[websocket]["username"]
            
            if room in active_connections:
                active_connections[room].discard(websocket)
            
            if room in room_users:
                room_users[room].discard(username)
            
            await self.broadcast_to_room(
                room,
                {
                    "type": "system",
                    "message": f"👋 {username} покинул чат",
                    "timestamp": datetime.now().strftime("%H:%M")
                }
            )
            await self.send_user_list(room)
            
            del user_rooms[websocket]
            print(f"❌ {username} отключился от комнаты {room}")
    
    async def send_user_list(self, room: str):
        users = list(room_users.get(room, set()))
        await self.broadcast_to_room(
            room,
            {
                "type": "users",
                "users": users,
                "count": len(users)
            }
        )
    
    async def broadcast_to_room(self, room: str, message: dict):
        if room in active_connections:
            to_remove = []
            for connection in active_connections[room]:
                try:
                    await connection.send_json(message)
                except:
                    to_remove.append(connection)
            
            for conn in to_remove:
                active_connections[room].discard(conn)

chat_room = ChatRoom()

@app.get("/", response_class=HTMLResponse)
async def get():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return f.read()

@app.get("/api/rooms")
async def get_rooms():
    try:
        rooms = await chat_room.get_all_rooms()
        return {"success": True, "rooms": rooms}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/api/create_room")
async def create_room(data: dict):
    try:
        room_name = data.get("name", "").strip().lower().replace(" ", "_")
        password = data.get("password", "")
        creator = data.get("creator", "")
        room_key = data.get("room_key", "")
        
        print(f"📝 Создание комнаты: {room_name}")
        
        if not room_name or not password:
            return {"success": False, "error": "Название и пароль обязательны"}
        
        success, message = await chat_room.create_room(room_name, password, creator, room_key)
        if success:
            print(f"✅ Комната {room_name} создана")
        else:
            print(f"❌ Ошибка: {message}")
        return {"success": success, "room": room_name if success else None, "error": message if not success else None}
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return {"success": False, "error": str(e)}

@app.post("/api/join_room")
async def join_room(data: dict):
    try:
        room_name = data.get("room", "")
        password = data.get("password", "")
        
        correct = await chat_room.check_room_password(room_name, password)
        if correct:
            return {"success": True}
        else:
            return {"success": False, "error": "Неверный пароль"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    if file.content_type not in allowed_types:
        return {"error": "Только изображения!"}
    
    file_ext = file.filename.split(".")[-1]
    file_hash = hashlib.md5(f"{datetime.now()}{file.filename}".encode()).hexdigest()
    file_name = f"{file_hash}.{file_ext}"
    file_path = UPLOAD_DIR / file_name
    
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    
    return {"url": f"/uploads/{file_name}"}

@app.websocket("/ws/{room}/{username}/{user_id}")
async def websocket_endpoint(websocket: WebSocket, room: str, username: str, user_id: str):
    await chat_room.connect(websocket, room, username, user_id)
    
    try:
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)
            
            if message_data["type"] == "message":
                chat_message = {
                    "id": hashlib.md5(f"{datetime.now()}{username}{message_data['message']}".encode()).hexdigest(),
                    "type": "message",
                    "username": username,
                    "message": message_data["message"],
                    "timestamp": datetime.now().strftime("%H:%M"),
                    "user_id": user_id
                }
                
                if "reply_to" in message_data and message_data["reply_to"]:
                    chat_message["reply_to"] = message_data["reply_to"]
                
                if room not in room_messages:
                    room_messages[room] = []
                room_messages[room].append(chat_message)
                if len(room_messages[room]) > 100:
                    room_messages[room] = room_messages[room][-100:]
                
                await chat_room.broadcast_to_room(room, chat_message)
                print(f"💬 {username}: {message_data['message'][:50]}")
            
            elif message_data["type"] == "edit_message":
                message_id = message_data["message_id"]
                new_text = message_data["new_text"]
                
                for i, msg in enumerate(room_messages[room]):
                    if msg.get("id") == message_id and msg.get("username") == username:
                        room_messages[room][i]["message"] = new_text
                        room_messages[room][i]["edited"] = True
                        room_messages[room][i]["edited_at"] = datetime.now().strftime("%H:%M")
                        
                        await chat_room.broadcast_to_room(room, {
                            "type": "message_edited",
                            "id": message_id,
                            "new_text": new_text,
                            "edited_at": datetime.now().strftime("%H:%M")
                        })
                        break
            
            elif message_data["type"] == "reaction":
                message_id = message_data["message_id"]
                reaction = message_data["reaction"]
                
                for msg in room_messages[room]:
                    if msg.get("id") == message_id:
                        if "reactions" not in msg:
                            msg["reactions"] = {}
                        
                        if reaction in msg["reactions"]:
                            if username in msg["reactions"][reaction]:
                                msg["reactions"][reaction].remove(username)
                                if not msg["reactions"][reaction]:
                                    del msg["reactions"][reaction]
                            else:
                                msg["reactions"][reaction].append(username)
                        else:
                            msg["reactions"][reaction] = [username]
                        
                        await chat_room.broadcast_to_room(room, {
                            "type": "reaction_update",
                            "id": message_id,
                            "reactions": msg["reactions"]
                        })
                        break
            
            elif message_data["type"] == "encrypted_message":
                encrypted_message = {
                    "id": hashlib.md5(f"{datetime.now()}{username}{message_data['encrypted']}".encode()).hexdigest(),
                    "type": "encrypted_message",
                    "username": username,
                    "encrypted": message_data["encrypted"],
                    "timestamp": datetime.now().strftime("%H:%M"),
                    "user_id": user_id
                }
                
                if "reply_to" in message_data and message_data["reply_to"]:
                    encrypted_message["reply_to"] = message_data["reply_to"]
                
                if room not in room_messages:
                    room_messages[room] = []
                room_messages[room].append(encrypted_message)
                if len(room_messages[room]) > 100:
                    room_messages[room] = room_messages[room][-100:]
                
                await chat_room.broadcast_to_room(room, encrypted_message)
                print(f"🔐 {username} отправил зашифрованное сообщение")
            
            elif message_data["type"] == "image":
                image_message = {
                    "id": hashlib.md5(f"{datetime.now()}{username}{message_data['url']}".encode()).hexdigest(),
                    "type": "image",
                    "username": username,
                    "url": message_data["url"],
                    "caption": message_data.get("caption", ""),
                    "timestamp": datetime.now().strftime("%H:%M"),
                    "user_id": user_id
                }
                
                if "reply_to" in message_data and message_data["reply_to"]:
                    image_message["reply_to"] = message_data["reply_to"]
                
                if room not in room_messages:
                    room_messages[room] = []
                room_messages[room].append(image_message)
                
                await chat_room.broadcast_to_room(room, image_message)
                print(f"🖼️ {username} отправил изображение")
                
    except WebSocketDisconnect:
        chat_room.disconnect(websocket)

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.delete("/api/rooms/{room_name}")
async def delete_room(room_name: str, username: str):
    try:
        if room_name not in rooms_list:
            return {"success": False, "error": "Комната не найдена"}
        
        if rooms_data[room_name]["creator"] != username:
            return {"success": False, "error": "Только создатель комнаты может удалить её"}
        
        if room_name in active_connections:
            for connection in list(active_connections[room_name]):
                try:
                    await connection.send_json({
                        "type": "room_deleted",
                        "message": f"Комната {room_name} удалена создателем"
                    })
                    await connection.close()
                except:
                    pass
            del active_connections[room_name]
        
        if room_name in rooms_data:
            del rooms_data[room_name]
        
        if room_name in rooms_list:
            rooms_list.remove(room_name)
        
        if room_name in room_messages:
            del room_messages[room_name]
        
        if room_name in room_users:
            del room_users[room_name]
        
        if room_name in room_keys:
            del room_keys[room_name]
        
        print(f"🗑️ Комната {room_name} удалена")
        return {"success": True, "message": "Комната успешно удалена"}
        
    except Exception as e:
        print(f"❌ Ошибка удаления комнаты: {e}")
        return {"success": False, "error": str(e)}

@app.get("/api/rooms/{room_name}/info")
async def get_room_info(room_name: str):
    if room_name not in rooms_data:
        return {"success": False, "error": "Комната не найдена"}
    
    return {
        "success": True,
        "room": {
            "name": room_name,
            "creator": rooms_data[room_name]["creator"],
            "created_at": rooms_data[room_name]["created_at"],
            "member_count": len(room_users.get(room_name, set()))
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)