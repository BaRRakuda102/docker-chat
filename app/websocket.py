import asyncio
from typing import Dict, Set
from datetime import datetime
import json

class ConnectionManager:
    def __init__(self, redis_client):
        self.redis = redis_client
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        self.user_connections: Dict[int, WebSocket] = {}
        self.message_callbacks = {}
    
    async def connect(self, websocket: WebSocket, user_id: int, room_id: int):
        await websocket.accept()
        
        if room_id not in self.active_connections:
            self.active_connections[room_id] = set()
        
        self.active_connections[room_id].add(websocket)
        self.user_connections[user_id] = websocket
        
        # Обновляем статус пользователя
        await self.redis.hset(f"user:{user_id}:presence", "status", "online")
        await self.redis.hset(f"user:{user_id}:presence", "room", room_id)
        await self.redis.hset(f"user:{user_id}:presence", "last_seen", datetime.now().isoformat())
        
        # Отправляем подтверждение о подключении
        await websocket.send_json({
            "type": "connection_established",
            "user_id": user_id,
            "room_id": room_id
        })
    
    async def send_message_with_confirmation(self, room_id: int, message: dict):
        """Отправка сообщения с отслеживанием доставки и прочтения"""
        sent_to = []
        
        if room_id in self.active_connections:
            for connection in self.active_connections[room_id]:
                try:
                    await connection.send_json(message)
                    sent_to.append(id(connection))
                    
                    # Отправляем подтверждение доставки отправителю
                    if message.get('sender_id'):
                        sender_ws = self.user_connections.get(message['sender_id'])
                        if sender_ws:
                            await sender_ws.send_json({
                                "type": "delivery_confirmation",
                                "message_id": message['id'],
                                "delivered_to": len(sent_to)
                            })
                except:
                    pass
        
        # Обновляем статус доставки в Redis
        await self.redis.hset(f"message:{message['id']}:delivery", "delivered", len(sent_to))
        
        return len(sent_to)
    
    async def mark_as_read(self, message_id: int, user_id: int, room_id: int):
        """Отметка сообщения как прочитанного"""
        await self.redis.sadd(f"message:{message_id}:read", user_id)
        
        # Уведомляем отправителя
        read_count = await self.redis.scard(f"message:{message_id}:read")
        
        # Находим отправителя сообщения
        sender_id = await self.redis.hget(f"message:{message_id}", "sender_id")
        
        if sender_id and int(sender_id) in self.user_connections:
            await self.user_connections[int(sender_id)].send_json({
                "type": "read_confirmation",
                "message_id": message_id,
                "read_by": user_id,
                "read_count": read_count
            })
    
    async def get_message_status(self, message_id: int) -> dict:
        """Получение статуса сообщения"""
        delivered = await self.redis.scard(f"message:{message_id}:delivered")
        read = await self.redis.scard(f"message:{message_id}:read")
        
        return {
            "delivered_count": delivered,
            "read_count": read,
            "is_delivered": delivered > 0,
            "is_read": read > 0
        }
    
    async def disconnect(self, websocket: WebSocket, user_id: int, room_id: int):
        if room_id in self.active_connections:
            self.active_connections[room_id].discard(websocket)
        
        if user_id in self.user_connections:
            del self.user_connections[user_id]
        
        # Обновляем статус
        await self.redis.hset(f"user:{user_id}:presence", "status", "offline")
        await self.redis.hset(f"user:{user_id}:presence", "last_seen", datetime.now().isoformat())