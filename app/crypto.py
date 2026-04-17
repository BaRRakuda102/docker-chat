from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2
from cryptography.hazmat.primitives import hashes
import base64
import os
import secrets

class MessageEncryption:
    def __init__(self, master_key: bytes):
        # Мастер-ключ должен быть 32 байта
        self.master_key = master_key
    
    @classmethod
    def generate_key(cls, password: str, salt: bytes = None):
        if salt is None:
            salt = secrets.token_bytes(16)
        kdf = PBKDF2(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
        )
        key = kdf.derive(password.encode())
        return key, salt
    
    def encrypt_message(self, message: str, user_id: int, room_id: int) -> tuple:
        """Шифрование сообщения с использованием контекста комнаты и пользователя"""
        # Создаём уникальный ключ для сообщения
        context = f"{room_id}:{user_id}".encode()
        aesgcm = AESGCM(self.master_key)
        nonce = secrets.token_bytes(12)
        ciphertext = aesgcm.encrypt(nonce, message.encode(), context)
        return base64.b64encode(ciphertext).decode(), base64.b64encode(nonce).decode()
    
    def decrypt_message(self, ciphertext: str, nonce: str, user_id: int, room_id: int) -> str:
        """Расшифровка сообщения"""
        context = f"{room_id}:{user_id}".encode()
        aesgcm = AESGCM(self.master_key)
        plaintext = aesgcm.decrypt(
            base64.b64decode(nonce),
            base64.b64decode(ciphertext),
            context
        )
        return plaintext.decode()

# E2E шифрование (опционально для приватных чатов)
class E2EEncryption:
    @staticmethod
    def generate_keypair():
        from cryptography.hazmat.primitives.asymmetric import x25519
        private_key = x25519.X25519PrivateKey.generate()
        public_key = private_key.public_key()
        return private_key, public_key
    
    @staticmethod
    def derive_shared_key(private_key, peer_public_key):
        shared_secret = private_key.exchange(peer_public_key)
        return shared_secret