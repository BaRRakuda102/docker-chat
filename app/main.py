from fastapi import FastAPI, HTTPException, Depends, status, Request, Form, UploadFile, File
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
import os
import json
import secrets
from pathlib import Path
import shutil
from passlib.context import CryptContext
from jose import JWTError, jwt
import asyncio
from fastapi import WebSocket, WebSocketDisconnect
import re

from database import (
    get_db, User, Room, RoomMessage, RoomUser, 
    PrivateChat, PrivateMessage, Base, engine
)

# ========== Конфигурация ==========
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-this-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Настройка паролей
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2 схема
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")

# FastAPI приложение
app = FastAPI(title="Chat Application")

# Монтируем статические файлы
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/avatars", StaticFiles(directory="avatars"), name="avatars")

# Шаблоны
templates = Jinja2Templates(directory="templates")

# Создаем директории
UPLOAD_DIR = Path("uploads")
AVATAR_DIR = Path("avatars")
UPLOAD_DIR.mkdir(exist_ok=True)
AVATAR_DIR.mkdir(exist_ok=True)

# ========== Вспомогательные функции ==========
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def authenticate_user(db: Session, username: str, password: str):
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.password_hash):
        return False
    return user

def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

# ========== ChatRoom класс (ПОЛНОСТЬЮ ИСПРАВЛЕН) ==========
class ChatRoom:
    def __init__(self):
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}
    
    async def add_user_to_room(self, room_name: str, username: str, db: Session):
        """Добавляет пользователя в комнату через ID"""
        room = db.query(Room).filter(Room.name == room_name).first()
        user = db.query(User).filter(User.username == username).first()
        
        if not room or not user:
            return False
        
        # Проверяем, не добавлен ли уже
        existing = db.query(RoomUser).filter(
            RoomUser.room_id == room.id,
            RoomUser.user_id == user.id
        ).first()
        
        if existing:
            return True
        
        # Создаем запись в room_users
        room_user = RoomUser(
            room_id=room.id,
            user_id=user.id,
            joined_at=datetime.utcnow()
        )
        db.add(room_user)
        db.commit()
        return True
    
    async def get_room_users(self, room_name: str, db: Session):
        """Получает список пользователей в комнате"""
        room = db.query(Room).filter(Room.name == room_name).first()
        if not room:
            return []
        
        # Получаем пользователей через связь RoomUser -> User
        users = db.query(User).join(RoomUser).filter(RoomUser.room_id == room.id).all()
        return [user.username for user in users]
    
    async def remove_user_from_room(self, room_name: str, username: str, db: Session):
        """Удаляет пользователя из комнаты"""
        room = db.query(Room).filter(Room.name == room_name).first()
        user = db.query(User).filter(User.username == username).first()
        
        if room and user:
            db.query(RoomUser).filter(
                RoomUser.room_id == room.id,
                RoomUser.user_id == user.id
            ).delete()
            db.commit()
    
    async def connect(self, websocket: WebSocket, room_name: str, username: str, user_id: int, db: Session):
        await websocket.accept()
        
        # Добавляем пользователя в комнату в БД
        await self.add_user_to_room(room_name, username, db)
        
        if room_name not in self.active_connections:
            self.active_connections[room_name] = {}
        
        self.active_connections[room_name][username] = websocket
        
        # Отправляем историю сообщений
        room = db.query(Room).filter(Room.name == room_name).first()
        if room:
            messages = db.query(RoomMessage).filter(
                RoomMessage.room_id == room.id
            ).order_by(RoomMessage.created_at).all()
            
            for msg in messages:
                await websocket.send_json({
                    "type": "history",
                    "username": msg.user.username,
                    "message": msg.message_data,
                    "timestamp": msg.created_at.isoformat()
                })
        
        # Уведомляем всех о новом пользователе
        await self.broadcast(room_name, {
            "type": "user_joined",
            "username": username
        })
    
    async def disconnect(self, room_name: str, username: str, db: Session):
        if room_name in self.active_connections:
            if username in self.active_connections[room_name]:
                del self.active_connections[room_name][username]
            
            if not self.active_connections[room_name]:
                del self.active_connections[room_name]
        
        # Удаляем из БД
        await self.remove_user_from_room(room_name, username, db)
        
        await self.broadcast(room_name, {
            "type": "user_left",
            "username": username
        })
    
    async def broadcast(self, room_name: str, message: dict):
        if room_name in self.active_connections:
            for username, connection in self.active_connections[room_name].items():
                try:
                    await connection.send_json(message)
                except:
                    pass
    
    async def send_message(self, room_name: str, username: str, message: str, db: Session):
        # Сохраняем сообщение в БД
        room = db.query(Room).filter(Room.name == room_name).first()
        user = db.query(User).filter(User.username == username).first()
        
        if room and user:
            db_message = RoomMessage(
                room_id=room.id,
                user_id=user.id,
                message_data=message,
                created_at=datetime.utcnow()
            )
            db.add(db_message)
            db.commit()
        
        # Отправляем всем в комнате
        await self.broadcast(room_name, {
            "type": "message",
            "username": username,
            "message": message,
            "timestamp": datetime.utcnow().isoformat()
        })

# Создаем экземпляр чата
chat_room = ChatRoom()

# ========== Маршруты ==========
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/api/rooms")
async def get_rooms(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Получить список всех комнат"""
    rooms = db.query(Room).all()
    return [
        {
            "id": room.id,
            "name": room.name,
            "room_uuid": room.room_uuid,
            "created_at": room.created_at.isoformat(),
            "creator_id": room.creator_id
        }
        for room in rooms
    ]

@app.get("/api/rooms/{room_name}/info")
async def get_room_info(room_name: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Получить информацию о комнате"""
    room = db.query(Room).filter(Room.name == room_name).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    users = await chat_room.get_room_users(room_name, db)
    
    return {
        "id": room.id,
        "name": room.name,
        "room_uuid": room.room_uuid,
        "created_at": room.created_at.isoformat(),
        "creator_id": room.creator_id,
        "users": users
    }

@app.post("/api/create_room")
async def create_room(
    room_name: str,
    password: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Создать новую комнату"""
    # Проверяем, существует ли комната
    existing = db.query(Room).filter(Room.name == room_name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Room already exists")
    
    # Генерируем UUID для комнаты
    room_uuid = secrets.token_hex(10)[:20]
    
    # Создаем комнату
    new_room = Room(
        name=room_name,
        room_uuid=room_uuid,
        password_hash=get_password_hash(password),
        creator_id=current_user.id,
        created_at=datetime.utcnow()
    )
    db.add(new_room)
    db.commit()
    db.refresh(new_room)
    
    return {"message": "Room created", "room_id": new_room.id, "room_uuid": room_uuid}

@app.post("/api/join_room")
async def join_room(
    room_name: str,
    password: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Присоединиться к комнате"""
    room = db.query(Room).filter(Room.name == room_name).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Проверяем пароль
    if not verify_password(password, room.password_hash):
        raise HTTPException(status_code=401, detail="Invalid password")
    
    # Добавляем пользователя в комнату
    await chat_room.add_user_to_room(room_name, current_user.username, db)
    
    return {"message": "Joined room"}

@app.delete("/api/delete_room/{room_name}")
async def delete_room(
    room_name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Удалить комнату (только создатель)"""
    room = db.query(Room).filter(Room.name == room_name).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Проверяем, что пользователь - создатель
    if room.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only room creator can delete this room")
    
    # Удаляем все сообщения комнаты
    db.query(RoomMessage).filter(RoomMessage.room_id == room.id).delete()
    
    # Удаляем всех пользователей из комнаты
    db.query(RoomUser).filter(RoomUser.room_id == room.id).delete()
    
    # Удаляем комнату
    db.delete(room)
    db.commit()
    
    return {"message": "Room deleted"}

@app.post("/api/login")
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Вход в систему"""
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Обновляем сессию
    user.refresh_session()
    db.commit()
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    
    return {
        "access_token": access_token, 
        "token_type": "bearer",
        "session_token": user.session_token
    }

@app.post("/api/register")
async def register(
    username: str,
    email: str,
    password: str,
    display_name: Optional[str] = None,
    birth_date: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Регистрация нового пользователя"""
    # Проверяем существующего пользователя
    existing_user = db.query(User).filter(
        or_(User.username == username, User.email == email)
    ).first()
    
    if existing_user:
        raise HTTPException(status_code=400, detail="Username or email already exists")
    
    # Создаем нового пользователя
    new_user = User(
        username=username,
        email=email,
        password_hash=get_password_hash(password),
        display_name=display_name or username,
        created_at=datetime.utcnow(),
        last_seen=datetime.utcnow()
    )
    
    # Устанавливаем дату рождения если указана
    if birth_date:
        try:
            new_user.birth_date = datetime.strptime(birth_date, "%Y-%m-%d").date()
        except:
            pass
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return {"message": "User created successfully"}

@app.get("/api/user/profile")
async def get_user_profile(
    username: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Получить профиль пользователя"""
    target_user = current_user
    if username and username != current_user.username:
        target_user = db.query(User).filter(User.username == username).first()
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "id": target_user.id,
        "username": target_user.username,
        "email": target_user.email,
        "display_name": target_user.display_name,
        "avatar_url": target_user.avatar_url,
        "birth_date": target_user.birth_date.isoformat() if target_user.birth_date else None,
        "created_at": target_user.created_at.isoformat(),
        "is_superadmin": target_user.is_superadmin
    }

@app.post("/api/user/upload_avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Загрузка аватара пользователя"""
    # Проверяем тип файла
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    # Генерируем уникальное имя файла
    ext = file.filename.split(".")[-1]
    filename = f"{secrets.token_hex(16)}.{ext}"
    file_path = AVATAR_DIR / filename
    
    # Сохраняем файл
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Обновляем URL аватара в БД
    avatar_url = f"/avatars/{filename}"
    current_user.avatar_url = avatar_url
    db.commit()
    
    return {"avatar_url": avatar_url}

# ========== WebSocket ==========
@app.websocket("/ws/{room_name}/{username}/{user_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    room_name: str,
    username: str,
    user_id: int
):
    # Декодируем URL-encoded строки
    from urllib.parse import unquote
    room_name = unquote(room_name)
    username = unquote(username)
    
    # Получаем сессию БД
    db = next(get_db())
    
    try:
        await chat_room.connect(websocket, room_name, username, user_id, db)
        
        while True:
            try:
                data = await websocket.receive_text()
                message_data = json.loads(data)
                
                if message_data.get("type") == "message":
                    await chat_room.send_message(
                        room_name, 
                        username, 
                        message_data.get("message", ""), 
                        db
                    )
            except WebSocketDisconnect:
                await chat_room.disconnect(room_name, username, db)
                break
            except Exception as e:
                print(f"WebSocket error: {e}")
                continue
    finally:
        db.close()