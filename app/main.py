from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import json
from typing import Dict, Set
from datetime import datetime
import hashlib
from pathlib import Path
import re

app = FastAPI()

# Добавляем CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Создаём папки
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/static", StaticFiles(directory="static"), name="static")

# Хранилище в памяти
rooms_data = {}
rooms_list = set()
room_messages = {}
room_users = {}
active_connections: Dict[str, Set[WebSocket]] = {}
user_rooms: Dict[WebSocket, Dict] = {}

# Классические эмодзи из ICQ/AIM
EMOJIS = {
    "smile": "☺️", "sad": "☹️", "wink": "😉", "tongue": "😛", "surprised": "😮",
    "heart": "❤️", "cool": "😎", "cry": "😢", "angry": "😠", "kiss": "😘",
    "clap": "👏", "thumbs_up": "👍", "thumbs_down": "👎", "laugh": "😄", "confused": "😕"
}

class ChatRoom:
    async def create_room(self, room_name: str, password: str, creator: str):
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
        
        print(f"📝 Создание комнаты: {room_name} пользователем {creator}")
        
        if not room_name or not password:
            return {"success": False, "error": "Название и пароль обязательны"}
        
        success, message = await chat_room.create_room(room_name, password, creator)
        if success:
            print(f"✅ Комната {room_name} создана")
        else:
            print(f"❌ Ошибка: {message}")
        return {"success": success, "room": room_name if success else None, "error": message if not success else None}
    except Exception as e:
        print(f"❌ Ошибка создания комнаты: {e}")
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
                # Обрабатываем @упоминания
                message_text = message_data["message"]
                mentions = re.findall(r'@(\w+)', message_text)
                
                chat_message = {
                    "id": hashlib.md5(f"{datetime.now()}{username}{message_text}".encode()).hexdigest(),
                    "type": "message",
                    "username": username,
                    "message": message_text,
                    "timestamp": datetime.now().strftime("%H:%M"),
                    "user_id": user_id,
                    "mentions": mentions,
                    "edited": False
                }
                
                if "reply_to" in message_data and message_data["reply_to"]:
                    chat_message["reply_to"] = message_data["reply_to"]
                
                if room not in room_messages:
                    room_messages[room] = []
                room_messages[room].append(chat_message)
                if len(room_messages[room]) > 100:
                    room_messages[room] = room_messages[room][-100:]
                
                await chat_room.broadcast_to_room(room, chat_message)
                
                # Отправляем уведомления об упоминаниях
                for mention in mentions:
                    await chat_room.broadcast_to_room(room, {
                        "type": "mention",
                        "from": username,
                        "to": mention,
                        "message": message_text,
                        "timestamp": datetime.now().strftime("%H:%M")
                    })
                
                print(f"💬 {username}: {message_text[:50]}")
            
            elif message_data["type"] == "edit_message":
                # Редактирование сообщения
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
                # Добавление реакции
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
            
            elif message_data["type"] == "image":
                image_message = {
                    "id": hashlib.md5(f"{datetime.now()}{username}{message_data['url']}".encode()).hexdigest(),
                    "type": "image",
                    "username": username,
                    "url": message_data["url"],
                    "caption": message_data.get("caption", ""),
                    "timestamp": datetime.now().strftime("%H:%M"),
                    "user_id": user_id,
                    "edited": False
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)