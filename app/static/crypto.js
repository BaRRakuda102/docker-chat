// crypto.js - Простое шифрование для чата

class ChatCrypto {
    constructor() {
        this.roomKeys = new Map();
    }
    
    // Генерация случайного ключа
    generateRandomKey() {
        const key = crypto.getRandomValues(new Uint8Array(32));
        return btoa(String.fromCharCode(...key));
    }
    
    // Импорт ключа из base64
    async importKey(keyBase64) {
        const keyData = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
        return await crypto.subtle.importKey(
            "raw",
            keyData,
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
        );
    }
    
    // Сохранение ключа комнаты
    async setRoomKey(roomId, keyBase64) {
        const key = await this.importKey(keyBase64);
        this.roomKeys.set(roomId, key);
        localStorage.setItem(`room_key_${roomId}`, keyBase64);
        console.log('🔐 Ключ комнаты сохранён');
        return key;
    }
    
    // Загрузка ключа комнаты
    async loadRoomKey(roomId) {
        const savedKey = localStorage.getItem(`room_key_${roomId}`);
        if (savedKey) {
            const key = await this.importKey(savedKey);
            this.roomKeys.set(roomId, key);
            console.log('🔐 Ключ комнаты загружен');
            return key;
        }
        return null;
    }
    
    // Получение ключа комнаты
    async getRoomKey(roomId) {
        if (this.roomKeys.has(roomId)) {
            return this.roomKeys.get(roomId);
        }
        return await this.loadRoomKey(roomId);
    }
    
    // Шифрование сообщения
    async encryptMessage(message, roomId) {
        try {
            let key = await this.getRoomKey(roomId);
            if (!key) {
                console.error('Нет ключа для комнаты', roomId);
                return null;
            }
            
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const encoder = new TextEncoder();
            const data = encoder.encode(message);
            const encrypted = await crypto.subtle.encrypt(
                { name: "AES-GCM", iv: iv },
                key,
                data
            );
            
            const encryptedArray = new Uint8Array(encrypted);
            const result = new Uint8Array(iv.length + encryptedArray.length);
            result.set(iv);
            result.set(encryptedArray, iv.length);
            
            return btoa(String.fromCharCode(...result));
        } catch (error) {
            console.error('Ошибка шифрования:', error);
            return null;
        }
    }
    
    // Расшифровка сообщения
    async decryptMessage(encryptedBase64, roomId) {
        try {
            let key = await this.getRoomKey(roomId);
            if (!key) {
                console.error('Нет ключа для комнаты', roomId);
                return '[Нет ключа]';
            }
            
            const encryptedData = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
            const iv = encryptedData.slice(0, 12);
            const ciphertext = encryptedData.slice(12);
            
            const decrypted = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                key,
                ciphertext
            );
            
            const decoder = new TextDecoder();
            return decoder.decode(decrypted);
        } catch (error) {
            console.error('Ошибка расшифровки:', error);
            return '[Зашифровано]';
        }
    }
}

const chatCrypto = new ChatCrypto();