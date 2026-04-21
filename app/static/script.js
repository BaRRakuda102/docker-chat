let token = null;
let currentRoom = null;
let ws = null;
let currentUserId = null;

function showTab(tab) {
    if (tab === 'login') {
        document.getElementById('loginForm').style.display = 'flex';
        document.getElementById('registerForm').style.display = 'none';
        document.querySelector('.tab-btn.active').classList.remove('active');
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
    } else {
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('registerForm').style.display = 'flex';
        document.querySelector('.tab-btn.active').classList.remove('active');
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
    }
}

async function login() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    
    if (!username || !password) {
        document.getElementById('loginError').textContent = 'Введите имя пользователя и пароль';
        return;
    }
    
    // Формат для OAuth2 password flow
    const formData = new URLSearchParams();
    formData.append('grant_type', 'password');
    formData.append('username', username);
    formData.append('password', password);
    formData.append('scope', '');
    formData.append('client_id', '');
    formData.append('client_secret', '');
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData
        });
        
        if (response.ok) {
            const data = await response.json();
            token = data.access_token;
            localStorage.setItem('token', token);
            localStorage.setItem('username', username);
            document.getElementById('currentUser').textContent = username;
            document.getElementById('authContainer').style.display = 'none';
            document.getElementById('chatContainer').style.display = 'block';
            await loadRooms();
            await loadUserProfile();
        } else {
            const error = await response.json();
            document.getElementById('loginError').textContent = error.detail || 'Ошибка входа';
        }
    } catch (error) {
        console.error('Login error:', error);
        document.getElementById('loginError').textContent = 'Ошибка соединения с сервером';
    }
}

async function register() {
    const username = document.getElementById('regUsername').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    const displayName = document.getElementById('regDisplayName').value;
    const birthDate = document.getElementById('regBirthDate').value;
    
    if (!username || !email || !password) {
        document.getElementById('registerError').textContent = 'Заполните обязательные поля';
        return;
    }
    
    const data = {
        username: username,
        email: email,
        password: password
    };
    
    if (displayName) data.display_name = displayName;
    if (birthDate) data.birth_date = birthDate;
    
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            alert('Регистрация успешна! Теперь войдите.');
            // Очищаем форму
            document.getElementById('regUsername').value = '';
            document.getElementById('regEmail').value = '';
            document.getElementById('regPassword').value = '';
            document.getElementById('regDisplayName').value = '';
            document.getElementById('regBirthDate').value = '';
            showTab('login');
        } else {
            const error = await response.json();
            document.getElementById('registerError').textContent = error.detail || 'Ошибка регистрации';
        }
    } catch (error) {
        console.error('Register error:', error);
        document.getElementById('registerError').textContent = 'Ошибка соединения с сервером';
    }
}

async function loadUserProfile() {
    try {
        const response = await fetch('/api/user/profile', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const user = await response.json();
            currentUserId = user.id;
            // Можно отобразить аватар или другую информацию
        }
    } catch (error) {
        console.error('Error loading profile:', error);
    }
}

async function loadRooms() {
    try {
        const response = await fetch('/api/rooms', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const rooms = await response.json();
            const roomsList = document.getElementById('roomsList');
            roomsList.innerHTML = '';
            
            if (rooms.length === 0) {
                roomsList.innerHTML = '<p style="color: #666;">Нет созданных комнат</p>';
            }
            
            for (const room of rooms) {
                const roomDiv = document.createElement('div');
                roomDiv.className = 'room-item';
                roomDiv.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong>${escapeHtml(room.name)}</strong>
                        <div>
                            <button onclick="joinRoomPrompt('${escapeHtml(room.name)}')" style="background: #28a745; margin-right: 5px;">Войти</button>
                            <button onclick="deleteRoom('${escapeHtml(room.name)}')" style="background:#dc3545">Удалить</button>
                        </div>
                    </div>
                    <small style="color: #666;">Создана: ${new Date(room.created_at).toLocaleString()}</small>
                `;
                roomsList.appendChild(roomDiv);
            }
        } else if (response.status === 401) {
            logout();
        } else {
            console.error('Failed to load rooms:', response.status);
        }
    } catch (error) {
        console.error('Error loading rooms:', error);
    }
}

async function joinRoomPrompt(roomName) {
    const password = prompt(`Введите пароль для комнаты "${roomName}":`);
    if (password) {
        await joinRoom(roomName, password);
    }
}

async function joinRoom(roomName, password) {
    const formData = new URLSearchParams();
    formData.append('room_name', roomName);
    formData.append('password', password);
    
    try {
        const response = await fetch('/api/join_room', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData
        });
        
        if (response.ok) {
            currentRoom = roomName;
            document.getElementById('currentRoom').textContent = roomName;
            document.getElementById('chatPanel').style.display = 'flex';
            document.getElementById('messages').innerHTML = '';
            connectWebSocket();
        } else {
            const error = await response.json();
            alert(error.detail || 'Ошибка входа в комнату');
        }
    } catch (error) {
        console.error('Join room error:', error);
        alert('Ошибка соединения с сервером');
    }
}

async function createRoom() {
    const roomName = document.getElementById('newRoomName').value.trim();
    const password = document.getElementById('newRoomPassword').value;
    
    if (!roomName || !password) {
        alert('Введите название комнаты и пароль');
        return;
    }
    
    const formData = new URLSearchParams();
    formData.append('room_name', roomName);
    formData.append('password', password);
    
    try {
        const response = await fetch('/api/create_room', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData
        });
        
        if (response.ok) {
            alert(`Комната "${roomName}" создана!`);
            document.getElementById('newRoomName').value = '';
            document.getElementById('newRoomPassword').value = '';
            await loadRooms();
        } else {
            const error = await response.json();
            alert(error.detail || 'Ошибка создания комнаты');
        }
    } catch (error) {
        console.error('Create room error:', error);
        alert('Ошибка соединения с сервером');
    }
}

async function deleteRoom(roomName) {
    if (!confirm(`Вы уверены, что хотите удалить комнату "${roomName}"? Это действие нельзя отменить.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/delete_room/${encodeURIComponent(roomName)}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            alert('Комната удалена');
            if (currentRoom === roomName) {
                leaveRoom();
            }
            await loadRooms();
        } else {
            const error = await response.json();
            alert(error.detail || 'Ошибка удаления комнаты');
        }
    } catch (error) {
        console.error('Delete room error:', error);
        alert('Ошибка соединения с сервером');
    }
}

function leaveRoom() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
    currentRoom = null;
    document.getElementById('chatPanel').style.display = 'none';
    document.getElementById('messages').innerHTML = '';
}

function connectWebSocket() {
    const username = localStorage.getItem('username');
    
    if (!username || !currentRoom || !currentUserId) {
        console.error('Missing required data for WebSocket connection');
        return;
    }
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${encodeURIComponent(currentRoom)}/${encodeURIComponent(username)}/${currentUserId}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = function() {
        console.log('WebSocket connected');
    };
    
    ws.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            displayMessage(data);
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };
    
    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
    };
    
    ws.onclose = function() {
        console.log('WebSocket disconnected');
        if (currentRoom) {
            setTimeout(() => {
                if (currentRoom) {
                    console.log('Reconnecting WebSocket...');
                    connectWebSocket();
                }
            }, 3000);
        }
    };
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    
    if (message && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'message',
            message: message
        }));
        input.value = '';
    } else if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Соединение с сервером потеряно. Пожалуйста, перезайдите в комнату.');
    }
}

function displayMessage(data) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    const timestamp = data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    
    if (data.type === 'message') {
        messageDiv.innerHTML = `
            <strong>${escapeHtml(data.username)}</strong>
            <span style="color: #666; font-size: 11px; margin-left: 10px;">${timestamp}</span>
            <div style="margin-top: 5px;">${escapeHtml(data.message)}</div>
        `;
    } else if (data.type === 'user_joined') {
        messageDiv.innerHTML = `<em style="color: #28a745;">✨ ${escapeHtml(data.username)} присоединился к чату</em>`;
    } else if (data.type === 'user_left') {
        messageDiv.innerHTML = `<em style="color: #dc3545;">👋 ${escapeHtml(data.username)} покинул чат</em>`;
    } else if (data.type === 'history') {
        messageDiv.innerHTML = `
            <strong>${escapeHtml(data.username)}</strong>
            <span style="color: #666; font-size: 11px; margin-left: 10px;">${new Date(data.timestamp).toLocaleTimeString()}</span>
            <div style="margin-top: 5px;">${escapeHtml(data.message)}</div>
        `;
    }
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function logout() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    token = null;
    currentRoom = null;
    currentUserId = null;
    document.getElementById('authContainer').style.display = 'block';
    document.getElementById('chatContainer').style.display = 'none';
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('messages').innerHTML = '';
}

// Функция для экранирования HTML специальных символов
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Обработчик отправки сообщения по Enter
document.addEventListener('DOMContentLoaded', function() {
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }
    
    // Проверяем, есть ли сохраненный токен
    const savedToken = localStorage.getItem('token');
    const savedUsername = localStorage.getItem('username');
    if (savedToken && savedUsername) {
        token = savedToken;
        document.getElementById('currentUser').textContent = savedUsername;
        document.getElementById('authContainer').style.display = 'none';
        document.getElementById('chatContainer').style.display = 'block';
        loadRooms();
        loadUserProfile();
    }
});

// Функция для загрузки аватара (опционально)
async function uploadAvatar(file) {
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('/api/user/upload_avatar', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('Avatar uploaded:', data.avatar_url);
            return data.avatar_url;
        }
    } catch (error) {
        console.error('Upload avatar error:', error);
    }
    return null;
}