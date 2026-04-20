from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime, timedelta
import bcrypt
import random
import os

# Получаем URL базы данных из переменных окружения Railway
DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///./data/chat.db')

# Для PostgreSQL нужно добавить параметры
if DATABASE_URL and DATABASE_URL.startswith('postgres'):
    # Добавляем параметры для подключения
    DATABASE_URL = DATABASE_URL + '?sslmode=require'

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class User(Base):
    __tablename__ = 'users'
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(100), unique=True, nullable=False, index=True)
    email_verified = Column(Boolean, default=False)
    verification_code = Column(String(6))
    verification_code_expires = Column(DateTime)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(50), nullable=True)
    birth_date = Column(String(20), nullable=True)
    avatar_url = Column(String(500), default="/static/default-avatar.png")
    is_superadmin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_seen = Column(DateTime, default=datetime.utcnow)
    
    def set_password(self, password: str):
        salt = bcrypt.gensalt()
        self.password_hash = bcrypt.hashpw(password.encode(), salt).decode()
    
    def verify_password(self, password: str) -> bool:
        return bcrypt.checkpw(password.encode(), self.password_hash.encode())
    
    def generate_verification_code(self):
        self.verification_code = f"{random.randint(100000, 999999)}"
        self.verification_code_expires = datetime.utcnow() + timedelta(minutes=15)
        return self.verification_code

class Room(Base):
    __tablename__ = 'rooms'
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    room_uuid = Column(String(20), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    creator = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class RoomMessage(Base):
    __tablename__ = 'room_messages'
    
    id = Column(Integer, primary_key=True, index=True)
    room_name = Column(String(100), nullable=False, index=True)
    message_data = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class RoomUser(Base):
    __tablename__ = 'room_users'
    
    id = Column(Integer, primary_key=True, index=True)
    room_name = Column(String(100), nullable=False, index=True)
    username = Column(String(50), nullable=False)
    joined_at = Column(DateTime, default=datetime.utcnow)

class PrivateChat(Base):
    __tablename__ = 'private_chats'
    
    id = Column(Integer, primary_key=True, index=True)
    user1 = Column(String(50), nullable=False)
    user2 = Column(String(50), nullable=False)
    last_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class PrivateMessage(Base):
    __tablename__ = 'private_messages'
    
    id = Column(Integer, primary_key=True, index=True)
    chat_id = Column(Integer, nullable=False)
    sender = Column(String(50), nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

# Создаём таблицы
Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()