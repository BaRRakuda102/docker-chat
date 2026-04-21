from fastapi import (
    FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Request, 
    Depends, Form, HTTPException, status, Header
)
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
import json
from typing import Dict, Set, Optional
from datetime import datetime, timedelta
import secrets
import os
import uuid
import mimetypes
from database import get_db, User, Room, RoomMessage, RoomUser, PrivateChat, PrivateMessage
from sqlalchemy.orm import Session
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(password: str, hashed: str) -> bool:
    return pwd_context.verify(password, hashed)

# ========== КОНФИГУРАЦИЯ ==========
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8000").split(",")
MAX_FILE_SIZE = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf", ".txt", ".mp4", ".webm"}
ALLOWED_AVATAR_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MAX_ROOM_NAME_LENGTH = 50
MAX_USERNAME_LENGTH = 30

def normalize_room_name(name: str) -> str:
    if not name:
        return ""
    cleaned = "".join(c for c in name.strip().lower() if c.isalnum() or c in " _-")
    return cleaned.replace(" ", "_")[:MAX_ROOM_NAME_LENGTH]

def validate_username(username: str) -> str:
    if not username or len(username) > MAX_USERNAME_LENGTH:
        raise ValueError("Username должен быть от 1 до 30 символов")
    if not all(c.isalnum() or c in "_-" for c in username):
        raise ValueError("Username может содержать только буквы, цифры, подчеркивание и дефис")
    return username.strip().lower()

# Безопасный ID сообщения (SHA-256 достаточно, bcrypt — перебор)
def generate_message_id(unique_string: str) -> str:
    import hashlib
    salt = secrets.token_hex(16)
    combined = f"{unique_string}{salt}{secrets.token_urlsafe(16)}".encode()
    return hashlib.sha256(combined).hexdigest()[:16]

# ========== Pydantic модели ==========
class RoomCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=MAX_ROOM_NAME_LENGTH)
    password: str = Field(..., min_length=4, max_length=128)
    
    @validator("name")
    def validate_name(cls, v):
        return normalize_room_name(v)

class RoomJoin(BaseModel):
    room: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    
    @validator("room")
    def validate_room(cls, v):
        return normalize_room_name(v)

class RoomRename(BaseModel):
    old_name: str = Field(..., min_length=1)
    new_name: str = Field(..., min_length=1, max_length=MAX_ROOM_NAME_LENGTH)
    
    @validator("old_name", "new_name")
    def validate_name(cls, v):
        return normalize_room_name(v)

class KickUser(BaseModel):
    room_name: str = Field(..., min_length=1)
    username: str = Field(..., min_length=1)
    
    @validator("room_name")
    def validate_room(cls, v):
        return normalize_room_name(v)

class PrivateChatCreate(BaseModel):
    user1: str = Field(..., min_length=1)
    user2: str = Field(..., min_length=1)
    
    @validator("user1", "user2")
    def validate_user(cls, v):
        return validate_username(v)

class UpdateProfile(BaseModel):
    display_name: Optional[str] = Field(None, max_length=100)
    birth_date: Optional[str] = None

# ========== ДИРЕКТОРИИ ==========
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
AVATAR_DIR = Path("uploads/avatars")
AVATAR_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="Chat App",
    version="1.0.0",
    docs_url=None,
    redoc_url=None
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/static", StaticFiles(directory="static"), name="static")

# ========== ХРАНИЛИЩЕ В ПАМЯТИ ==========
active_connections: Dict[str, Set[WebSocket]] = {}
user_rooms: Dict[WebSocket, Dict] = {}

rooms_data = {}
rooms_list = set()
room_messages = {}
room_users = {}

# ========== БЕЗОПАСНАЯ ОБРАБОТКА ФАЙЛОВ ==========
def validate_file_extension(filename: str, allowed_extensions: set) -> bool:
    ext = Path(filename).suffix.lower()
    return ext in allowed_extensions

def validate_file_size(content: bytes, max_size: int = MAX_FILE_SIZE) -> bool:
    return len(content) <= max_size

def sanitize_filename(filename: str) -> str:
    safe_name = Path(filename).name
    safe_name = safe_name.replace("\x00", "").replace("..", "")
    ext = Path(safe_name).suffix.lower()
    if not ext or ext not in ALLOWED_EXTENSIONS:
        ext = ".bin"
    return f"{uuid.uuid4().hex}{ext}"

def get_safe_file_path(filename: str, directory: Path) -> Path:
    try:
        target = (directory / filename).resolve()
        base = directory.resolve()
        target.relative_to(base)
        return target
    except (ValueError, RuntimeError):
        raise HTTPException(status_code=400, detail="Invalid file path")

# ========== ПРОВЕРКА ТОКЕНА С ИСТЕЧЕНИЕМ СРОКА ==========
async def get_current_user(
    authorization: str = Header(None),
    db: Session = Depends(get_db)
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    
    token = authorization.replace("Bearer ", "")
    user = db.query(User).filter(User.session_token == token).first()
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    # Проверяем срок действия сессии
    if not user.is_session_valid():
        user.session_token = None
        user.session_expires = None
        db.commit()
        raise HTTPException(status_code=401, detail="Session expired. Please login again.")
    
    # Обновляем last_seen
    user.last_seen = datetime.utcnow()
    db.commit()
    
    return user

# ========== КЛАСС КОМНАТЫ ==========
class ChatRoom:
    async def create_room(self, room_name: str, password: str, creator_id: int, db: Session):
        normalized_name = normalize_room_name(room_name)
        
        if normalized_name in rooms_list:
            return False, "Комната с таким названием уже существует", None
        
        room_uuid = str(uuid.uuid4())[:8]
        password_hash = hash_password(password)
        
        new_room = Room(
            name=normalized_name,
            room_uuid=room_uuid,
            password_hash=password_hash,
            creator_id=creator_id
        )
        db.add(new_room)
        db.commit()
        db.refresh(new_room)
        
        rooms_data[normalized_name] = {
            "id": room_uuid,
            "password": password_hash,
            "creator_id": creator_id,
            "created_at": datetime.now().isoformat()
        }
        rooms_list.add(normalized_name)
        room_messages[normalized_name] = []
        room_users[normalized_name] = set()
        
        return True, "Комната создана", room_uuid
    
    async def check_room_password(self, room_name: str, password: str, db: Session) -> bool:
        room = db.query(Room).filter(Room.name == room_name).first()
        if not room:
            return False
        return verify_password(password, room.password_hash)
    
    async def get_all_rooms(self, db: Session) -> list:
        rooms = db.query(Room).all()
        return [{"name": r.name, "creator": r.creator.username if r.creator else "Unknown"} for r in rooms]
    
    async def get_room_by_id(self, room_uuid: str, db: Session):
        return db.query(Room).filter(Room.room_uuid == room_uuid).first()
    
    async def add_user_to_room(self, room_name: str, user_id: int, username: str, db: Session):
        room = db.query(Room).filter(Room.name == room_name).first()
        if not room:
            return
        
        existing = db.query(RoomUser).filter(
            RoomUser.room_id == room.id,
            RoomUser.user_id == user_id
        ).first()
        if not existing:
            new_user = RoomUser(room_id=room.id, user_id=user_id)
            db.add(new_user)
            db.commit()
        
        if room_name not in room_users:
            room_users[room_name] = set()
        room_users[room_name].add(username)
    
    async def remove_user_from_room(self, room_name: str, user_id: int, username: str, db: Session):
        room = db.query(Room).filter(Room.name == room_name).first()
        if not room:
            return
        
        user = db.query(RoomUser).filter(
            RoomUser.room_id == room.id,
            RoomUser.user_id == user_id
        ).first()
        if user:
            db.delete(user)
            db.commit()
        
        if room_name in room_users:
            room_users[room_name].discard(username)
    
    async def get_room_users(self, room_name: str, db: Session) -> list:
        room = db.query(Room).filter(Room.name == room_name).first()
        if not room:
            return []
        users = db.query(RoomUser).filter(RoomUser.room_id == room.id).all()
        return [u.user.username for u in users if u.user]
    
    async def save_message(self, room_name: str, message_data: dict, db: Session):
        room = db.query(Room).filter(Room.name == room_name).first()
        if not room:
            return
        
        new_message = RoomMessage(
            room_id=room.id,
            user_id=message_data.get("user_id"),
            message_data=json.dumps(message_data)
        )
        db.add(new_message)
        db.commit()
        
        if room_name not in room_messages:
            room_messages[room_name] = []
        room_messages[room_name].append(message_data)
        if len(room_messages[room_name]) > 100:
            room_messages[room_name] = room_messages[room_name][-100:]
        
        messages = db.query(RoomMessage).filter(
            RoomMessage.room_id == room.id
        ).order_by(RoomMessage.created_at).all()
        if len(messages) > 100:
            for msg in messages[:-100]:
                db.delete(msg)
            db.commit()
    
    async def get_message_history(self, room_name: str, db: Session) -> list:
        if room_name in room_messages:
            return room_messages[room_name][-50:]
        
        room = db.query(Room).filter(Room.name == room_name).first()
        if not room:
            return []
        messages = db.query(RoomMessage).filter(
            RoomMessage.room_id == room.id
        ).order_by(RoomMessage.created_at).all()
        return [json.loads(msg.message_data) for msg in messages[-50:]]
    
    async def connect(self, websocket: WebSocket, room: str, username: str, user_id: str, db: Session):
        await websocket.accept()
        
        if room not in active_connections:
            active_connections[room] = set()
        
        active_connections[room].add(websocket)
        user_rooms[websocket] = {"room": room, "username": username, "user_id": user_id}
        
        await self.add_user_to_room(room, int(user_id), username, db)
        
        history = await self.get_message_history(room, db)
        for msg in history:
            try:
                await websocket.send_json(msg)
            except Exception:
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
            user_id = user_rooms[websocket]["user_id"]
            
            if room in active_connections:
                active_connections[room].discard(websocket)
            
            await self.remove_user_from_room(room, int(user_id), username, db)
            
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
        if room not in active_connections:
            return
        
        to_remove = []
        for connection in active_connections[room]:
            try:
                await connection.send_json(message)
            except Exception:
                to_remove.append(connection)
        
        for conn in to_remove:
            active_connections[room].discard(conn)
            if conn in user_rooms:
                del user_rooms[conn]

chat_room = ChatRoom()

# ========== ЭНДПОИНТЫ ==========

@app.get("/", response_class=HTMLResponse)
async def get():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return f.read()

@app.get("/join/{room_uuid}")
async def join_page(room_uuid: str):
    if not room_uuid or len(room_uuid) > 20 or not all(c in "0123456789abcdef-" for c in room_uuid.lower()):
        raise HTTPException(status_code=400, detail="Invalid room UUID")
    
    try:
        with open("static/join.html", "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Page not found")

@app.get("/api/rooms")
async def get_rooms(db: Session = Depends(get_db)):
    try:
        rooms = await chat_room.get_all_rooms(db)
        return {"success": True, "rooms": rooms}
    except Exception as e:
        print(f"❌ Ошибка получения комнат: {e}")
        return {"success": False, "error": "Internal server error"}

@app.post("/api/create_room")
async def create_room(
    data: RoomCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        print(f"📝 Создание комнаты: {data.name}")
        
        success, message, room_uuid = await chat_room.create_room(
            data.name, data.password, current_user.id, db
        )
        
        if success:
            print(f"✅ Комната {data.name} создана с ID: {room_uuid}")
            return {"success": True, "room": data.name, "room_id": room_uuid}
        else:
            return {"success": False, "error": message}
    except Exception as e:
        print(f"❌ Ошибка создания комнаты: {e}")
        return {"success": False, "error": "Internal server error"}

@app.post("/api/join_room")
async def join_room(data: RoomJoin, db: Session = Depends(get_db)):
    try:
        correct = await chat_room.check_room_password(data.room, data.password, db)
        if correct:
            return {"success": True}
        else:
            return {"success": False, "error": "Неверный пароль"}
    except Exception as e:
        print(f"❌ Ошибка входа в комнату: {e}")
        return {"success": False, "error": "Internal server error"}

@app.get("/api/room_by_id/{room_uuid}")
async def get_room_by_id(room_uuid: str, db: Session = Depends(get_db)):
    if not room_uuid or len(room_uuid) > 20:
        raise HTTPException(status_code=400, detail="Invalid room UUID")
    
    room = await chat_room.get_room_by_id(room_uuid, db)
    if room:
        return {
            "success": True,
            "room_name": room.name,
            "creator": room.creator.username if room.creator else "Unknown"
        }
    return {"success": False, "error": "Комната не найдена"}

@app.get("/api/rooms/{room_name}/info")
async def get_room_info(room_name: str, db: Session = Depends(get_db)):
    normalized = normalize_room_name(room_name)
    room = db.query(Room).filter(Room.name == normalized).first()
    if not room:
        return {"success": False, "error": "Комната не найдена"}
    
    users = await chat_room.get_room_users(normalized, db)
    
    return {
        "success": True,
        "room": {
            "name": room.name,
            "id": room.room_uuid,
            "creator": room.creator.username if room.creator else "Unknown",
            "created_at": room.created_at.isoformat() if room.created_at else None,
            "member_count": len(users)
        }
    }

@app.get("/api/rooms/{room_name}/members")
async def get_room_members(room_name: str, db: Session = Depends(get_db)):
    try:
        normalized = normalize_room_name(room_name)
        room = db.query(Room).filter(Room.name == normalized).first()
        if not room:
            return {"success": True, "members": []}
        users = db.query(RoomUser).filter(RoomUser.room_id == room.id).all()
        return {"success": True, "members": [u.user.username for u in users if u.user]}
    except Exception as e:
        print(f"❌ Ошибка получения участников: {e}")
        return {"success": True, "members": []}

@app.post("/api/rooms/rename")
async def rename_room(
    data: RoomRename,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        print(f"📝 Переименование комнаты: {data.old_name} -> {data.new_name}")
        
        room = db.query(Room).filter(Room.name == data.old_name).first()
        if not room:
            return {"success": False, "error": "Комната не найдена"}
        
        if room.creator_id != current_user.id:
            return {"success": False, "error": "Только создатель может изменить название"}
        
        existing = db.query(Room).filter(Room.name == data.new_name).first()
        if existing:
            return {"success": False, "error": "Комната с таким названием уже существует"}
        
        room.name = data.new_name
        db.commit()
        
        if data.old_name in rooms_data:
            rooms_data[data.new_name] = rooms_data.pop(data.old_name)
        if data.old_name in rooms_list:
            rooms_list.remove(data.old_name)
            rooms_list.add(data.new_name)
        if data.old_name in room_messages:
            room_messages[data.new_name] = room_messages.pop(data.old_name)
        if data.old_name in room_users:
            room_users[data.new_name] = room_users.pop(data.old_name)
        
        if data.old_name in active_connections:
            active_connections[data.new_name] = active_connections.pop(data.old_name)
        
        await chat_room.broadcast_to_room(data.new_name, {
            "type": "system",
            "message": f"🏷️ Название комнаты изменено на: {data.new_name}",
            "timestamp": datetime.now().strftime("%H:%M")
        })
        
        return {"success": True}
    except Exception as e:
        print(f"❌ Ошибка переименования: {e}")
        return {"success": False, "error": "Internal server error"}

@app.post("/api/rooms/kick")
async def kick_user(
    data: KickUser,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        room = db.query(Room).filter(Room.name == data.room_name).first()
        if not room:
            return {"success": False, "error": "Комната не найдена"}
        
        if room.creator_id != current_user.id:
            return {"success": False, "error": "Только создатель может выгонять участников"}
        
        user_to_kick = db.query(User).filter(User.username == data.username).first()
        if not user_to_kick:
            return {"success": False, "error": "Пользователь не найден"}
        
        room_user = db.query(RoomUser).filter(
            RoomUser.room_id == room.id,
            RoomUser.user_id == user_to_kick.id
        ).first()
        
        if room_user:
            db.delete(room_user)
            db.commit()
        
        if data.room_name in room_users:
            room_users[data.room_name].discard(data.username)
        
        if data.room_name in active_connections:
            target_ws = None
            for ws, info in list(user_rooms.items()):
                if info.get("username") == data.username and info.get("room") == data.room_name:
                    target_ws = ws
                    break
            
            if target_ws:
                try:
                    await target_ws.send_json({
                        "type": "kicked",
                        "message": f"Вы были выгнаны из комнаты {data.room_name}"
                    })
                    await target_ws.close()
                except Exception:
                    pass
                
                active_connections[data.room_name].discard(target_ws)
                if target_ws in user_rooms:
                    del user_rooms[target_ws]
        
        return {"success": True}
    except Exception as e:
        print(f"❌ Ошибка кика: {e}")
        return {"success": False, "error": "Internal server error"}

@app.delete("/api/rooms/delete/{room_name}")
async def delete_room(
    room_name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        normalized = normalize_room_name(room_name)
        
        room = db.query(Room).filter(Room.name == normalized).first()
        if not room:
            return {"success": False, "error": "Комната не найдена"}
        
        if room.creator_id != current_user.id:
            return {"success": False, "error": "Только создатель может удалить комнату"}
        
        # Каскадное удаление через SQLAlchemy (связи настроены)
        db.delete(room)
        db.commit()
        
        for cache in [rooms_data, rooms_list, room_messages, room_users]:
            if normalized in cache:
                if isinstance(cache, set):
                    cache.discard(normalized)
                else:
                    del cache[normalized]
        
        notification = {
            "type": "room_list_update",
            "action": "delete",
            "room_name": normalized
        }
        
        for room_conns in list(active_connections.values()):
            for connection in list(room_conns):
                try:
                    await connection.send_json(notification)
                except Exception:
                    pass
        
        if normalized in active_connections:
            for connection in list(active_connections[normalized]):
                try:
                    await connection.send_json({
                        "type": "room_deleted",
                        "message": f"Комната {normalized} удалена создателем"
                    })
                    await connection.close()
                except Exception:
                    pass
            
            for ws in list(user_rooms.keys()):
                if user_rooms[ws].get("room") == normalized:
                    del user_rooms[ws]
            
            del active_connections[normalized]
        
        return {"success": True}
    except Exception as e:
        print(f"❌ Ошибка удаления комнаты: {e}")
        return {"success": False, "error": "Internal server error"}

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    try:
        content = await file.read()
        if not validate_file_size(content):
            raise HTTPException(
                status_code=413, 
                detail=f"Файл слишком большой. Максимальный размер: {MAX_FILE_SIZE // (1024*1024)}MB"
            )
        
        if not validate_file_extension(file.filename, ALLOWED_EXTENSIONS):
            raise HTTPException(
                status_code=400,
                detail=f"Недопустимое расширение файла. Разрешены: {', '.join(ALLOWED_EXTENSIONS)}"
            )
        
        mime_type, _ = mimetypes.guess_type(file.filename)
        if mime_type and not mime_type.startswith(("image/", "video/", "text/", "application/pdf")):
            raise HTTPException(status_code=400, detail="Недопустимый тип файла")
        
        safe_name = sanitize_filename(file.filename)
        file_path = get_safe_file_path(safe_name, UPLOAD_DIR)
        
        with open(file_path, "wb") as f:
            f.write(content)
        
        print(f"✅ Файл сохранён: {file_path}")
        
        return {
            "url": f"/uploads/{safe_name}", 
            "filename": file.filename, 
            "size": len(content)
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Ошибка загрузки файла: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ========== АУТЕНТИФИКАЦИЯ ==========

@app.post("/api/register")
async def register(request: Request, db: Session = Depends(get_db)):
    try:
        data = await request.json()
        
        username = data.get("username", "").strip()
        email = data.get("email", "").strip().lower()
        password = data.get("password", "")
        
        if len(username) < 3 or len(username) > MAX_USERNAME_LENGTH:
            return {"success": False, "error": f"Username должен быть от 3 до {MAX_USERNAME_LENGTH} символов"}
        
        if len(password) < 6:
            return {"success": False, "error": "Пароль должен быть не менее 6 символов"}
        
        try:
            validate_username(username)
        except ValueError as e:
            return {"success": False, "error": str(e)}
        
        print(f"📝 Регистрация: {username}, {email}")
        
        existing_by_username = db.query(User).filter(User.username == username).first()
        if existing_by_username:
            return {"success": False, "error": "Имя пользователя уже занято"}
        
        existing_by_email = db.query(User).filter(User.email == email).first()
        if existing_by_email:
            return {"success": False, "error": "Email уже зарегистрирован"}
        
        new_user = User(username=username, email=email)
        new_user.set_password(password)
        new_user.email_verified = True
        
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        
        # Создаём сессию с истечением срока
        session_token = new_user.refresh_session()
        db.commit()
        
        return {
            "success": True, 
            "token": session_token, 
            "username": new_user.username, 
            "user_id": new_user.id
        }
    except Exception as e:
        print(f"❌ Ошибка регистрации: {e}")
        return {"success": False, "error": "Internal server error"}

@app.post("/api/login")
async def login(request: Request, db: Session = Depends(get_db)):
    try:
        data = await request.json()
        username_or_email = data.get("username", "").strip()
        password = data.get("password", "")
        
        if not username_or_email or not password:
            return {"success": False, "error": "Введите имя пользователя и пароль"}
        
        user = db.query(User).filter(User.username == username_or_email).first()
        if not user:
            user = db.query(User).filter(User.email == username_or_email.lower()).first()
        
        if not user:
            return {"success": False, "error": "Неверное имя пользователя или пароль"}
        
        if not user.verify_password(password):
            return {"success": False, "error": "Неверное имя пользователя или пароль"}
        
        # Обновляем сессию
        session_token = user.refresh_session()
        db.commit()
        
        return {
            "success": True, 
            "token": session_token, 
            "username": user.username, 
            "user_id": user.id
        }
    except Exception as e:
        print(f"❌ Ошибка входа: {e}")
        return {"success": False, "error": "Internal server error"}

# ========== ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ ==========

@app.get("/api/user/profile")
async def get_user_profile(username: str, db: Session = Depends(get_db)):
    try:
        safe_username = validate_username(username)
        user = db.query(User).filter(User.username == safe_username).first()
        if not user:
            return {"success": False, "error": "Пользователь не найден"}
        
        avatar_url = user.avatar_url if user.avatar_url else None
        
        if avatar_url:
            try:
                avatar_path = get_safe_file_path(
                    avatar_url.replace("/uploads/avatars/", ""), 
                    AVATAR_DIR
                )
                if not avatar_path.exists():
                    avatar_url = "/static/default-avatar.png"
            except Exception:
                avatar_url = "/static/default-avatar.png"
        else:
            avatar_url = "/static/default-avatar.png"
        
        return {
            "success": True,
            "username": user.username,
            "email": user.email,
            "display_name": user.display_name if user.display_name else user.username,
            "birth_date": user.birth_date.isoformat() if user.birth_date else None,
            "avatar_url": avatar_url,
            "created_at": user.created_at.isoformat() if user.created_at else None
        }
    except ValueError as ve:
        return {"success": False, "error": str(ve)}
    except Exception as e:
        print(f"❌ Ошибка получения профиля: {e}")
        return {"success": False, "error": "Internal server error"}

@app.post("/api/user/update_profile")
async def update_user_profile(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        data = await request.json()
        
        display_name = data.get("display_name", "").strip()
        birth_date = data.get("birth_date")
        
        if display_name:
            if len(display_name) > 100:
                return {"success": False, "error": "Отображаемое имя слишком длинное"}
            current_user.display_name = display_name
        
        if birth_date:
            try:
                datetime.strptime(birth_date, "%Y-%m-%d")
                from sqlalchemy import Date as SQLDate
                current_user.birth_date = birth_date
            except ValueError:
                return {"success": False, "error": "Неверный формат даты. Используйте YYYY-MM-DD"}
        
        db.commit()
        return {"success": True}
    except Exception as e:
        print(f"❌ Ошибка обновления профиля: {e}")
        return {"success": False, "error": "Internal server error"}

@app.post("/api/user/upload_avatar")
async def upload_avatar(
    avatar: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        content = await avatar.read()
        if not validate_file_size(content, 5 * 1024 * 1024):
            raise HTTPException(status_code=413, detail="Аватар слишком большой. Максимум 5MB")
        
        if not validate_file_extension(avatar.filename, ALLOWED_AVATAR_EXTENSIONS):
            raise HTTPException(
                status_code=400,
                detail=f"Разрешены только изображения: {', '.join(ALLOWED_AVATAR_EXTENSIONS)}"
            )
        
        mime_type, _ = mimetypes.guess_type(avatar.filename)
        if not mime_type or not mime_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="Файл должен быть изображением")
        
        if current_user.avatar_url and current_user.avatar_url != "/static/default-avatar.png":
            try:
                old_path = get_safe_file_path(
                    current_user.avatar_url.replace("/uploads/avatars/", ""),
                    AVATAR_DIR
                )
                if old_path.exists():
                    old_path.unlink()
            except Exception:
                pass
        
        safe_name = sanitize_filename(avatar.filename)
        file_path = get_safe_file_path(safe_name, AVATAR_DIR)
        
        with open(file_path, "wb") as f:
            f.write(content)
        
        avatar_url = f"/uploads/avatars/{safe_name}"
        current_user.avatar_url = avatar_url
        db.commit()
        
        return {"success": True, "avatar_url": avatar_url}
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Ошибка загрузки аватара: {e}")
        return {"success": False, "error": "Internal server error"}

# ========== ЛИЧНЫЕ ЧАТЫ ==========

@app.post("/api/private_chat/create")
async def create_private_chat(data: PrivateChatCreate, db: Session = Depends(get_db)):
    try:
        user1 = db.query(User).filter(User.username == data.user1).first()
        user2 = db.query(User).filter(User.username == data.user2).first()
        
        if not user1 or not user2:
            return {"success": False, "error": "Пользователь не найден"}
        
        # Сортируем ID для уникальности (всегда меньший ID первый)
        u1_id, u2_id = sorted([user1.id, user2.id])
        
        existing = db.query(PrivateChat).filter(
            PrivateChat.user1_id == u1_id,
            PrivateChat.user2_id == u2_id
        ).first()
        
        if existing:
            return {"success": True, "chat_id": existing.id}
        
        chat = PrivateChat(user1_id=u1_id, user2_id=u2_id)
        db.add(chat)
        db.commit()
        db.refresh(chat)
        return {"success": True, "chat_id": chat.id}
    except Exception as e:
        print(f"❌ Ошибка создания чата: {e}")
        return {"success": False, "error": "Internal server error"}

@app.get("/api/private_chats")
async def get_private_chats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        chats = db.query(PrivateChat).filter(
            (PrivateChat.user1_id == current_user.id) | (PrivateChat.user2_id == current_user.id)
        ).all()
        
        result = []
        for chat in chats:
            other_user = chat.user2 if chat.user1_id == current_user.id else chat.user1
            result.append({
                "id": chat.id,
                "other_user": other_user.username if other_user else "Unknown",
                "last_message": chat.last_message or "",
                "updated_at": chat.updated_at.isoformat() if chat.updated_at else None
            })
        
        return {"success": True, "chats": result}
    except Exception as e:
        print(f"❌ Ошибка получения чатов: {e}")
        return {"success": True, "chats": []}

# ========== WEBSOCKET ==========

@app.websocket("/ws/{room}/{username}/{user_id}")
async def websocket_endpoint(
    websocket: WebSocket, 
    room: str, 
    username: str, 
    user_id: str, 
    db: Session = Depends(get_db)
):
    try:
        safe_room = normalize_room_name(room)
        safe_username = validate_username(username)
        if not user_id or len(user_id) > 50:
            await websocket.close(code=4001, reason="Invalid user_id")
            return
    except ValueError as e:
        await websocket.close(code=4001, reason=str(e))
        return
    
    # Проверяем существование пользователя
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        await websocket.close(code=4003, reason="User not found")
        return
    
    # Проверяем сессию
    if not user.is_session_valid():
        await websocket.close(code=4003, reason="Session expired")
        return
    
    room_obj = db.query(Room).filter(Room.name == safe_room).first()
    if not room_obj:
        await websocket.close(code=4004, reason="Room not found")
        return
    
    await chat_room.connect(websocket, safe_room, safe_username, user_id, db)
    
    try:
        while True:
            try:
                data = await websocket.receive_text()
            except WebSocketDisconnect:
                break
            
            try:
                message_data = json.loads(data)
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid JSON format"
                })
                continue
            
            msg_type = message_data.get("type")
            if msg_type not in {"message", "image"}:
                await websocket.send_json({
                    "type": "error",
                    "message": "Unknown message type"
                })
                continue
            
            if msg_type == "message":
                msg_text = message_data.get("message", "").strip()
                if not msg_text or len(msg_text) > 2000:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Message too long or empty"
                    })
                    continue
                
                chat_message = {
                    "id": generate_message_id(f"{datetime.now().isoformat()}{safe_username}{msg_text}"),
                    "type": "message",
                    "username": safe_username,
                    "message": msg_text,
                    "timestamp": datetime.now().strftime("%H:%M"),
                    "user_id": user_id
                }
                
                reply_to = message_data.get("reply_to")
                if reply_to and isinstance(reply_to, str) and len(reply_to) < 100:
                    chat_message["reply_to"] = reply_to
                
                await chat_room.save_message(safe_room, chat_message, db)
                await chat_room.broadcast_to_room(safe_room, chat_message)
                print(f"💬 {safe_username}: {msg_text[:50]}")
            
            elif msg_type == "image":
                url = message_data.get("url", "").strip()
                if not url or len(url) > 500:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Invalid image URL"
                    })
                    continue
                
                if not url.startswith("/uploads/"):
                    await websocket.send_json({
                        "type": "error",
                        "message": "Invalid image path"
                    })
                    continue
                
                image_message = {
                    "id": generate_message_id(f"{datetime.now().isoformat()}{safe_username}{url}"),
                    "type": "image",
                    "username": safe_username,
                    "url": url,
                    "caption": message_data.get("caption", "")[:200],
                    "timestamp": datetime.now().strftime("%H:%M"),
                    "user_id": user_id
                }
                
                reply_to = message_data.get("reply_to")
                if reply_to and isinstance(reply_to, str) and len(reply_to) < 100:
                    image_message["reply_to"] = reply_to
                
                await chat_room.save_message(safe_room, image_message, db)
                await chat_room.broadcast_to_room(safe_room, image_message)
                print(f"🖼️ {safe_username} отправил изображение")
                
    except WebSocketDisconnect:
        await chat_room.disconnect(websocket, db)
    except Exception as e:
        print(f"❌ WebSocket ошибка: {e}")
        await chat_room.disconnect(websocket, db)

@app.get("/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)