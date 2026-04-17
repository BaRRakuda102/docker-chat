let ws = null;
let currentUser = '';
let currentRoom = '';
let currentUserId = '';
let rooms = [];
let replyToMessage = null;
let editingMessage = null;

document.addEventListener('DOMContentLoaded', async () => {
    currentUserId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    console.log('Инициализация, user ID:', currentUserId);
    
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.addEventListener('paste', handlePaste);
    }
    
    const imageInput = document.getElementById('imageInput');
    if (imageInput) {
        imageInput.addEventListener('change', uploadImage);
    }
    
    document.addEventListener('click', (e) => {
        const picker = document.getElementById('messageEmojiPicker');
        const btn = document.getElementById('emojiPickerBtn');
        if (picker && btn && !btn.contains(e.target) && !picker.contains(e.target)) {
            picker.style.display = 'none';
        }
    });
    
    await restoreSession();
});

async function restoreSession() {
    const savedUser = localStorage.getItem('chat_user');
    const savedRoom = localStorage.getItem('chat_room');
    
    if (savedUser && savedRoom) {
        currentUser = savedUser;
        currentRoom = savedRoom;
        
        try {
            const response = await fetch('/api/rooms');
            const data = await response.json();
            
            if (data.success) {
                const roomExists = data.rooms.some(r => r.name === savedRoom);
                if (roomExists) {
                    document.getElementById('authScreen').style.display = 'none';
                    document.getElementById('roomsScreen').style.display = 'none';
                    document.getElementById('chatApp').style.display = 'flex';
                    document.getElementById('currentUser').textContent = currentUser;
                    const currentRoomNameSpan = document.getElementById('currentRoomName');
                    if (currentRoomNameSpan) currentRoomNameSpan.textContent = currentRoom;
                    document.getElementById('currentRoom').textContent = currentRoom;
                    connectWebSocket();
                    return;
                }
            }
        } catch (error) {
            console.error('Ошибка восстановления:', error);
        }
    }
    
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('roomsScreen').style.display = 'none';
    document.getElementById('chatApp').style.display = 'none';
}

async function loadRooms() {
    try {
        const response = await fetch('/api/rooms');
        const data = await response.json();
        rooms = data.success ? (data.rooms || []) : [];
        renderRooms();
    } catch (error) {
        console.error('Ошибка загрузки комнат:', error);
        rooms = [];
        renderRooms();
    }
}

function renderRooms() {
    const container = document.getElementById('roomsList');
    if (container) {
        if (rooms.length === 0) {
            container.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:40px;">Нет комнат. Создайте первую!</div>';
        } else {
            container.innerHTML = rooms.map(room => `
                <div class="room-card" onclick="promptJoinRoom('${room.name}')">
                    <i class="fas fa-lock"></i>
                    <h4>${escapeHtml(room.name)}</h4>
                    <p>Создал: ${escapeHtml(room.creator)}</p>
                </div>
            `).join('');
        }
    }
}

function showRooms() {
    const username = document.getElementById('username').value.trim();
    if (!username) {
        alert('Введите ваше имя');
        return;
    }
    currentUser = username;
    
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('roomsScreen').style.display = 'flex';
    loadRooms();
}

function showCreateRoom() {
    document.getElementById('createRoomModal').style.display = 'flex';
    document.getElementById('newRoomName').value = '';
    document.getElementById('newRoomPassword').value = '';
}

function closeModal() {
    document.getElementById('createRoomModal').style.display = 'none';
    document.getElementById('joinRoomModal').style.display = 'none';
}

async function createRoom() {
    const name = document.getElementById('newRoomName').value.trim();
    const password = document.getElementById('newRoomPassword').value;
    
    if (!name || !password) {
        alert('Заполните все поля');
        return;
    }
    
    if (name.length < 3) {
        alert('Название комнаты должно быть не менее 3 символов');
        return;
    }
    
    if (password.length < 4) {
        alert('Пароль должен быть не менее 4 символов');
        return;
    }
    
    try {
        const response = await fetch('/api/create_room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, password: password, creator: currentUser })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`Комната "${name}" успешно создана!`);
            closeModal();
            await loadRooms();
            await switchRoom(data.room);
        } else {
            alert('Ошибка: ' + (data.error || 'Неизвестная ошибка'));
        }
    } catch (error) {
        console.error('Ошибка при создании комнаты:', error);
        alert('Ошибка соединения с сервером.');
    }
}

let pendingRoom = '';

function promptJoinRoom(roomName) {
    pendingRoom = roomName;
    document.getElementById('joinRoomName').innerHTML = `<i class="fas fa-hashtag"></i> ${roomName}`;
    document.getElementById('joinRoomModal').style.display = 'flex';
    document.getElementById('roomPassword').value = '';
}

async function joinRoom() {
    const password = document.getElementById('roomPassword').value;
    
    if (!password) {
        alert('Введите пароль');
        return;
    }
    
    try {
        const response = await fetch('/api/join_room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room: pendingRoom, password: password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            closeModal();
            await switchRoom(pendingRoom);
        } else {
            alert('Ошибка: ' + (data.error || 'Неверный пароль'));
        }
    } catch (error) {
        console.error('Ошибка при входе в комнату:', error);
        alert('Ошибка соединения с сервером');
    }
}

async function switchRoom(roomName) {
    if (ws) {
        ws.close();
        ws = null;
    }
    
    currentRoom = roomName;
    replyToMessage = null;
    editingMessage = null;
    
    localStorage.setItem('chat_user', currentUser);
    localStorage.setItem('chat_room', currentRoom);
    
    document.getElementById('roomsScreen').style.display = 'none';
    document.getElementById('chatApp').style.display = 'flex';
    document.getElementById('currentUser').textContent = currentUser;
    document.getElementById('currentRoom').textContent = roomName;
    
    const currentRoomNameSpan = document.getElementById('currentRoomName');
    if (currentRoomNameSpan) {
        currentRoomNameSpan.textContent = roomName;
    }
    
    document.getElementById('messages').innerHTML = '';
    await updateRoomInfo();
    
    connectWebSocket();
}

function leaveRoom() {
    if (confirm('Выйти из комнаты?')) {
        if (ws) {
            ws.close();
            ws = null;
        }
        
        document.getElementById('chatApp').style.display = 'none';
        document.getElementById('roomsScreen').style.display = 'flex';
        loadRooms();
    }
}

function connectWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/${currentRoom}/${currentUser}/${currentUserId}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket подключен');
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.disabled = false;
            messageInput.placeholder = 'Введите сообщение...';
            messageInput.focus();
        }
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'room_deleted') {
                alert(data.message);
                document.getElementById('chatApp').style.display = 'none';
                document.getElementById('roomsScreen').style.display = 'flex';
                loadRooms();
                return;
            }
            
            handleMessage(data);
            
            if (data.type === 'message' && data.username !== currentUser) {
                playNotificationSound();
            }
        } catch (e) {
            console.error('Ошибка парсинга сообщения:', e);
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket ошибка:', error);
    };
    
    ws.onclose = () => {
        console.log('WebSocket отключен');
    };
}

function handleMessage(data) {
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) return;
    
    if (data.type === 'message') {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message';
        msgDiv.id = `msg-${data.id}`;
        
        let replyHtml = '';
        if (data.reply_to) {
            replyHtml = `
                <div class="reply-preview">
                    <i class="fas fa-reply"></i>
                    <span>Ответ ${escapeHtml(data.reply_to.username)}: ${escapeHtml(data.reply_to.message.substring(0, 50))}</span>
                </div>
            `;
        }
        
        msgDiv.innerHTML = `
            <div class="message-header">
                <span class="username" style="color: ${getUserColor(data.username)}">${escapeHtml(data.username)}</span>
                <span class="timestamp">${data.timestamp}</span>
            </div>
            ${replyHtml}
            <div class="message-text">${parseMessageWithMentions(data.message)}</div>
            <div class="message-actions">
                <button onclick="replyToMessageById('${data.id}', '${escapeHtml(data.username)}', '${escapeHtml(data.message)}')" class="action-btn">
                    <i class="fas fa-reply"></i>
                </button>
                ${data.username === currentUser ? `
                    <button onclick="editMessage('${data.id}', '${escapeHtml(data.message)}')" class="action-btn">
                        <i class="fas fa-edit"></i>
                    </button>
                ` : ''}
            </div>
        `;
        messagesDiv.appendChild(msgDiv);
    } else if (data.type === 'image') {
        const imgDiv = document.createElement('div');
        imgDiv.className = 'message';
        imgDiv.id = `msg-${data.id}`;
        
        imgDiv.innerHTML = `
            <div class="message-header">
                <span class="username" style="color: ${getUserColor(data.username)}">${escapeHtml(data.username)}</span>
                <span class="timestamp">${data.timestamp}</span>
            </div>
            <div class="image-message">
                <img src="${data.url}" alt="image" class="clickable-image" onclick="openImageModal('${data.url}')">
                ${data.caption ? `<div class="image-caption">${escapeHtml(data.caption)}</div>` : ''}
            </div>
            <div class="message-actions">
                <button onclick="replyToMessageById('${data.id}', '${escapeHtml(data.username)}', '[Изображение]')" class="action-btn">
                    <i class="fas fa-reply"></i>
                </button>
            </div>
        `;
        messagesDiv.appendChild(imgDiv);
    } else if (data.type === 'system') {
        const sysDiv = document.createElement('div');
        sysDiv.className = 'system-message';
        sysDiv.textContent = data.message;
        messagesDiv.appendChild(sysDiv);
    } else if (data.type === 'users') {
        document.getElementById('userCount').textContent = data.count;
        document.getElementById('userCountHeader').textContent = data.count;
        updateUsersList(data.users);
    }
    
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function parseMessageWithMentions(text) {
    return text.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
}

function updateUsersList(users) {
    const usersList = document.getElementById('usersList');
    if (!usersList) return;
    
    usersList.innerHTML = users.map(user => `
        <div class="user-item" onclick="insertMention('${user}')">
            <i class="fas fa-user-circle"></i>
            <span>${escapeHtml(user)}</span>
            ${user === currentUser ? ' (Вы)' : ''}
        </div>
    `).join('');
}

function insertMention(username) {
    const input = document.getElementById('messageInput');
    input.value += `@${username} `;
    input.focus();
}

function replyToMessageById(messageId, username, messageText) {
    replyToMessage = { id: messageId, username: username, message: messageText };
    
    let replyIndicator = document.getElementById('replyIndicator');
    if (!replyIndicator) {
        replyIndicator = document.createElement('div');
        replyIndicator.id = 'replyIndicator';
        replyIndicator.className = 'reply-indicator';
        const inputContainer = document.querySelector('.input-container');
        inputContainer.insertBefore(replyIndicator, inputContainer.firstChild);
    }
    
    replyIndicator.innerHTML = `
        <div class="reply-content">
            <i class="fas fa-reply"></i>
            <span>Ответ для <strong>${escapeHtml(username)}</strong>: ${escapeHtml(messageText.substring(0, 50))}</span>
            <button onclick="cancelReply()" class="cancel-reply-btn">✕</button>
        </div>
    `;
    replyIndicator.style.display = 'block';
    
    document.getElementById('messageInput').focus();
}

function cancelReply() {
    replyToMessage = null;
    const replyIndicator = document.getElementById('replyIndicator');
    if (replyIndicator) {
        replyIndicator.style.display = 'none';
    }
}

function editMessage(messageId, currentText) {
    editingMessage = { id: messageId, text: currentText };
    
    const messageInput = document.getElementById('messageInput');
    messageInput.value = currentText;
    messageInput.focus();
    
    let editIndicator = document.getElementById('editIndicator');
    if (!editIndicator) {
        editIndicator = document.createElement('div');
        editIndicator.id = 'editIndicator';
        editIndicator.className = 'edit-indicator-bar';
        const inputContainer = document.querySelector('.input-container');
        inputContainer.insertBefore(editIndicator, inputContainer.firstChild);
    }
    
    editIndicator.innerHTML = `
        <div class="edit-content">
            <i class="fas fa-edit"></i>
            <span>Редактирование сообщения...</span>
            <button onclick="cancelEdit()" class="cancel-edit-btn">✕</button>
        </div>
    `;
    editIndicator.style.display = 'block';
}

function cancelEdit() {
    editingMessage = null;
    const editIndicator = document.getElementById('editIndicator');
    if (editIndicator) {
        editIndicator.style.display = 'none';
    }
    document.getElementById('messageInput').value = '';
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    
    if (!message && !editingMessage) {
        return;
    }
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Нет соединения с чатом.');
        return;
    }
    
    if (editingMessage) {
        ws.send(JSON.stringify({
            type: 'edit_message',
            message_id: editingMessage.id,
            new_text: message
        }));
        cancelEdit();
    } else {
        const messageData = { type: 'message', message: message };
        if (replyToMessage) {
            messageData.reply_to = replyToMessage;
        }
        ws.send(JSON.stringify(messageData));
        cancelReply();
    }
    
    input.value = '';
    input.focus();
}

function toggleMessageEmojiPicker() {
    const picker = document.getElementById('messageEmojiPicker');
    if (picker) {
        picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
    }
}

function insertEmoji(emoji) {
    const input = document.getElementById('messageInput');
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const text = input.value;
    
    input.value = text.substring(0, start) + emoji + text.substring(end);
    input.selectionStart = input.selectionEnd = start + emoji.length;
    input.focus();
    
    const picker = document.getElementById('messageEmojiPicker');
    if (picker) picker.style.display = 'none';
}

async function uploadFile(file) {
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
        alert('Пожалуйста, загружайте только изображения');
        return;
    }
    
    showUploadPreview('Загрузка изображения...');
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('/upload', { method: 'POST', body: formData });
        const data = await response.json();
        
        if (data.error) {
            alert('Ошибка: ' + data.error);
            hideUploadPreview();
            return;
        }
        
        const caption = prompt('Подпись к изображению (необязательно):');
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            const imageData = { type: 'image', url: data.url, caption: caption || '' };
            if (replyToMessage) {
                imageData.reply_to = replyToMessage;
                cancelReply();
            }
            ws.send(JSON.stringify(imageData));
        }
        
        hideUploadPreview();
    } catch (error) {
        console.error('Ошибка загрузки изображения:', error);
        alert('Ошибка загрузки изображения');
        hideUploadPreview();
    }
}

async function handlePaste(event) {
    const items = (event.clipboardData || event.originalEvent.clipboardData).items;
    for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
            event.preventDefault();
            const file = item.getAsFile();
            await uploadFile(file);
            break;
        }
    }
}

async function uploadImage() {
    const input = document.getElementById('imageInput');
    const file = input.files[0];
    if (!file) return;
    await uploadFile(file);
    input.value = '';
}

function openImageModal(imageUrl) {
    let modal = document.getElementById('imageModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'imageModal';
        modal.className = 'image-modal';
        modal.innerHTML = `
            <div class="image-modal-content">
                <span class="image-modal-close">&times;</span>
                <img class="image-modal-img" id="modalImage" src="">
            </div>
        `;
        document.body.appendChild(modal);
        
        modal.querySelector('.image-modal-close').onclick = () => modal.style.display = 'none';
        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.style.display === 'flex') modal.style.display = 'none'; });
    }
    
    const modalImg = modal.querySelector('#modalImage');
    modalImg.src = imageUrl;
    modal.style.display = 'flex';
}

function showUploadPreview(message) {
    let preview = document.getElementById('uploadPreview');
    if (!preview) {
        preview = document.createElement('div');
        preview.id = 'uploadPreview';
        preview.className = 'upload-preview';
        document.body.appendChild(preview);
    }
    preview.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${message}`;
    preview.style.display = 'block';
}

function hideUploadPreview() {
    const preview = document.getElementById('uploadPreview');
    if (preview) preview.style.display = 'none';
}

function handleKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function logout() {
    localStorage.removeItem('chat_user');
    localStorage.removeItem('chat_room');
    if (ws) ws.close();
    location.reload();
}

function playNotificationSound() {
    const audio = document.getElementById('notificationSound');
    if (audio) audio.play().catch(e => console.log('Звук не воспроизведён'));
}

function getUserColor(username) {
    const colors = ['#3a8c3a', '#4aac4a', '#5acc5a', '#2a6c2a', '#6adc6a', '#ff6b6b', '#ff8c42', '#ffd93d', '#6bcf7f', '#4d9de0', '#ff6ec7', '#9b59b6', '#3498db', '#e74c3c', '#f39c12', '#1abc9c', '#2ecc71', '#e67e22', '#e84393', '#00cec9'];
    let hash = 0;
    for (let i = 0; i < username.length; i++) hash = ((hash << 5) - hash) + username.charCodeAt(i);
    return colors[Math.abs(hash) % colors.length];
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

if (Notification.permission === 'default') Notification.requestPermission();
// ========== Управление комнатой ==========

async function showRoomSettings() {
    try {
        const response = await fetch(`/api/rooms/${currentRoom}/info`);
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('settingsRoomName').textContent = data.room.name;
            document.getElementById('settingsRoomCreator').textContent = data.room.creator;
            document.getElementById('settingsMemberCount').textContent = data.room.member_count;
            document.getElementById('settingsCreatedAt').textContent = new Date(data.room.created_at).toLocaleString();
            
            document.getElementById('roomSettingsModal').style.display = 'flex';
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch (error) {
        console.error('Ошибка получения информации о комнате:', error);
        alert('Не удалось загрузить информацию о комнате');
    }
}

function closeRoomSettings() {
    document.getElementById('roomSettingsModal').style.display = 'none';
}

function confirmDeleteRoom() {
    closeRoomSettings();
    document.getElementById('deleteRoomName').textContent = currentRoom;
    document.getElementById('confirmDeleteModal').style.display = 'flex';
}

function closeConfirmDelete() {
    document.getElementById('confirmDeleteModal').style.display = 'none';
}

async function deleteRoom() {
    closeConfirmDelete();
    
    try {
        const response = await fetch(`/api/rooms/${currentRoom}?username=${encodeURIComponent(currentUser)}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`Комната "${currentRoom}" успешно удалена`);
            
            if (ws) {
                ws.close();
                ws = null;
            }
            
            localStorage.removeItem('chat_room');
            
            document.getElementById('chatApp').style.display = 'none';
            document.getElementById('roomsScreen').style.display = 'flex';
            await loadRooms();
        } else {
            alert('Ошибка: ' + (data.error || 'Не удалось удалить комнату'));
        }
    } catch (error) {
        console.error('Ошибка удаления комнаты:', error);
        alert('Ошибка соединения с сервером');
    }
}

async function updateRoomInfo() {
    try {
        const response = await fetch(`/api/rooms/${currentRoom}/info`);
        const data = await response.json();
        
        if (data.success) {
            const roomCreatorSpan = document.getElementById('roomCreator');
            const settingsBtn = document.getElementById('roomSettingsBtn');
            
            if (roomCreatorSpan) {
                roomCreatorSpan.textContent = `создатель: ${data.room.creator}`;
            }
            
            // Показываем кнопку настроек ТОЛЬКО создателю
            if (settingsBtn && data.room.creator === currentUser) {
                settingsBtn.style.display = 'block';
            } else if (settingsBtn) {
                settingsBtn.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Ошибка обновления информации:', error);
    }
}

console.log('Скрипт загружен');