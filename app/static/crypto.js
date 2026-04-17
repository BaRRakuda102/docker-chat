// crypto.js - Клиентское шифрование для чата

class ChatCrypto {
    constructor() {
        this.roomKeys = new Map(); // Хранение ключей для комнат
    }
    
    // Генерация ключа для комнаты
    async generateRoomKey(roomId) {
        // Генерируем случайный ключ (32 байта для AES-256)
        const key = await crypto.subtle.generateKey(
            {
                name: "AES-GCM",
                length: 256
            },
            true,  // ключ можно экспортировать
            ["encrypt", "decrypt"]
        );
        
        // Сохраняем ключ
        this.roomKeys.set(roomId, key);
        
        // Экспортируем ключ для сохранения в localStorage
        const exportedKey = await crypto.subtle.exportKey("jwk", key);
        localStorage.setItem(`room_key_${roomId}`, JSON.stringify(exportedKey));
        
        return key;
    }
    
    // Загрузка ключа комнаты из localStorage
    async loadRoomKey(roomId) {
        const savedKey = localStorage.getItem(`room_key_${roomId}`);
        if (savedKey) {
            const keyData = JSON.parse(savedKey);
            const key = await crypto.subtle.importKey(
                "jwk",
                keyData,
                { name: "AES-GCM", length: 256 },
                true,
                ["encrypt", "decrypt"]
            );
            this.roomKeys.set(roomId, key);
            return key;
        }
        return null;
    }
    
    // Шифрование сообщения
    async encryptMessage(message, roomId) {
        try {
            // Получаем или загружаем ключ комнаты
            let key = this.roomKeys.get(roomId);
            if (!key) {
                key = await this.loadRoomKey(roomId);
                if (!key) {
                    // Если ключа нет, создаём новый
                    key = await this.generateRoomKey(roomId);
                }
            }
            
            // Генерируем случайный вектор инициализации (12 байт)
            const iv = crypto.getRandomValues(new Uint8Array(12));
            
            // Кодируем сообщение в UTF-8
            const encoder = new TextEncoder();
            const data = encoder.encode(message);
            
            // Шифруем
            const encrypted = await crypto.subtle.encrypt(
                {
                    name: "AES-GCM",
                    iv: iv
                },
                key,
                data
            );
            
            // Объединяем IV и зашифрованные данные в base64
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
            // Получаем ключ комнаты
            let key = this.roomKeys.get(roomId);
            if (!key) {
                key = await this.loadRoomKey(roomId);
                if (!key) {
                    throw new Error('Ключ не найден');
                }
            }
            
            // Декодируем base64
            const encryptedData = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
            
            // Извлекаем IV (первые 12 байт) и зашифрованные данные
            const iv = encryptedData.slice(0, 12);
            const ciphertext = encryptedData.slice(12);
            
            // Расшифровываем
            const decrypted = await crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv: iv
                },
                key,
                ciphertext
            );
            
            // Декодируем в строку
            const decoder = new TextDecoder();
            return decoder.decode(decrypted);
            
        } catch (error) {
            console.error('Ошибка расшифровки:', error);
            return '[Зашифрованное сообщение]';
        }
    }
    
    // Обмен ключами при создании комнаты (для E2EE)
    async shareRoomKey(roomId, recipientPublicKey) {
        const key = this.roomKeys.get(roomId);
        if (!key) return null;
        
        // Экспортируем ключ
        const exportedKey = await crypto.subtle.exportKey("raw", key);
        
        // Шифруем ключ публичным ключом получателя
        const encryptedKey = await crypto.subtle.encrypt(
            { name: "RSA-OAEP" },
            recipientPublicKey,
            exportedKey
        );
        
        return btoa(String.fromCharCode(...new Uint8Array(encryptedKey)));
    }
}

// Создаём глобальный экземпляр
const chatCrypto = new ChatCrypto();