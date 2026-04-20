// ========== ПЕРЕМЕННЫЕ ==========
let ws = null;
let currentUser = '';
let currentRoom = '';
let roomsList = [];
let pendingUserId = null;
let currentRoomId = null;
let isRoomCreator = false;
let isJoining = false;

// ========== ПЕРЕКЛЮЧЕНИЕ ФОРМ ==========
function showRegisterForm() {
    document.getElementById('loginFormContainer').style.display = 'none';
    document.getElementById('registerFormContainer').style.display = 'block';
    document.getElementById('verifyFormContainer').style.display = 'none';
}

function showLoginForm() {
    document.getElementById('loginFormContainer').style.display = 'block';
    document.getElementById('registerFormContainer').style.display = 'none';
    document.getElementById('verifyFormContainer').style.display = 'none';
}

// ========== РЕГИСТРАЦИЯ ==========
async function doRegister() {
    const username = document.getElementById('regUsername').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regPasswordConfirm').value;
    const msgDiv = document.getElementById('registerMessage');
    
    if (!username || !email || !password) {
        msgDiv.innerHTML = '<span style="color:#ff6b6b;">Заполните все поля</span>';
        return;
    }
    if (password !== confirm) {
        msgDiv.innerHTML = '<span style="color:#ff6b6b;">Пароли не совпадают</span>';
        return;
    }
    if (password.length < 6) {
        msgDiv.innerHTML = '<span style="color:#ff6b6b;">Пароль должен быть не менее 6 символов</span>';
        return;
    }
    
    msgDiv.innerHTML = '<span style="color:#4aac4a;">Регистрация...</span>';
    
    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        const data = await res.json();
        
        if (data.success) {
            localStorage.setItem('chat_token', data.token);
            localStorage.setItem('chat_username', data.username);
            currentUser = data.username;
            
            msgDiv.innerHTML = '<span style="color:#4aac4a;">✅ Регистрация успешна!</span>';
            
            setTimeout(() => {
                document.getElementById('authContainer').style.display = 'none';
                document.getElementById('roomsContainer').style.display = 'block';
                document.getElementById('userNameDisplay').innerHTML = currentUser;
                loadRooms();
                loadUserProfile();
            }, 1000);
        } else {
            msgDiv.innerHTML = '<span style="color:#ff6b6b;">❌ ' + data.error + '</span>';
        }
    } catch(e) {
        msgDiv.innerHTML = '<span style="color:#ff6b6b;">❌ Ошибка: ' + e.message + '</span>';
    }
}

// ========== ВХОД ==========
async function doLogin() {
    console.log('doLogin вызвана');
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const msgDiv = document.getElementById('loginMessage');
    
    if (!username || !password) {
        msgDiv.innerHTML = '<span style="color:#ff6b6b;">Введите имя и пароль</span>';
        return;
    }
    
    msgDiv.innerHTML = '<span style="color:#4aac4a;">Вход...</span>';
    
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        console.log('Ответ сервера:', data);
        
        if (data.success) {
            currentUser = data.username;
            localStorage.setItem('chat_token', data.token);
            localStorage.setItem('chat_username', currentUser);
            
            document.getElementById('authContainer').style.display = 'none';
            document.getElementById('roomsContainer').style.display = 'block';
            document.getElementById('userNameDisplay').innerHTML = currentUser;
            loadRooms();
            loadUserProfile();
        } else {
            msgDiv.innerHTML = '<span style="color:#ff6b6b;">❌ ' + data.error + '</span>';
        }
    } catch(e) {
        console.error('Ошибка:', e);
        msgDiv.innerHTML = '<span style="color:#ff6b6b;">❌ Ошибка: ' + e.message + '</span>';
    }
}

// ========== ПРОФИЛЬ ==========
function toggleProfileMenu() {
    const dropdown = document.getElementById('profileDropdown');
    dropdown.classList.toggle('show');
}

document.addEventListener('click', function(event) {
    const dropdown = document.getElementById('profileDropdown');
    const userInfo = document.querySelector('.user-info');
    if (dropdown && userInfo && !userInfo.contains(event.target) && !dropdown.contains(event.target)) {
        dropdown.classList.remove('show');
    }
});

function calculateAge(birthDate) {
    if (!birthDate) return null;
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return age;
}

async function loadUserProfile() {
    try {
        const res = await fetch(`/api/user/profile?username=${encodeURIComponent(currentUser)}`);
        const data = await res.json();
        if (data.success) {
            document.getElementById('profileUsername').innerHTML = data.username;
            document.getElementById('profileEmail').innerHTML = data.email;
            document.getElementById('displayName').innerHTML = data.display_name || data.username;
            if (data.birth_date) {
                const age = calculateAge(data.birth_date);
                document.getElementById('userAge').innerHTML = `${age} лет (${data.birth_date})`;
            } else {
                document.getElementById('userAge').innerHTML = 'Не указан';
            }
            document.getElementById('regDate').innerHTML = new Date(data.created_at).toLocaleDateString();
            if (data.avatar_url) {
                updateAvatarDisplay(data.avatar_url);
            }
        }
    } catch(e) {
        console.error('Ошибка загрузки профиля:', e);
    }
}

function showEditProfileModal() {
    document.getElementById('editProfileModal').style.display = 'flex';
    document.getElementById('editDisplayName').value = document.getElementById('displayName').innerHTML;
    document.getElementById('editBirthDate').value = '';
}

function closeEditProfileModal() {
    document.getElementById('editProfileModal').style.display = 'none';
}

async function saveProfile() {
    const displayName = document.getElementById('editDisplayName').value.trim();
    const birthDate = document.getElementById('editBirthDate').value;
    
    try {
        const res = await fetch('/api/user/update_profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser, display_name: displayName, birth_date: birthDate })
        });
        const data = await res.json();
        if (data.success) {
            alert('Профиль обновлён!');
            closeEditProfileModal();
            loadUserProfile();
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch(e) {
        alert('Ошибка: ' + e.message);
    }
}

// ========== АВАТАР ==========
async function uploadAvatar(file) {
    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('username', currentUser);
    
    try {
        const res = await fetch('/api/user/upload_avatar', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            updateAvatarDisplay(data.avatar_url + '?t=' + Date.now());
            alert('Аватар обновлён!');
            loadUserProfile();
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch(e) {
        console.error('Ошибка загрузки аватара:', e);
        alert('Ошибка загрузки аватара');
    }
}

function updateAvatarDisplay(avatarUrl) {
    const smallAvatar = document.getElementById('userAvatarSmall');
    const largeAvatar = document.getElementById('userAvatarLarge');
    const chatAvatar = document.getElementById('chatUserAvatar');
    const editPreview = document.getElementById('editAvatarPreview');
    
    if (smallAvatar) smallAvatar.src = avatarUrl;
    if (largeAvatar) largeAvatar.src = avatarUrl;
    if (chatAvatar) chatAvatar.src = avatarUrl;
    if (editPreview) editPreview.src = avatarUrl;
}

document.getElementById('avatarInput')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        if (file.size > 5 * 1024 * 1024) {
            alert('Файл слишком большой. Максимальный размер 5MB');
            return;
        }
        if (!file.type.startsWith('image/')) {
            alert('Пожалуйста, выберите изображение');
            return;
        }
        const reader = new FileReader();
        reader.onload = function(event) {
            const editPreview = document.getElementById('editAvatarPreview');
            if (editPreview) editPreview.src = event.target.result;
        };
        reader.readAsDataURL(file);
        uploadAvatar(file);
    }
});

// ========== КОМНАТЫ ==========
async function loadRooms() {
    try {
        const res = await fetch('/api/rooms');
        const data = await res.json();
        if (data.success) {
            roomsList = data.rooms;
            renderRooms();
        }
    } catch(e) {
        console.error('Ошибка загрузки комнат:', e);
        roomsList = [];
        renderRooms();
    }
}

function renderRooms() {
    const container = document.getElementById('roomsList');
    if (!container) return;
    if (roomsList.length === 0) {
        container.innerHTML = '<div class="empty-rooms"><i class="fas fa-comment-slash"></i><p>Нет комнат</p><small>Создайте первую комнату</small></div>';
    } else {
        container.innerHTML = roomsList.map(room => `
            <div class="room-card" onclick="promptJoinRoom('${room.name}')">
                <div class="room-icon"><i class="fas fa-lock"></i></div>
                <div class="room-details">
                    <h4>${escapeHtml(room.name)}</h4>
                    <p>Создал: ${escapeHtml(room.creator)}</p>
                </div>
            </div>
        `).join('');
    }
}

function filterRooms() {
    const searchTerm = document.getElementById('searchRoomsInput').value.toLowerCase();
    const roomCards = document.querySelectorAll('.room-card');
    roomCards.forEach(card => {
        const roomName = card.querySelector('h4').innerText.toLowerCase();
        card.style.display = roomName.includes(searchTerm) ? 'flex' : 'none';
    });
}

function showCreateRoomModal() {
    document.getElementById('createRoomModal').style.display = 'flex';
    document.getElementById('newRoomName').value = '';
    document.getElementById('newRoomPassword').value = '';
}

function closeCreateRoomModal() {
    document.getElementById('createRoomModal').style.display = 'none';
}

async function createNewRoom() {
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
    try {
        const res = await fetch('/api/create_room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, password, creator: currentUser })
        });
        const data = await res.json();
        if (data.success) {
            alert('Комната создана!');
            closeCreateRoomModal();
            loadRooms();
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch(e) {
        alert('Ошибка: ' + e.message);
    }
}

let pendingRoom = '';
let pendingRoomPassword = null;

function promptJoinRoom(roomName, presetPassword = null) {
    if (isJoining) return;
    pendingRoom = roomName;
    pendingRoomPassword = presetPassword;
    
    if (presetPassword) {
        joinSelectedRoom();
    } else {
        document.getElementById('joinRoomNameText').innerHTML = 'Комната: ' + roomName;
        document.getElementById('joinRoomModal').style.display = 'flex';
        document.getElementById('roomPassword').value = '';
    }
}

function closeJoinRoomModal() {
    document.getElementById('joinRoomModal').style.display = 'none';
}

async function joinSelectedRoom() {
    if (isJoining) return;
    
    let password = pendingRoomPassword;
    if (!password) {
        password = document.getElementById('roomPassword').value;
    }
    
    if (!password) {
        alert('Введите пароль');
        return;
    }
    
    isJoining = true;
    
    try {
        const res = await fetch('/api/join_room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room: pendingRoom, password: password })
        });
        const data = await res.json();
        
        if (data.success) {
            closeJoinRoomModal();
            currentRoom = pendingRoom;
            document.getElementById('roomsContainer').style.display = 'none';
            document.getElementById('chatContainer').style.display = 'flex';
            document.getElementById('chatRoomName').innerHTML = `# ${currentRoom}`;
            document.getElementById('chatRoomTitle').innerHTML = currentRoom;
            document.getElementById('chatCurrentUser').innerHTML = currentUser;
            document.getElementById('chatMessages').innerHTML = '';
            await updateRoomInfo();
            connectWebSocket();
            
            localStorage.removeItem('join_room');
            localStorage.removeItem('auto_join_room');
            localStorage.removeItem('auto_join_password');
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch(e) {
        alert('Ошибка: ' + e.message);
    } finally {
        isJoining = false;
        pendingRoomPassword = null;
    }
}

function leaveToRooms() {
    if (ws) ws.close();
    document.getElementById('chatContainer').style.display = 'none';
    document.getElementById('roomsContainer').style.display = 'block';
    loadRooms();
}

// ========== ПРИГЛАШЕНИЯ ==========
async function updateRoomInfo() {
    try {
        const response = await fetch(`/api/rooms/${currentRoom}/info`);
        const data = await response.json();
        if (data.success) {
            currentRoomId = data.room.id;
            isRoomCreator = (data.room.creator === currentUser);
            const settingsBtn = document.getElementById('roomSettingsBtn');
            if (settingsBtn) settingsBtn.style.display = isRoomCreator ? 'flex' : 'none';
        }
    } catch (error) {
        console.error('Ошибка обновления информации:', error);
    }
}

function showInviteModal() {
    const inviteLink = `${window.location.origin}/join/${currentRoomId}`;
    document.getElementById('inviteLinkInput').value = inviteLink;
    document.getElementById('inviteModal').style.display = 'flex';
}

function closeInviteModal() {
    document.getElementById('inviteModal').style.display = 'none';
}

function copyInviteLink() {
    const input = document.getElementById('inviteLinkInput');
    input.select();
    document.execCommand('copy');
    alert('Ссылка скопирована!');
}

// ========== УПРАВЛЕНИЕ КОМНАТОЙ ==========
async function showRoomSettings() {
    try {
        const response = await fetch(`/api/rooms/${currentRoom}/info`);
        const data = await response.json();
        if (data.success) {
            document.getElementById('settingsRoomName').textContent = data.room.name;
            document.getElementById('settingsRoomCreator').textContent = data.room.creator;
            document.getElementById('settingsMemberCount').textContent = data.room.member_count;
            document.getElementById('settingsRoomId').textContent = data.room.id;
            await loadRoomMembers();
            const deleteSection = document.getElementById('deleteRoomSection');
            if (deleteSection) deleteSection.style.display = isRoomCreator ? 'block' : 'none';
            document.getElementById('roomSettingsModal').style.display = 'flex';
        }
    } catch (error) {
        alert('Не удалось загрузить информацию о комнате');
    }
}

function closeRoomSettings() {
    document.getElementById('roomSettingsModal').style.display = 'none';
}

async function loadRoomMembers() {
    try {
        const response = await fetch(`/api/rooms/${currentRoom}/members`);
        const data = await response.json();
        if (data.success && data.members) {
            const membersList = document.getElementById('roomMembersList');
            membersList.innerHTML = data.members.map(member => `
                <div class="member-item">
                    <span class="member-name">${escapeHtml(member)} ${member === currentUser ? '(Вы)' : ''}</span>
                    ${member !== currentUser && isRoomCreator ? `<button onclick="kickUser('${member}')" class="kick-btn">Выгнать</button>` : ''}
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Ошибка загрузки участников:', error);
    }
}

async function renameRoom() {
    const newName = document.getElementById('editRoomName').value.trim();
    if (!newName || newName.length < 3) {
        alert('Введите корректное название (минимум 3 символа)');
        return;
    }
    try {
        const response = await fetch('/api/rooms/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_name: currentRoom, new_name: newName, username: currentUser })
        });
        const data = await response.json();
        if (data.success) {
            alert('Название комнаты изменено!');
            currentRoom = newName;
            document.getElementById('chatRoomName').innerHTML = `# ${currentRoom}`;
            document.getElementById('chatRoomTitle').innerHTML = currentRoom;
            closeRoomSettings();
            loadRooms();
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch (error) {
        alert('Ошибка соединения с сервером');
    }
}

async function kickUser(username) {
    if (!confirm(`Выгнать пользователя ${username} из комнаты?`)) return;
    try {
        const response = await fetch('/api/rooms/kick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_name: currentRoom, username: username, admin: currentUser })
        });
        const data = await response.json();
        if (data.success) {
            alert(`Пользователь ${username} выгнан из комнаты`);
            await loadRoomMembers();
            await updateRoomInfo();
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch (error) {
        alert('Ошибка соединения с сервером');
    }
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
        const response = await fetch(`/api/rooms/delete/${currentRoom}?username=${encodeURIComponent(currentUser)}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            alert(`Комната "${currentRoom}" успешно удалена`);
            if (ws) ws.close();
            document.getElementById('chatContainer').style.display = 'none';
            document.getElementById('roomsContainer').style.display = 'block';
            await loadRooms();
        } else {
            alert('Ошибка: ' + (data.error || 'Не удалось удалить комнату'));
        }
    } catch (error) {
        alert('Ошибка соединения с сервером');
    }
}

// ========== ОТПРАВКА ФАЙЛОВ ==========
async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    try {
        const res = await fetch('/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.url) {
            if (file.type.startsWith('image/')) {
                ws.send(JSON.stringify({ type: 'image', url: data.url, caption: '' }));
            } else {
                ws.send(JSON.stringify({ type: 'file', url: data.url, filename: file.name, size: file.size }));
            }
        }
    } catch(e) {
        console.error('Ошибка загрузки файла:', e);
    }
}

// ========== ПРОСМОТР ИЗОБРАЖЕНИЙ ==========
function openImageViewer(imageUrl) {
    const modal = document.getElementById('imageViewerModal');
    const img = document.getElementById('viewerImage');
    img.src = imageUrl;
    modal.style.display = 'flex';
}

function closeImageViewer() {
    document.getElementById('imageViewerModal').style.display = 'none';
}

// ========== ЧАТ ==========
function connectWebSocket() {
    // Правильное определение протокола для HTTPS
    let protocol = 'ws:';
    if (window.location.protocol === 'https:') {
        protocol = 'wss:';
    }
    const wsUrl = `${protocol}//${window.location.host}/ws/${currentRoom}/${currentUser}/ws_${Date.now()}`;
    console.log('WebSocket URL:', wsUrl);
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket подключен');
        document.getElementById('chatInput').disabled = false;
        document.getElementById('chatInput').focus();
    };
    
    ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const messagesDiv = document.getElementById('chatMessages');
    
    // Обработка обновления списка комнат
    if (data.type === 'room_list_update') {
        if (data.action === 'delete') {
            roomsList = roomsList.filter(r => r.name !== data.room_name);
            renderRooms();
            if (currentRoom === data.room_name) {
                alert(`Комната "${data.room_name}" была удалена создателем`);
                leaveToRooms();
            }
        }
        return;
    }
    
    if (data.type === 'message') {
        const isOwn = (data.username === currentUser);
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${isOwn ? 'own' : 'other'}`;
        msgDiv.innerHTML = `
            <div class="chat-message-header">
                <span style="color: ${isOwn ? '#4aac4a' : '#ff8c42'}; cursor: pointer;" onclick="showUserContextMenu(event, '${data.username}')">${escapeHtml(data.username)}</span>
                <span>${data.timestamp}</span>
            </div>
            <div class="chat-message-text">${escapeHtml(data.message)}</div>
        `;
        messagesDiv.appendChild(msgDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        if (data.username !== currentUser) playNotificationSound();
    } else if (data.type === 'image') {
        const isOwn = (data.username === currentUser);
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${isOwn ? 'own' : 'other'}`;
        msgDiv.innerHTML = `
            <div class="chat-message-header">
                <span style="color: ${isOwn ? '#4aac4a' : '#ff8c42'}">${escapeHtml(data.username)}</span>
                <span>${data.timestamp}</span>
            </div>
            <img src="${data.url}" class="chat-image" onclick="openImageViewer('${data.url}')">
            ${data.caption ? `<div class="image-caption">${escapeHtml(data.caption)}</div>` : ''}
        `;
        messagesDiv.appendChild(msgDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    } else if (data.type === 'system') {
        const sysDiv = document.createElement('div');
        sysDiv.className = 'system-message';
        sysDiv.innerHTML = data.message;
        messagesDiv.appendChild(sysDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    } else if (data.type === 'users') {
        document.getElementById('chatUserCount').innerHTML = data.count;
    } else if (data.type === 'kicked') {
        alert(data.message);
        leaveToRooms();
    } else if (data.type === 'room_deleted') {
        alert(data.message);
        leaveToRooms();
    }
};
    
    ws.onerror = (error) => console.error('WebSocket ошибка:', error);
    ws.onclose = () => console.log('WebSocket отключен');
}

function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'message', message }));
    input.value = '';
}

function showUserContextMenu(event, username) {
    event.stopPropagation();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.position = 'fixed';
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';
    menu.style.backgroundColor = '#0d1f0d';
    menu.style.border = '1px solid #4aac4a';
    menu.style.borderRadius = '12px';
    menu.style.padding = '8px 0';
    menu.style.zIndex = '1000';
    menu.innerHTML = `
        <div style="padding: 8px 16px; cursor: pointer; color: white;" onclick="viewUserProfile('${username}'); this.parentElement.remove();">👤 Профиль</div>
        <div style="padding: 8px 16px; cursor: pointer; color: white;" onclick="mentionUser('${username}'); this.parentElement.remove();">@ Отметить</div>
        <div style="padding: 8px 16px; cursor: pointer; color: white;" onclick="startPrivateChat('${username}'); this.parentElement.remove();">🔒 Написать лично</div>
    `;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', function closeMenu(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu); } }), 10);
}

function viewUserProfile(username) { alert(`Профиль пользователя ${username}`); }
function mentionUser(username) {
    const input = document.getElementById('chatInput');
    if (input) input.value += `@${username} `;
}
async function startPrivateChat(username) { alert(`Личный чат с ${username} (в разработке)`); }

document.getElementById('chatInput')?.addEventListener('paste', function(e) {
    const items = e.clipboardData.items;
    for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
            const file = item.getAsFile();
            uploadFile(file);
            break;
        }
    }
});

document.getElementById('fileInput')?.addEventListener('change', function(e) {
    const files = e.target.files;
    for (const file of files) uploadFile(file);
    this.value = '';
});

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function playNotificationSound() {
    const audio = document.getElementById('notificationSound');
    if (audio) audio.play().catch(e => console.log('Звук не воспроизведён'));
}

function logout() {
    localStorage.clear();
    location.reload();
}

// Проверка сохранённой сессии
const savedToken = localStorage.getItem('chat_token');
const savedUser = localStorage.getItem('chat_username');
if (savedToken && savedUser) {
    currentUser = savedUser;
    document.getElementById('authContainer').style.display = 'none';
    document.getElementById('roomsContainer').style.display = 'block';
    document.getElementById('userNameDisplay').innerHTML = currentUser;
    loadRooms();
    loadUserProfile();
}

// Проверка приглашения
const joinRoomFromInvite = localStorage.getItem('join_room');
if (joinRoomFromInvite && !currentRoom) {
    localStorage.removeItem('join_room');
    setTimeout(() => promptJoinRoom(joinRoomFromInvite), 500);
}

// Автоматический вход в комнату после приглашения
const autoJoinRoom = localStorage.getItem('auto_join_room');
const autoJoinPassword = localStorage.getItem('auto_join_password');
if (autoJoinRoom && autoJoinPassword && !currentRoom) {
    localStorage.removeItem('auto_join_room');
    localStorage.removeItem('auto_join_password');
    setTimeout(() => {
        promptJoinRoom(autoJoinRoom, autoJoinPassword);
    }, 1000);
}

console.log('Script loaded successfully');