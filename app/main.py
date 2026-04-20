from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Request, Depends, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import json
from typing import Dict, Set
from datetime import datetime, timedelta
import hashlib
from pathlib import Path
import secrets
import os
import uuid
from database import get_db, User, Room, RoomMessage, RoomUser, PrivateChat, PrivateMessage
from email_service import email_service
from sqlalchemy.orm import Session

app = FastAPI()

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
AVATAR_DIR = Path("uploads/avatars")
AVATAR_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/static", StaticFiles(directory="static"), name="static")

# Хранилище в памяти для активных WebSocket соединений
active_connections: Dict[str, Set[WebSocket]] = {}
user_rooms: Dict[WebSocket, Dict] = {}

# Данные комнат в памяти
rooms_data = {}
rooms_list = set()
room_messages = {}
room_users = {}

class ChatRoom:
    async def create_room(self, room_name: str, password: str, creator: str, db: Session):
        if room_name in rooms_list:
            return False, "Комната с таким названием уже существует", None
        
        room_uuid = str(uuid.uuid4())[:8]
        password_hash = hashlib.md5(password.encode()).hexdigest()
        
        new_room = Room(
            name=room_name,
            room_uuid=room_uuid,
            password_hash=password_hash,
            creator=creator
        )
        db.add(new_room)
        db.commit()
        
        rooms_data[room_name] = {
            "id": room_uuid,
            "password": password_hash,
            "creator": creator,
            "created_at": datetime.now().isoformat()
        }
        rooms_list.add(room_name)
        room_messages[room_name] = []
        room_users[room_name] = set()
        
        return True, "Комната создана", room_uuid
    
    async def check_room_password(self, room_name: str, password: str, db: Session) -> bool:
        room = db.query(Room).filter(Room.name == room_name).first()
        if not room:
            return False
        hashed = hashlib.md5(password.encode()).hexdigest()
        return room.password_hash == hashed
    
    async def get_all_rooms(self, db: Session) -> list:
        rooms = db.query(Room).all()
        return [{"name": r.name, "creator": r.creator} for r in rooms]
    
    async def get_room_by_id(self, room_uuid: str, db: Session):
        return db.query(Room).filter(Room.room_uuid == room_uuid).first()
    
    async def add_user_to_room(self, room_name: str, username: str, db: Session):
        existing = db.query(RoomUser).filter(
            RoomUser.room_name == room_name,
            RoomUser.username == username
        ).first()
        if not existing:
            new_user = RoomUser(room_name=room_name, username=username)
            db.add(new_user)
            db.commit()
        
        if room_name not in room_users:
            room_users[room_name] = set()
        room_users[room_name].add(username)
    
    async def remove_user_from_room(self, room_name: str, username: str, db: Session):
        user = db.query(RoomUser).filter(
            RoomUser.room_name == room_name,
            RoomUser.username == username
        ).first()
        if user:
            db.delete(user)
            db.commit()
        
        if room_name in room_users:
            room_users[room_name].discard(username)
    
    async def get_room_users(self, room_name: str, db: Session) -> list:
        users = db.query(RoomUser.username).filter(RoomUser.room_name == room_name).all()
        return [u.username for u in users]
    
    async def save_message(self, room_name: str, message_data: dict, db: Session):
        new_message = RoomMessage(
            room_name=room_name,
            message_data=json.dumps(message_data)
        )
        db.add(new_message)
        db.commit()
        
        if room_name not in room_messages:
            room_messages[room_name] = []
        room_messages[room_name].append(message_data)
        if len(room_messages[room_name]) > 100:
            room_messages[room_name] = room_messages[room_name][-100:]
        
        messages = db.query(RoomMessage).filter(RoomMessage.room_name == room_name).order_by(RoomMessage.created_at).all()
        if len(messages) > 100:
            for msg in messages[:-100]:
                db.delete(msg)
            db.commit()
    
    async def get_message_history(self, room_name: str, db: Session) -> list:
        if room_name in room_messages:
            return room_messages[room_name][-50:]
        
        messages = db.query(RoomMessage).filter(RoomMessage.room_name == room_name).order_by(RoomMessage.created_at).all()
        return [json.loads(msg.message_data) for msg in messages[-50:]]
    
    async def connect(self, websocket: WebSocket, room: str, username: str, user_id: str, db: Session):
        await websocket.accept()
        
        if room not in active_connections:
            active_connections[room] = set()
        
        active_connections[room].add(websocket)
        user_rooms[websocket] = {"room": room, "username": username, "user_id": user_id}
        
        await self.add_user_to_room(room, username, db)
        
        history = await self.get_message_history(room, db)
        for msg in history:
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
        
        await self.send_user_list(room, db)
        print(f"✅ {username} подключился к комнате {room}")
        return True
    
    async def disconnect(self, websocket: WebSocket, db: Session):
        if websocket in user_rooms:
            room = user_rooms[websocket]["room"]
            username = user_rooms[websocket]["username"]
            
            if room in active_connections:
                active_connections[room].discard(websocket)
            
            await self.remove_user_from_room(room, username, db)
            
            await self.broadcast_to_room(
                room,
                {
                    "type": "system",
                    "message": f"👋 {username} покинул чат",
                    "timestamp": datetime.now().strftime("%H:%M")
                }
            )
            await self.send_user_list(room, db)
            
            del user_rooms[websocket]
            print(f"❌ {username} отключился от комнаты {room}")
    
    async def send_user_list(self, room: str, db: Session):
        users = await self.get_room_users(room, db)
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

@app.get("/join/{room_uuid}")
async def join_page(room_uuid: str):
    with open("static/join.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())        

@app.get("/join/{room_uuid}")
async def join_page(room_uuid: str):
    with open("static/join.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

@app.get("/api/rooms")
async def get_rooms(db: Session = Depends(get_db)):
    try:
        rooms = await chat_room.get_all_rooms(db)
        return {"success": True, "rooms": rooms}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/api/create_room")
async def create_room(data: dict, db: Session = Depends(get_db)):
    try:
        room_name = data.get("name", "").strip().lower().replace(" ", "_")
        password = data.get("password", "")
        creator = data.get("creator", "")
        
        print(f"📝 Создание комнаты: {room_name}")
        
        if not room_name or not password:
            return {"success": False, "error": "Название и пароль обязательны"}
        
        success, message, room_uuid = await chat_room.create_room(room_name, password, creator, db)
        
        if success:
            print(f"✅ Комната {room_name} создана с ID: {room_uuid}")
            return {"success": True, "room": room_name, "room_id": room_uuid}
        else:
            return {"success": False, "error": message}
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return {"success": False, "error": str(e)}

@app.post("/api/join_room")
async def join_room(data: dict, db: Session = Depends(get_db)):
    try:
        room_name = data.get("room", "")
        password = data.get("password", "")
        
        correct = await chat_room.check_room_password(room_name, password, db)
        if correct:
            return {"success": True}
        else:
            return {"success": False, "error": "Неверный пароль"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/api/room_by_id/{room_uuid}")
async def get_room_by_id(room_uuid: str, db: Session = Depends(get_db)):
    room = await chat_room.get_room_by_id(room_uuid, db)
    if room:
        return {
            "success": True,
            "room_name": room.name,
            "creator": room.creator
        }
    return {"success": False, "error": "Комната не найдена"}

@app.get("/api/rooms/{room_name}/info")
async def get_room_info(room_name: str, db: Session = Depends(get_db)):
    room = db.query(Room).filter(Room.name == room_name).first()
    if not room:
        return {"success": False, "error": "Комната не найдена"}
    
    users = await chat_room.get_room_users(room_name, db)
    
    return {
        "success": True,
        "room": {
            "name": room.name,
            "id": room.room_uuid,
            "creator": room.creator,
            "created_at": room.created_at.isoformat(),
            "member_count": len(users)
        }
    }

@app.get("/api/rooms/{room_name}/members")
async def get_room_members(room_name: str, db: Session = Depends(get_db)):
    try:
        users = db.query(RoomUser.username).filter(RoomUser.room_name == room_name).all()
        return {"success": True, "members": [u.username for u in users]}
    except Exception as e:
        return {"success": True, "members": []}

@app.post("/api/rooms/rename")
async def rename_room(data: dict, db: Session = Depends(get_db)):
    try:
        old_name = data.get("old_name")
        new_name = data.get("new_name")
        username = data.get("username")
        
        print(f"📝 Переименование комнаты: {old_name} -> {new_name}")
        
        room = db.query(Room).filter(Room.name == old_name).first()
        if not room:
            return {"success": False, "error": "Комната не найдена"}
        
        if room.creator != username:
            return {"success": False, "error": "Только создатель может изменить название"}
        
        existing = db.query(Room).filter(Room.name == new_name).first()
        if existing:
            return {"success": False, "error": "Комната с таким названием уже существует"}
        
        room.name = new_name
        db.commit()
        
        if old_name in rooms_data:
            rooms_data[new_name] = rooms_data.pop(old_name)
        if old_name in rooms_list:
            rooms_list.remove(old_name)
            rooms_list.add(new_name)
        if old_name in room_messages:
            room_messages[new_name] = room_messages.pop(old_name)
        if old_name in room_users:
            room_users[new_name] = room_users.pop(old_name)
        
        if old_name in active_connections:
            active_connections[new_name] = active_connections.pop(old_name)
        
        await chat_room.broadcast_to_room(new_name, {
            "type": "system",
            "message": f"🏷️ Название комнаты изменено на: {new_name}",
            "timestamp": datetime.now().strftime("%H:%M")
        })
        
        return {"success": True}
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return {"success": False, "error": str(e)}

@app.post("/api/rooms/kick")
async def kick_user(data: dict, db: Session = Depends(get_db)):
    try:
        room_name = data.get("room_name")
        username_to_kick = data.get("username")
        admin = data.get("admin")
        
        room = db.query(Room).filter(Room.name == room_name).first()
        if not room:
            return {"success": False, "error": "Комната не найдена"}
        
        if room.creator != admin:
            return {"success": False, "error": "Только создатель может выгонять участников"}
        
        user = db.query(RoomUser).filter(
            RoomUser.room_name == room_name,
            RoomUser.username == username_to_kick
        ).first()
        
        if user:
            db.delete(user)
            db.commit()
        
        if room_name in room_users:
            room_users[room_name].discard(username_to_kick)
        
        if room_name in active_connections:
            for connection in active_connections[room_name]:
                for ws_user in list(user_rooms.keys()):
                    if user_rooms[ws_user].get("username") == username_to_kick and user_rooms[ws_user].get("room") == room_name:
                        try:
                            await connection.send_json({
                                "type": "kicked",
                                "message": f"Вы были выгнаны из комнаты {room_name}"
                            })
                        except:
                            pass
                        break
        
        return {"success": True}
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return {"success": False, "error": str(e)}

@app.delete("/api/rooms/delete/{room_name}")
async def delete_room(room_name: str, username: str, db: Session = Depends(get_db)):
    try:
        room = db.query(Room).filter(Room.name == room_name).first()
        if not room:
            return {"success": False, "error": "Комната не найдена"}
        
        if room.creator != username:
            return {"success": False, "error": "Только создатель может удалить комнату"}
        
        db.delete(room)
        db.query(RoomMessage).filter(RoomMessage.room_name == room_name).delete()
        db.query(RoomUser).filter(RoomUser.room_name == room_name).delete()
        db.commit()
        
        if room_name in rooms_data:
            del rooms_data[room_name]
        if room_name in rooms_list:
            rooms_list.remove(room_name)
        if room_name in room_messages:
            del room_messages[room_name]
        if room_name in room_users:
            del room_users[room_name]
        
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
        
        return {"success": True}
    except Exception as e:
        print(f"❌ Ошибка: {e}")
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

# ========== АУТЕНТИФИКАЦИЯ ==========

@app.post("/api/register")
async def register(request: Request, db: Session = Depends(get_db)):
    try:
        data = await request.json()
        username = data.get("username")
        email = data.get("email")
        password = data.get("password")
        
        print(f"📝 Регистрация: {username}, {email}")
        
        existing_user = db.query(User).filter(
            (User.username == username) | (User.email == email)
        ).first()
        
        if existing_user:
            if existing_user.username == username:
                return {"success": False, "error": "Имя пользователя уже занято"}
            return {"success": False, "error": "Email уже зарегистрирован"}
        
        new_user = User(username=username, email=email)
        new_user.set_password(password)
        new_user.email_verified = True
        
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        
        session_token = secrets.token_urlsafe(32)
        
        return {
            "success": True, 
            "token": session_token, 
            "username": new_user.username, 
            "user_id": new_user.id
        }
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return {"success": False, "error": str(e)}

@app.post("/api/login")
async def login(request: Request, db: Session = Depends(get_db)):
    try:
        data = await request.json()
        username = data.get("username")
        password = data.get("password")
        
        user = db.query(User).filter(User.username == username).first()
        
        if not user:
            user = db.query(User).filter(User.email == username).first()
        
        if not user:
            return {"success": False, "error": "Неверное имя пользователя или пароль"}
        
        if not user.verify_password(password):
            return {"success": False, "error": "Неверное имя пользователя или пароль"}
        
        session_token = secrets.token_urlsafe(32)
        
        return {"success": True, "token": session_token, "username": user.username, "user_id": user.id}
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return {"success": False, "error": str(e)}

# ========== ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ ==========

@app.get("/api/user/profile")
async def get_user_profile(username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        return {"success": False, "error": "Пользователь не найден"}
    
    return {
        "success": True,
        "username": user.username,
        "email": user.email,
        "display_name": user.display_name if user.display_name else user.username,
        "birth_date": user.birth_date if user.birth_date else None,
        "avatar_url": user.avatar_url if user.avatar_url else "/static/default-avatar.png",
        "created_at": user.created_at.isoformat()
    }

@app.post("/api/user/update_profile")
async def update_user_profile(request: Request, db: Session = Depends(get_db)):
    try:
        data = await request.json()
        username = data.get("username")
        display_name = data.get("display_name")
        birth_date = data.get("birth_date")
        
        user = db.query(User).filter(User.username == username).first()
        if not user:
            return {"success": False, "error": "Пользователь не найден"}
        
        if display_name:
            user.display_name = display_name
        if birth_date:
            user.birth_date = birth_date
        
        db.commit()
        return {"success": True}
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return {"success": False, "error": str(e)}

@app.post("/api/user/upload_avatar")
async def upload_avatar(
    username: str = Form(...),
    avatar: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            return {"success": False, "error": "Пользователь не найден"}
        
        file_ext = avatar.filename.split(".")[-1]
        file_name = f"{user.id}_{int(datetime.now().timestamp())}.{file_ext}"
        file_path = AVATAR_DIR / file_name
        
        content = await avatar.read()
        with open(file_path, "wb") as f:
            f.write(content)
        
        avatar_url = f"/uploads/avatars/{file_name}"
        user.avatar_url = avatar_url
        db.commit()
        
        return {"success": True, "avatar_url": avatar_url}
    except Exception as e:
        print(f"❌ Ошибка загрузки аватара: {e}")
        return {"success": False, "error": str(e)}

# ========== ЛИЧНЫЕ ЧАТЫ ==========

@app.post("/api/private_chat/create")
async def create_private_chat(request: Request, db: Session = Depends(get_db)):
    try:
        data = await request.json()
        user1 = data.get("user1")
        user2 = data.get("user2")
        
        existing = db.query(PrivateChat).filter(
            ((PrivateChat.user1 == user1) & (PrivateChat.user2 == user2)) |
            ((PrivateChat.user1 == user2) & (PrivateChat.user2 == user1))
        ).first()
        
        if existing:
            return {"success": True, "chat_id": existing.id}
        
        chat = PrivateChat(user1=user1, user2=user2)
        db.add(chat)
        db.commit()
        db.refresh(chat)
        return {"success": True, "chat_id": chat.id}
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return {"success": False, "error": str(e)}

@app.get("/api/private_chats")
async def get_private_chats(username: str, db: Session = Depends(get_db)):
    try:
        chats = db.query(PrivateChat).filter(
            (PrivateChat.user1 == username) | (PrivateChat.user2 == username)
        ).all()
        
        result = []
        for chat in chats:
            result.append({
                "id": chat.id,
                "user1": chat.user1,
                "user2": chat.user2,
                "last_message": chat.last_message or "",
                "updated_at": chat.updated_at.isoformat() if chat.updated_at else None
            })
        
        return {"success": True, "chats": result}
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return {"success": True, "chats": []}

@app.websocket("/ws/{room}/{username}/{user_id}")
async def websocket_endpoint(websocket: WebSocket, room: str, username: str, user_id: str, db: Session = Depends(get_db)):
    await chat_room.connect(websocket, room, username, user_id, db)
    
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
                
                await chat_room.save_message(room, chat_message, db)
                await chat_room.broadcast_to_room(room, chat_message)
                print(f"💬 {username}: {message_data['message'][:50]}")
            
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
                
                await chat_room.save_message(room, image_message, db)
                await chat_room.broadcast_to_room(room, image_message)
                print(f"🖼️ {username} отправил изображение")
                
    except WebSocketDisconnect:
        await chat_room.disconnect(websocket, db)

@app.get("/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)