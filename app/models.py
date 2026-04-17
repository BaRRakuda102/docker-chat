from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, ForeignKey, Table
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime
import bcrypt
from passlib.context import CryptContext

Base = declarative_base()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Таблица связи пользователей и комнат (многие ко многим)
user_room = Table('user_room', Base.metadata,
    Column('user_id', Integer, ForeignKey('users.id')),
    Column('room_id', Integer, ForeignKey('rooms.id')),
    Column('joined_at', DateTime, default=datetime.utcnow),
    Column('role', String, default='member')  # member, admin, creator
)

class User(Base):
    __tablename__ = 'users'
    
    id = Column(Integer, primary_key=True)
    username = Column(String(50), unique=True, nullable=False)
    email = Column(String(100), unique=True, nullable=False, index=True)
    email_verified = Column(Boolean, default=False)
    verification_code = Column(String(6))
    password_hash = Column(String(255), nullable=False)
    avatar_url = Column(String(500))
    is_superadmin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_seen = Column(DateTime, default=datetime.utcnow)
    timezone = Column(String(50), default='UTC')
    
    # 2FA
    twofa_secret = Column(String(100))
    twofa_enabled = Column(Boolean, default=False)
    
    # Отношения
    rooms = relationship('Room', secondary=user_room, back_populates='users')
    messages = relationship('Message', foreign_keys='Message.user_id')
    
    def set_password(self, password):
        self.password_hash = pwd_context.hash(password)
    
    def verify_password(self, password):
        return pwd_context.verify(password, self.password_hash)
    
    def generate_verification_code(self):
        import random
        self.verification_code = f"{random.randint(100000, 999999)}"
        return self.verification_code

class Room(Base):
    __tablename__ = 'rooms'
    
    id = Column(Integer, primary_key=True)
    name = Column(String(100), unique=True, nullable=False)
    description = Column(Text)
    is_private = Column(Boolean, default=True)
    password_hash = Column(String(255))
    creator_id = Column(Integer, ForeignKey('users.id'))
    created_at = Column(DateTime, default=datetime.utcnow)
    invite_link = Column(String(100), unique=True)
    
    # Отношения
    creator = relationship('User', foreign_keys=[creator_id])
    users = relationship('User', secondary=user_room, back_populates='rooms')
    messages = relationship('Message', back_populates='room')
    
    def set_password(self, password):
        if password:
            self.password_hash = pwd_context.hash(password)
            self.is_private = True
        else:
            self.password_hash = None
            self.is_private = False
    
    def verify_password(self, password):
        if not self.password_hash:
            return True
        return pwd_context.verify(password, self.password_hash)
    
    def generate_invite_link(self):
        import secrets
        self.invite_link = secrets.token_urlsafe(16)
        return self.invite_link

class Message(Base):
    __tablename__ = 'messages'
    
    id = Column(Integer, primary_key=True)
    room_id = Column(Integer, ForeignKey('rooms.id'))
    user_id = Column(Integer, ForeignKey('users.id'))
    encrypted_content = Column(Text, nullable=False)
    nonce = Column(String(24), nullable=False)  # Для шифрования
    message_type = Column(String(20), default='text')  # text, image, voice
    reply_to_id = Column(Integer, ForeignKey('messages.id'), nullable=True)
    edited = Column(Boolean, default=False)
    deleted_for = Column(Text)  # JSON список user_id
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Отношения
    room = relationship('Room', back_populates='messages')
    user = relationship('User', foreign_keys=[user_id])
    reply_to = relationship('Message', remote_side=[id])

class MessageStatus(Base):
    __tablename__ = 'message_status'
    
    id = Column(Integer, primary_key=True)
    message_id = Column(Integer, ForeignKey('messages.id'))
    user_id = Column(Integer, ForeignKey('users.id'))
    delivered_at = Column(DateTime)
    read_at = Column(DateTime)

class UserSession(Base):
    __tablename__ = 'user_sessions'
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'))
    session_token = Column(String(255), unique=True)
    device_info = Column(String(500))
    ip_address = Column(String(45))
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime)
    is_active = Column(Boolean, default=True)

class SupportTicket(Base):
    __tablename__ = 'support_tickets'
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'))
    room_id = Column(Integer, ForeignKey('rooms.id'))
    status = Column(String(20), default='open')  # open, in_progress, closed
    created_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime)

class BannedUser(Base):
    __tablename__ = 'banned_users'
    
    id = Column(Integer, primary_key=True)
    room_id = Column(Integer, ForeignKey('rooms.id'))
    user_id = Column(Integer, ForeignKey('users.id'))
    banned_by = Column(Integer, ForeignKey('users.id'))
    reason = Column(Text)
    banned_at = Column(DateTime, default=datetime.utcnow)