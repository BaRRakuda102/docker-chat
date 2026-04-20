// ========== ОСНОВНЫЕ ПЕРЕМЕННЫЕ ==========
let ws = null;
let currentUser = '';
let currentRoom = '';
let roomsList = [];
let pendingUserId = null;
let currentRoomId = null;
let isRoomCreator = false;
let isJoining = false;
let pendingRoom = '';
let pendingRoomPassword = null;
let pendingImageFile = null;

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showMessage(elementId, text, isError = false) {
    const el = document.getElementById(elementId);
    if (el) {
        el.innerHTML = `<span style="color: ${isError ? '#ff6b6b' : '#4aac4a'}">${text}</span>`;
        setTimeout(() => { if (el.innerHTML === `<span style="color: ${isError ? '#ff6b6b' : '#4aac4a'}">${text}</span>`) el.innerHTML = ''; }, 3000);
    }
}

// ========== УПРАВЛЕНИЕ ФОРМАМИ ==========
function showRegisterForm() {
    document.getElementById('loginFormContainer').style.display = 'none';
    document.getElementById('registerFormContainer').style.display = 'block';
}

function showLoginForm() {
    document.getElementById('loginFormContainer').style.display = 'block';
    document.getElementById('registerFormContainer').style.display = 'none';
}

// ========== РЕГИСТРАЦИЯ ==========
async function doRegister() {
    const username = document.getElementById('regUsername').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regPasswordConfirm').value;
    
    if (!username || !email || !password) return showMessage('registerMessage', 'Заполните все поля', true);
    if (password !== confirm) return showMessage('registerMessage', 'Пароли не совпадают', true);
    if (password.length < 6) return showMessage('registerMessage', 'Пароль должен быть не менее 6 символов', true);
    
    showMessage('registerMessage', 'Регистрация...');
    
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
            showMessage('registerMessage', '✅ Регистрация успешна!');
            setTimeout(() => {
                document.getElementById('authContainer').style.display = 'none';
                document.getElementById('roomsContainer').style.display = 'block';
                document.getElementById('userNameDisplay').innerHTML = currentUser;
                loadRooms();
                loadUserProfile();
            }, 1000);
        } else {
            showMessage('registerMessage', '❌ ' + data.error, true);
        }
    } catch(e) {
        showMessage('registerMessage', '❌ Ошибка: ' + e.message, true);
    }
}

// ========== ВХОД ==========
async function doLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!username || !password) return showMessage('loginMessage', 'Введите имя и пароль', true);
    
    showMessage('loginMessage', 'Вход...');
    
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        
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
            showMessage('loginMessage', '❌ ' + data.error, true);
        }
    } catch(e) {
        showMessage('loginMessage', '❌ Ошибка: ' + e.message, true);
    }
}

// ========== ПРОФИЛЬ ==========
function toggleProfileMenu() {
    document.getElementById('profileDropdown')?.classList.toggle('show');
}

document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('profileDropdown');
    const userInfo = document.querySelector('.user-info');
    if (dropdown && userInfo && !userInfo.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('show');
    }
});

async function loadUserProfile() {
    try {
        const res = await fetch(`/api/user/profile?username=${encodeURIComponent(currentUser)}`);
        const data = await res.json();
        if (data.success) {
            document.getElementById('profileUsername').innerHTML = data.username;
            document.getElementById('profileEmail').innerHTML = data.email;
            document.getElementById('displayName').innerHTML = data.display_name || data.username;
            document.getElementById('userAge').innerHTML = data.birth_date ? `${calculateAge(data.birth_date)} лет (${data.birth_date})` : 'Не указан';
            document.getElementById('regDate').innerHTML = new Date(data.created_at).toLocaleDateString();
            if (data.avatar_url) updateAvatarDisplay(data.avatar_url);
        }
    } catch(e) { console.error(e); }
}

function calculateAge(birthDate) {
    if (!birthDate) return null;
    const today = new Date(), birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
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
        } else alert('Ошибка: ' + data.error);
    } catch(e) { alert('Ошибка: ' + e.message); }
}

// ========== АВАТАР ==========
async function uploadAvatar(file) {
    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('username', currentUser);
    try {
        const res = await fetch('/api/user/upload_avatar', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            updateAvatarDisplay(data.avatar_url + '?t=' + Date.now());
            alert('Аватар обновлён!');
            loadUserProfile();
        } else alert('Ошибка: ' + data.error);
    } catch(e) { alert('Ошибка загрузки аватара'); }
}

function updateAvatarDisplay(avatarUrl) {
    ['userAvatarSmall', 'userAvatarLarge', 'chatUserAvatar', 'editAvatarPreview'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.src = avatarUrl;
    });
}

document.getElementById('avatarInput')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/') && file.size <= 5 * 1024 * 1024) {
        const reader = new FileReader();
        reader.onload = event => { document.getElementById('editAvatarPreview').src = event.target.result; };
        reader.readAsDataURL(file);
        uploadAvatar(file);
    } else alert('Файл должен быть изображением до 5MB');
});

// ========== КОМНАТЫ ==========
async function loadRooms() {
    try {
        const res = await fetch('/api/rooms');
        const data = await res.json();
        roomsList = data.success ? data.rooms : [];
        renderRooms();
    } catch(e) { roomsList = []; renderRooms(); }
}

function renderRooms() {
    const container = document.getElementById('roomsList');
    if (!container) return;
    if (!roomsList.length) {
        container.innerHTML = '<div class="empty-rooms"><i class="fas fa-comment-slash"></i><p>Нет комнат</p><small>Создайте первую комнату</small></div>';
    } else {
        container.innerHTML = roomsList.map(room => `
            <div class="room-card" onclick="promptJoinRoom('${room.name}')">
                <div class="room-icon"><i class="fas fa-lock"></i></div>
                <div class="room-details"><h4>${escapeHtml(room.name)}</h4><p>Создал: ${escapeHtml(room.creator)}</p></div>
            </div>
        `).join('');
    }
}

function filterRooms() {
    const term = document.getElementById('searchRoomsInput').value.toLowerCase();
    document.querySelectorAll('.room-card').forEach(card => {
        card.style.display = card.querySelector('h4').innerText.toLowerCase().includes(term) ? 'flex' : 'none';
    });
}

function showCreateRoomModal() {
    document.getElementById('createRoomModal').style.display = 'flex';
    document.getElementById('newRoomName').value = '';
    document.getElementById('newRoomPassword').value = '';
}

function closeCreateRoomModal() { document.getElementById('createRoomModal').style.display = 'none'; }

async function createNewRoom() {
    const name = document.getElementById('newRoomName').value.trim();
    const password = document.getElementById('newRoomPassword').value;
    if (!name || !password) return alert('Заполните все поля');
    if (name.length < 3) return alert('Название не менее 3 символов');
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
        } else alert('Ошибка: ' + data.error);
    } catch(e) { alert('Ошибка: ' + e.message); }
}

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

function closeJoinRoomModal() { document.getElementById('joinRoomModal').style.display = 'none'; }

async function joinSelectedRoom() {
    if (isJoining) return;
    const password = pendingRoomPassword || document.getElementById('roomPassword').value;
    if (!password) return alert('Введите пароль');
    
    isJoining = true;
    try {
        const res = await fetch('/api/join_room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room: pendingRoom, password })
        });
        const data = await res.json();
        if (data.success) {
            closeJoinRoomModal();
            currentRoom = pendingRoom;
            localStorage.setItem('current_room', currentRoom);
            document.getElementById('roomsContainer').style.display = 'none';
            document.getElementById('chatContainer').style.display = 'flex';
            document.getElementById('chatRoomName').innerHTML = `# ${currentRoom}`;
            document.getElementById('chatRoomTitle').innerHTML = currentRoom;
            document.getElementById('chatCurrentUser').innerHTML = currentUser;
            document.getElementById('chatMessages').innerHTML = '';
            await updateRoomInfo();
            connectWebSocket();
            localStorage.removeItem('join_room');
        } else alert('Ошибка: ' + data.error);
    } catch(e) { alert('Ошибка: ' + e.message); }
    finally { isJoining = false; pendingRoomPassword = null; }
}

function leaveToRooms() {
    if (ws) ws.close();
    localStorage.removeItem('current_room');
    document.getElementById('chatContainer').style.display = 'none';
    document.getElementById('roomsContainer').style.display = 'block';
    loadRooms();
}

// ========== ПРИГЛАШЕНИЯ ==========
async function updateRoomInfo() {
    try {
        const res = await fetch(`/api/rooms/${currentRoom}/info`);
        const data = await res.json();
        if (data.success) {
            currentRoomId = data.room.id;
            isRoomCreator = (data.room.creator === currentUser);
            const btn = document.getElementById('roomSettingsBtn');
            if (btn) btn.style.display = isRoomCreator ? 'flex' : 'none';
        }
    } catch(e) { console.error(e); }
}

function showInviteModal() {
    document.getElementById('inviteLinkInput').value = `${window.location.origin}/join/${currentRoomId}`;
    document.getElementById('inviteModal').style.display = 'flex';
}

function closeInviteModal() { document.getElementById('inviteModal').style.display = 'none'; }
function copyInviteLink() {
    const input = document.getElementById('inviteLinkInput');
    input.select();
    document.execCommand('copy');
    alert('Ссылка скопирована!');
}

// ========== НАСТРОЙКИ КОМНАТЫ ==========
async function showRoomSettings() {
    try {
        const res = await fetch(`/api/rooms/${currentRoom}/info`);
        const data = await res.json();
        if (data.success) {
            document.getElementById('settingsRoomName').textContent = data.room.name;
            document.getElementById('settingsRoomCreator').textContent = data.room.creator;
            document.getElementById('settingsMemberCount').textContent = data.room.member_count;
            document.getElementById('settingsRoomId').textContent = data.room.id;
            await loadRoomMembers();
            document.getElementById('deleteRoomSection').style.display = isRoomCreator ? 'block' : 'none';
            document.getElementById('roomSettingsModal').style.display = 'flex';
        }
    } catch(e) { alert('Не удалось загрузить информацию'); }
}

function closeRoomSettings() { document.getElementById('roomSettingsModal').style.display = 'none'; }

async function loadRoomMembers() {
    try {
        const res = await fetch(`/api/rooms/${currentRoom}/members`);
        const data = await res.json();
        const container = document.getElementById('roomMembersList');
        if (container && data.success) {
            container.innerHTML = data.members.map(m => `
                <div class="member-item">
                    <span class="member-name">${escapeHtml(m)} ${m === currentUser ? '(Вы)' : ''}</span>
                    ${m !== currentUser && isRoomCreator ? `<button onclick="kickUser('${m}')" class="kick-btn">Выгнать</button>` : ''}
                </div>
            `).join('');
        }
    } catch(e) { console.error(e); }
}

async function renameRoom() {
    const newName = document.getElementById('editRoomName').value.trim();
    if (!newName || newName.length < 3) return alert('Название не менее 3 символов');
    try {
        const res = await fetch('/api/rooms/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_name: currentRoom, new_name: newName, username: currentUser })
        });
        const data = await res.json();
        if (data.success) {
            alert('Название изменено!');
            currentRoom = newName;
            document.getElementById('chatRoomName').innerHTML = `# ${currentRoom}`;
            document.getElementById('chatRoomTitle').innerHTML = currentRoom;
            closeRoomSettings();
            loadRooms();
        } else alert('Ошибка: ' + data.error);
    } catch(e) { alert('Ошибка соединения'); }
}

async function kickUser(username) {
    if (!confirm(`Выгнать ${username}?`)) return;
    try {
        const res = await fetch('/api/rooms/kick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_name: currentRoom, username, admin: currentUser })
        });
        const data = await res.json();
        if (data.success) {
            alert(`Пользователь ${username} выгнан`);
            await loadRoomMembers();
            await updateRoomInfo();
        } else alert('Ошибка: ' + data.error);
    } catch(e) { alert('Ошибка соединения'); }
}

function confirmDeleteRoom() {
    closeRoomSettings();
    document.getElementById('deleteRoomName').textContent = currentRoom;
    document.getElementById('confirmDeleteModal').style.display = 'flex';
}

function closeConfirmDelete() { document.getElementById('confirmDeleteModal').style.display = 'none'; }

async function deleteRoom() {
    closeConfirmDelete();
    try {
        const res = await fetch(`/api/rooms/delete/${currentRoom}?username=${encodeURIComponent(currentUser)}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            alert(`Комната "${currentRoom}" удалена`);
            if (ws) ws.close();
            localStorage.removeItem('current_room');
            document.getElementById('chatContainer').style.display = 'none';
            document.getElementById('roomsContainer').style.display = 'block';
            await loadRooms();
        } else alert('Ошибка: ' + (data.error || 'Не удалось удалить'));
    } catch(e) { alert('Ошибка соединения'); }
}

// ========== ПРЕДПРОСМОТР ИЗОБРАЖЕНИЙ ==========
function showImagePreview(file) {
    let modal = document.getElementById('imagePreviewModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'imagePreviewModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:500px; text-align:center">
                <div class="modal-header"><h3>Предпросмотр</h3><button onclick="closeImagePreview()" class="close-btn">&times;</button></div>
                <img id="previewImage" style="max-width:100%; max-height:300px; border-radius:12px; margin-bottom:15px">
                <div class="input-group"><input type="text" id="previewCaption" placeholder="Подпись (необязательно)"></div>
                <div style="display:flex; gap:10px"><button onclick="sendImageFromPreview()" class="btn btn-primary">Отправить</button><button onclick="closeImagePreview()" class="btn btn-secondary">Отмена</button></div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    const reader = new FileReader();
    reader.onload = e => {
        document.getElementById('previewImage').src = e.target.result;
        document.getElementById('previewCaption').value = '';
        modal.style.display = 'flex';
    };
    reader.readAsDataURL(file);
    pendingImageFile = file;
}

function closeImagePreview() {
    const modal = document.getElementById('imagePreviewModal');
    if (modal) modal.style.display = 'none';
    pendingImageFile = null;
}

async function sendImageFromPreview() {
    if (!pendingImageFile) return;
    const caption = document.getElementById('previewCaption').value.trim();
    closeImagePreview();
    const formData = new FormData();
    formData.append('file', pendingImageFile);
    try {
        const res = await fetch('/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.url && ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'image', url: data.url, caption }));
        }
    } catch(e) { console.error(e); alert('Ошибка загрузки'); }
    pendingImageFile = null;
}

// ========== ВЕБ-СОКЕТ ==========
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${currentRoom}/${currentUser}/ws_${Date.now()}`;
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket подключен');
        document.getElementById('chatInput').disabled = false;
        document.getElementById('chatInput').focus();
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        const messagesDiv = document.getElementById('chatMessages');
        
        if (data.type === 'room_list_update' && data.action === 'delete') {
            roomsList = roomsList.filter(r => r.name !== data.room_name);
            renderRooms();
            if (currentRoom === data.room_name) {
                alert(`Комната "${data.room_name}" удалена`);
                leaveToRooms();
            }
            return;
        }
        
        if (data.type === 'message') {
            const isOwn = data.username === currentUser;
            const msgDiv = document.createElement('div');
            msgDiv.className = `chat-message ${isOwn ? 'own' : 'other'}`;
            msgDiv.innerHTML = `
                <div class="chat-message-header">
                    <span style="color: ${isOwn ? '#4aac4a' : '#ff8c42'}; cursor:pointer" onclick="showUserContextMenu(event, '${data.username}')">${escapeHtml(data.username)}</span>
                    <span>${data.timestamp}</span>
                </div>
                <div class="chat-message-text">${escapeHtml(data.message)}</div>
            `;
            messagesDiv.appendChild(msgDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
            if (!isOwn) playNotificationSound();
        } else if (data.type === 'image') {
            const isOwn = data.username === currentUser;
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
        } else if (data.type === 'kicked' || data.type === 'room_deleted') {
            alert(data.message);
            leaveToRooms();
        }
    };
    
    ws.onerror = () => console.error('WebSocket ошибка');
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
    Object.assign(menu.style, { position: 'fixed', left: event.pageX + 'px', top: event.pageY + 'px', backgroundColor: '#0d1f0d', border: '1px solid #4aac4a', borderRadius: '12px', padding: '8px 0', zIndex: '1000' });
    menu.innerHTML = `
        <div style="padding:8px 16px; cursor:pointer; color:white" onclick="viewUserProfile('${username}'); this.parentElement.remove();">👤 Профиль</div>
        <div style="padding:8px 16px; cursor:pointer; color:white" onclick="mentionUser('${username}'); this.parentElement.remove();">@ Отметить</div>
        <div style="padding:8px 16px; cursor:pointer; color:white" onclick="startPrivateChat('${username}'); this.parentElement.remove();">🔒 Написать лично</div>
    `;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', function close(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); } }), 10);
}

function viewUserProfile(username) { alert(`Профиль ${username}`); }
function mentionUser(username) { document.getElementById('chatInput').value += `@${username} `; }
function startPrivateChat(username) { alert(`Личный чат с ${username} (в разработке)`); }

document.getElementById('chatInput')?.addEventListener('paste', e => {
    const item = e.clipboardData.items[0];
    if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        showImagePreview(item.getAsFile());
    }
});

document.getElementById('fileInput')?.addEventListener('change', e => {
    if (e.target.files.length) showImagePreview(e.target.files[0]);
    e.target.value = '';
});

function openImageViewer(url) {
    const modal = document.getElementById('imageViewerModal');
    if (!modal) {
        const m = document.createElement('div');
        m.id = 'imageViewerModal';
        m.className = 'modal';
        m.innerHTML = `<div class="modal-content" style="max-width:90%; background:transparent"><button onclick="closeImageViewer()" class="close-btn" style="position:absolute; top:20px; right:30px; background:rgba(0,0,0,0.5); border-radius:50%; width:40px; height:40px">&times;</button><img id="viewerImage" style="max-width:90vw; max-height:80vh; border-radius:16px"></div>`;
        document.body.appendChild(m);
    }
    document.getElementById('viewerImage').src = url;
    document.getElementById('imageViewerModal').style.display = 'flex';
}

function closeImageViewer() { document.getElementById('imageViewerModal')?.remove(); }
function playNotificationSound() { document.getElementById('notificationSound')?.play().catch(e => console.log); }
function logout() { localStorage.clear(); location.reload(); }

// ========== ВОССТАНОВЛЕНИЕ СЕССИИ ==========
const savedToken = localStorage.getItem('chat_token');
const savedUser = localStorage.getItem('chat_username');
if (savedToken && savedUser) {
    currentUser = savedUser;
    document.getElementById('authContainer').style.display = 'none';
    document.getElementById('roomsContainer').style.display = 'block';
    document.getElementById('userNameDisplay').innerHTML = currentUser;
    loadRooms();
    loadUserProfile();
    
    const savedRoom = localStorage.getItem('current_room');
    if (savedRoom) {
        setTimeout(() => promptJoinRoom(savedRoom), 500);
    }
}

const joinRoomFromInvite = localStorage.getItem('join_room');
if (joinRoomFromInvite && !currentRoom) {
    localStorage.removeItem('join_room');
    setTimeout(() => promptJoinRoom(joinRoomFromInvite), 500);
}