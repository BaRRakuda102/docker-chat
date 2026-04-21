from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, Text, ForeignKey, UniqueConstraint, Index, Date
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime, timedelta
import secrets
import os
import sqlite3

# Получаем URL базы данных
DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///./data/chat.db')

# Для PostgreSQL на Railway
if DATABASE_URL and DATABASE_URL.startswith('postgres'):
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
    display_name = Column(String(100), nullable=True)
    birth_date = Column(Date, nullable=True)
    avatar_url = Column(String(500), default="/static/default-avatar.png")
    is_superadmin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_seen = Column(DateTime, default=datetime.utcnow)
    
    # Сессия с истечением срока
    session_token = Column(String(64), nullable=True, index=True)
    session_expires = Column(DateTime, nullable=True)
    
    # Связи
    room_users = relationship("RoomUser", back_populates="user", cascade="all, delete-orphan")
    private_chats_1 = relationship("PrivateChat", foreign_keys="PrivateChat.user1_id", back_populates="user1")
    private_chats_2 = relationship("PrivateChat", foreign_keys="PrivateChat.user2_id", back_populates="user2")
    
    def set_password(self, password: str):
        from passlib.context import CryptContext
        pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        self.password_hash = pwd_context.hash(password)
    
    def verify_password(self, password: str) -> bool:
        from passlib.context import CryptContext
        pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        return pwd_context.verify(password, self.password_hash)
    
    def generate_verification_code(self):
        self.verification_code = str(secrets.randbelow(900000) + 100000)
        self.verification_code_expires = datetime.utcnow() + timedelta(minutes=15)
        return self.verification_code
    
    def is_session_valid(self):
        if not self.session_token or not self.session_expires:
            return False
        return self.session_expires > datetime.utcnow()
    
    def refresh_session(self):
        self.session_token = secrets.token_urlsafe(32)
        self.session_expires = datetime.utcnow() + timedelta(days=7)
        return self.session_token

class Room(Base):
    __tablename__ = 'rooms'
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    room_uuid = Column(String(20), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    creator_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    # Связи
    creator = relationship("User", foreign_keys=[creator_id])
    messages = relationship("RoomMessage", back_populates="room", cascade="all, delete-orphan")
    room_users = relationship("RoomUser", back_populates="room", cascade="all, delete-orphan")

class RoomMessage(Base):
    __tablename__ = 'room_messages'
    
    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey('rooms.id'), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    message_data = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    room = relationship("Room", back_populates="messages")
    user = relationship("User", foreign_keys=[user_id])

class RoomUser(Base):
    __tablename__ = 'room_users'
    
    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey('rooms.id'), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    joined_at = Column(DateTime, default=datetime.utcnow)
    
    room = relationship("Room", back_populates="room_users")
    user = relationship("User", back_populates="room_users")
    
    __table_args__ = (
        UniqueConstraint('room_id', 'user_id', name='unique_room_user'),
    )

class PrivateChat(Base):
    __tablename__ = 'private_chats'
    
    id = Column(Integer, primary_key=True, index=True)
    user1_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    user2_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    last_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    user1 = relationship("User", foreign_keys=[user1_id], back_populates="private_chats_1")
    user2 = relationship("User", foreign_keys=[user2_id], back_populates="private_chats_2")
    messages = relationship("PrivateMessage", back_populates="chat", cascade="all, delete-orphan")
    
    __table_args__ = (
        UniqueConstraint('user1_id', 'user2_id', name='unique_private_chat'),
    )

class PrivateMessage(Base):
    __tablename__ = 'private_messages'
    
    id = Column(Integer, primary_key=True, index=True)
    chat_id = Column(Integer, ForeignKey('private_chats.id'), nullable=False, index=True)
    sender_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    chat = relationship("PrivateChat", back_populates="messages")

def upgrade_sqlite_schema():
    """Принудительное обновление схемы SQLite для всех таблиц"""
    if not DATABASE_URL.startswith('sqlite'):
        return
    
    db_path = DATABASE_URL.replace('sqlite:///', '')
    if not os.path.exists(db_path):
        return
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Обновление таблицы users
    cursor.execute("PRAGMA table_info(users)")
    existing_columns = [col[1] for col in cursor.fetchall()]
    
    if 'session_token' not in existing_columns:
        print("Adding session_token column to users table")
        cursor.execute("ALTER TABLE users ADD COLUMN session_token VARCHAR(64)")
    
    if 'session_expires' not in existing_columns:
        print("Adding session_expires column to users table")
        cursor.execute("ALTER TABLE users ADD COLUMN session_expires DATETIME")
    
    # Обновление таблицы rooms
    cursor.execute("PRAGMA table_info(rooms)")
    room_columns = [col[1] for col in cursor.fetchall()]
    
    if 'creator_id' not in room_columns:
        print("Adding creator_id column to rooms table")
        cursor.execute("ALTER TABLE rooms ADD COLUMN creator_id INTEGER REFERENCES users(id)")
    
    conn.commit()
    conn.close()

# Обновляем схему перед созданием таблиц
upgrade_sqlite_schema()

# Создаём таблицы (если их нет)
Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()