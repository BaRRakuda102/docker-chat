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

// ========== ЧАСОВОЙ ПОЯС ==========
function convertToLocalTime(serverTimeStr) {
    if (!serverTimeStr) return '--:--';
    
    // Получаем текущее время сервера (UTC)
    var now = new Date();
    var serverHours = parseInt(serverTimeStr.split(':')[0]);
    var serverMinutes = parseInt(serverTimeStr.split(':')[1]);
    
    // Создаём дату с серверным временем в UTC
    var serverDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), serverHours, serverMinutes));
    
    // Конвертируем в локальное время
    var localHours = serverDate.getHours().toString().padStart(2, '0');
    var localMinutes = serverDate.getMinutes().toString().padStart(2, '0');
    
    return localHours + ':' + localMinutes;
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showMessage(elementId, text, isError) {
    var el = document.getElementById(elementId);
    if (el) {
        var color = isError ? '#ff6b6b' : '#4aac4a';
        el.innerHTML = '<span style="color: ' + color + '">' + text + '</span>';
        setTimeout(function() {
            if (el.innerHTML === '<span style="color: ' + color + '">' + text + '</span>') {
                el.innerHTML = '';
            }
        }, 3000);
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
    var username = document.getElementById('regUsername').value.trim();
    var email = document.getElementById('regEmail').value.trim();
    var password = document.getElementById('regPassword').value;
    var confirm = document.getElementById('regPasswordConfirm').value;
    
    if (!username || !email || !password) {
        showMessage('registerMessage', 'Заполните все поля', true);
        return;
    }
    if (password !== confirm) {
        showMessage('registerMessage', 'Пароли не совпадают', true);
        return;
    }
    if (password.length < 6) {
        showMessage('registerMessage', 'Пароль должен быть не менее 6 символов', true);
        return;
    }
    
    showMessage('registerMessage', 'Регистрация...', false);
    
    try {
        var response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, email: email, password: password })
        });
        var data = await response.json();
        
        if (data.success) {
            localStorage.setItem('chat_token', data.token);
            localStorage.setItem('chat_username', data.username);
            currentUser = data.username;
            showMessage('registerMessage', 'Регистрация успешна!', false);
            setTimeout(function() {
                document.getElementById('authContainer').style.display = 'none';
                document.getElementById('roomsContainer').style.display = 'block';
                document.getElementById('userNameDisplay').innerHTML = currentUser;
                loadRooms();
                loadUserProfile();
            }, 1000);
        } else {
            showMessage('registerMessage', data.error, true);
        }
    } catch(e) {
        showMessage('registerMessage', 'Ошибка: ' + e.message, true);
    }
}

// ========== ВХОД ==========
async function doLogin() {
    var username = document.getElementById('loginUsername').value.trim();
    var password = document.getElementById('loginPassword').value;
    if (!username || !password) {
        showMessage('loginMessage', 'Введите имя и пароль', true);
        return;
    }
    
    showMessage('loginMessage', 'Вход...', false);
    
    try {
        var response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
        });
        var data = await response.json();
        
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
            showMessage('loginMessage', data.error, true);
        }
    } catch(e) {
        showMessage('loginMessage', 'Ошибка: ' + e.message, true);
    }
}

// ========== ПРОФИЛЬ ==========
function toggleProfileMenu() {
    var dropdown = document.getElementById('profileDropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
}

document.addEventListener('click', function(e) {
    var dropdown = document.getElementById('profileDropdown');
    var userInfo = document.querySelector('.user-info');
    if (dropdown && userInfo && !userInfo.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('show');
    }
});

function calculateAge(birthDate) {
    if (!birthDate) return null;
    var today = new Date();
    var birth = new Date(birthDate);
    var age = today.getFullYear() - birth.getFullYear();
    var m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return age;
}

async function loadUserProfile() {
    try {
        var response = await fetch('/api/user/profile?username=' + encodeURIComponent(currentUser));
        var data = await response.json();
        if (data.success) {
            document.getElementById('profileUsername').innerHTML = data.username;
            document.getElementById('profileEmail').innerHTML = data.email;
            document.getElementById('displayName').innerHTML = data.display_name || data.username;
            if (data.birth_date) {
                var age = calculateAge(data.birth_date);
                document.getElementById('userAge').innerHTML = age + ' лет (' + data.birth_date + ')';
            } else {
                document.getElementById('userAge').innerHTML = 'Не указан';
            }
            document.getElementById('regDate').innerHTML = new Date(data.created_at).toLocaleDateString();
            if (data.avatar_url) {
                updateAvatarDisplay(data.avatar_url);
            }
        }
    } catch(e) {
        console.error(e);
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
    var displayName = document.getElementById('editDisplayName').value.trim();
    var birthDate = document.getElementById('editBirthDate').value;
    try {
        var response = await fetch('/api/user/update_profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser, display_name: displayName, birth_date: birthDate })
        });
        var data = await response.json();
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
    var formData = new FormData();
    formData.append('avatar', file);
    formData.append('username', currentUser);
    try {
        var response = await fetch('/api/user/upload_avatar', { method: 'POST', body: formData });
        var data = await response.json();
        if (data.success) {
            updateAvatarDisplay(data.avatar_url + '?t=' + Date.now());
            alert('Аватар обновлён!');
            loadUserProfile();
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch(e) {
        alert('Ошибка загрузки аватара');
    }
}

function updateAvatarDisplay(avatarUrl) {
    var ids = ['userAvatarSmall', 'userAvatarLarge', 'chatUserAvatar', 'editAvatarPreview'];
    for (var i = 0; i < ids.length; i++) {
        var el = document.getElementById(ids[i]);
        if (el) el.src = avatarUrl;
    }
}

var avatarInput = document.getElementById('avatarInput');
if (avatarInput) {
    avatarInput.addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (file && file.type.startsWith('image/') && file.size <= 5 * 1024 * 1024) {
            var reader = new FileReader();
            reader.onload = function(event) {
                var preview = document.getElementById('editAvatarPreview');
                if (preview) preview.src = event.target.result;
            };
            reader.readAsDataURL(file);
            uploadAvatar(file);
        } else {
            alert('Файл должен быть изображением до 5MB');
        }
    });
}

// ========== КОМНАТЫ ==========
async function loadRooms() {
    try {
        var response = await fetch('/api/rooms');
        var data = await response.json();
        roomsList = data.success ? data.rooms : [];
        renderRooms();
    } catch(e) {
        roomsList = [];
        renderRooms();
    }
}

function renderRooms() {
    var container = document.getElementById('roomsList');
    if (!container) return;
    if (roomsList.length === 0) {
        container.innerHTML = '<div class="empty-rooms"><i class="fas fa-comment-slash"></i><p>Нет комнат</p><small>Создайте первую комнату</small></div>';
    } else {
        var html = '';
        for (var i = 0; i < roomsList.length; i++) {
            var room = roomsList[i];
            html += '<div class="room-card" onclick="promptJoinRoom(\'' + escapeHtml(room.name) + '\')">';
            html += '<div class="room-icon"><i class="fas fa-lock"></i></div>';
            html += '<div class="room-details">';
            html += '<h4>' + escapeHtml(room.name) + '</h4>';
            html += '<p>Создал: ' + escapeHtml(room.creator) + '</p>';
            html += '</div></div>';
        }
        container.innerHTML = html;
    }
}

function filterRooms() {
    var term = document.getElementById('searchRoomsInput').value.toLowerCase();
    var cards = document.querySelectorAll('.room-card');
    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var name = card.querySelector('h4').innerText.toLowerCase();
        card.style.display = name.indexOf(term) !== -1 ? 'flex' : 'none';
    }
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
    var name = document.getElementById('newRoomName').value.trim();
    var password = document.getElementById('newRoomPassword').value;
    if (!name || !password) {
        alert('Заполните все поля');
        return;
    }
    if (name.length < 3) {
        alert('Название комнаты должно быть не менее 3 символов');
        return;
    }
    try {
        var response = await fetch('/api/create_room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, password: password, creator: currentUser })
        });
        var data = await response.json();
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

function promptJoinRoom(roomName, presetPassword) {
    if (isJoining) return;
    pendingRoom = roomName;
    pendingRoomPassword = presetPassword || null;
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
    var password = pendingRoomPassword || document.getElementById('roomPassword').value;
    if (!password) {
        alert('Введите пароль');
        return;
    }
    
    isJoining = true;
    try {
        var response = await fetch('/api/join_room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room: pendingRoom, password: password })
        });
        var data = await response.json();
        if (data.success) {
            closeJoinRoomModal();
            currentRoom = pendingRoom;
            localStorage.setItem('current_room', currentRoom);
            localStorage.setItem('current_room_password', password);
            document.getElementById('roomsContainer').style.display = 'none';
            document.getElementById('chatContainer').style.display = 'flex';
            document.getElementById('chatRoomName').innerHTML = '# ' + currentRoom;
            document.getElementById('chatRoomTitle').innerHTML = currentRoom;
            document.getElementById('chatCurrentUser').innerHTML = currentUser;
            document.getElementById('chatMessages').innerHTML = '';
            await updateRoomInfo();
            connectWebSocket();
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
    localStorage.removeItem('current_room');
    localStorage.removeItem('current_room_password');
    document.getElementById('chatContainer').style.display = 'none';
    document.getElementById('roomsContainer').style.display = 'block';
    loadRooms();
}

// ========== ПРИГЛАШЕНИЯ ==========
async function updateRoomInfo() {
    try {
        var response = await fetch('/api/rooms/' + currentRoom + '/info');
        var data = await response.json();
        if (data.success) {
            currentRoomId = data.room.id;
            isRoomCreator = (data.room.creator === currentUser);
            var btn = document.getElementById('roomSettingsBtn');
            if (btn) {
                btn.style.display = isRoomCreator ? 'flex' : 'none';
            }
        }
    } catch(e) {
        console.error(e);
    }
}

function showInviteModal() {
    var link = window.location.origin + '/join/' + currentRoomId;
    document.getElementById('inviteLinkInput').value = link;
    document.getElementById('inviteModal').style.display = 'flex';
}

function closeInviteModal() {
    document.getElementById('inviteModal').style.display = 'none';
}

function copyInviteLink() {
    var input = document.getElementById('inviteLinkInput');
    input.select();
    document.execCommand('copy');
    alert('Ссылка скопирована!');
}

// ========== НАСТРОЙКИ КОМНАТЫ ==========
async function showRoomSettings() {
    try {
        var response = await fetch('/api/rooms/' + currentRoom + '/info');
        var data = await response.json();
        if (data.success) {
            document.getElementById('settingsRoomName').textContent = data.room.name;
            document.getElementById('settingsRoomCreator').textContent = data.room.creator;
            document.getElementById('settingsMemberCount').textContent = data.room.member_count;
            document.getElementById('settingsRoomId').textContent = data.room.id;
            await loadRoomMembers();
            var deleteSection = document.getElementById('deleteRoomSection');
            if (deleteSection) {
                deleteSection.style.display = isRoomCreator ? 'block' : 'none';
            }
            document.getElementById('roomSettingsModal').style.display = 'flex';
        }
    } catch(e) {
        alert('Не удалось загрузить информацию');
    }
}

function closeRoomSettings() {
    document.getElementById('roomSettingsModal').style.display = 'none';
}

async function loadRoomMembers() {
    try {
        var response = await fetch('/api/rooms/' + currentRoom + '/members');
        var data = await response.json();
        var container = document.getElementById('roomMembersList');
        if (container && data.success) {
            var html = '';
            for (var i = 0; i < data.members.length; i++) {
                var m = data.members[i];
                html += '<div class="member-item">';
                html += '<span class="member-name">' + escapeHtml(m) + (m === currentUser ? ' (Вы)' : '') + '</span>';
                if (m !== currentUser && isRoomCreator) {
                    html += '<button onclick="kickUser(\'' + escapeHtml(m) + '\')" class="kick-btn">Выгнать</button>';
                }
                html += '</div>';
            }
            container.innerHTML = html;
        }
    } catch(e) {
        console.error(e);
    }
}

async function renameRoom() {
    var newName = document.getElementById('editRoomName').value.trim();
    if (!newName || newName.length < 3) {
        alert('Название не менее 3 символов');
        return;
    }
    try {
        var response = await fetch('/api/rooms/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_name: currentRoom, new_name: newName, username: currentUser })
        });
        var data = await response.json();
        if (data.success) {
            alert('Название изменено!');
            currentRoom = newName;
            document.getElementById('chatRoomName').innerHTML = '# ' + currentRoom;
            document.getElementById('chatRoomTitle').innerHTML = currentRoom;
            closeRoomSettings();
            loadRooms();
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch(e) {
        alert('Ошибка соединения');
    }
}

async function kickUser(username) {
    if (!confirm('Выгнать ' + username + '?')) return;
    try {
        var response = await fetch('/api/rooms/kick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_name: currentRoom, username: username, admin: currentUser })
        });
        var data = await response.json();
        if (data.success) {
            alert('Пользователь ' + username + ' выгнан');
            await loadRoomMembers();
            await updateRoomInfo();
        } else {
            alert('Ошибка: ' + data.error);
        }
    } catch(e) {
        alert('Ошибка соединения');
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
        var response = await fetch('/api/rooms/delete/' + currentRoom + '?username=' + encodeURIComponent(currentUser), { method: 'DELETE' });
        var data = await response.json();
        if (data.success) {
            alert('Комната "' + currentRoom + '" удалена');
            if (ws) ws.close();
            localStorage.removeItem('current_room');
            localStorage.removeItem('current_room_password');
            document.getElementById('chatContainer').style.display = 'none';
            document.getElementById('roomsContainer').style.display = 'block';
            await loadRooms();
        } else {
            alert('Ошибка: ' + (data.error || 'Не удалось удалить'));
        }
    } catch(e) {
        alert('Ошибка соединения');
    }
}

// ========== ПРЕДПРОСМОТР ИЗОБРАЖЕНИЙ ==========
function showImagePreview(file) {
    var modal = document.getElementById('imagePreviewModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'imagePreviewModal';
        modal.className = 'modal';
        modal.innerHTML = '<div class="modal-content" style="max-width:500px; text-align:center">' +
            '<div class="modal-header"><h3>Предпросмотр</h3><button onclick="closeImagePreview()" class="close-btn">&times;</button></div>' +
            '<img id="previewImage" style="max-width:100%; max-height:300px; border-radius:12px; margin-bottom:15px">' +
            '<div class="input-group"><input type="text" id="previewCaption" placeholder="Подпись (необязательно)"></div>' +
            '<div style="display:flex; gap:10px"><button onclick="sendImageFromPreview()" class="btn btn-primary">Отправить</button>' +
            '<button onclick="closeImagePreview()" class="btn btn-secondary">Отмена</button></div></div>';
        document.body.appendChild(modal);
    }
    var reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('previewImage').src = e.target.result;
        document.getElementById('previewCaption').value = '';
        modal.style.display = 'flex';
    };
    reader.readAsDataURL(file);
    pendingImageFile = file;
}

function closeImagePreview() {
    var modal = document.getElementById('imagePreviewModal');
    if (modal) {
        modal.style.display = 'none';
    }
    pendingImageFile = null;
}

async function sendImageFromPreview() {
    if (!pendingImageFile) return;
    var caption = document.getElementById('previewCaption').value.trim();
    closeImagePreview();
    var formData = new FormData();
    formData.append('file', pendingImageFile);
    try {
        var response = await fetch('/upload', { method: 'POST', body: formData });
        var data = await response.json();
        if (data.url && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'image', url: data.url, caption: caption }));
        }
    } catch(e) {
        console.error(e);
        alert('Ошибка загрузки');
    }
    pendingImageFile = null;
}

// ========== ВЕБ-СОКЕТ ==========
function connectWebSocket() {
    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsUrl = protocol + '//' + window.location.host + '/ws/' + currentRoom + '/' + currentUser + '/ws_' + Date.now();
    ws = new WebSocket(wsUrl);
    
    ws.onopen = function() {
        console.log('WebSocket подключен');
        var chatInput = document.getElementById('chatInput');
        if (chatInput) {
            chatInput.disabled = false;
            chatInput.focus();
        }
    };
    
    ws.onmessage = function(event) {
        var data = JSON.parse(event.data);
        var messagesDiv = document.getElementById('chatMessages');
        
        if (data.type === 'room_list_update' && data.action === 'delete') {
            roomsList = roomsList.filter(function(r) { return r.name !== data.room_name; });
            renderRooms();
            if (currentRoom === data.room_name) {
                alert('Комната "' + data.room_name + '" удалена');
                leaveToRooms();
            }
            return;
        }
        
        if (data.type === 'message') {
            var isOwn = data.username === currentUser;
            var localTime = convertToLocalTime(data.timestamp);
            var msgDiv = document.createElement('div');
            msgDiv.className = 'chat-message ' + (isOwn ? 'own' : 'other');
            msgDiv.innerHTML = '<div class="chat-message-header">' +
                '<span style="color: ' + (isOwn ? '#4aac4a' : '#ff8c42') + '; cursor:pointer" onclick="showUserContextMenu(event, \'' + escapeHtml(data.username) + '\')">' + escapeHtml(data.username) + '</span>' +
                '<span>' + localTime + '</span></div>' +
                '<div class="chat-message-text">' + escapeHtml(data.message) + '</div>';
            messagesDiv.appendChild(msgDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
            if (!isOwn) playNotificationSound();
        } else if (data.type === 'image') {
            var isOwn = data.username === currentUser;
            var localTime = convertToLocalTime(data.timestamp);
            var imgDiv = document.createElement('div');
            imgDiv.className = 'chat-message ' + (isOwn ? 'own' : 'other');
            imgDiv.innerHTML = '<div class="chat-message-header">' +
                '<span style="color: ' + (isOwn ? '#4aac4a' : '#ff8c42') + '">' + escapeHtml(data.username) + '</span>' +
                '<span>' + localTime + '</span></div>' +
                '<img src="' + data.url + '" class="chat-image" onclick="openImageViewer(\'' + data.url + '\')">' +
                (data.caption ? '<div class="image-caption">' + escapeHtml(data.caption) + '</div>' : '');
            messagesDiv.appendChild(imgDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        } else if (data.type === 'system') {
            var sysDiv = document.createElement('div');
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
    
    ws.onerror = function() { console.error('WebSocket ошибка'); };
    ws.onclose = function() { console.log('WebSocket отключен'); };
}

function sendChatMessage() {
    var input = document.getElementById('chatInput');
    var message = input.value.trim();
    if (!message || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'message', message: message }));
    input.value = '';
}

function showUserContextMenu(event, username) {
    event.stopPropagation();
    var menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.position = 'fixed';
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';
    menu.style.backgroundColor = '#1a241a';
    menu.style.border = '1px solid #4aac4a';
    menu.style.borderRadius = '12px';
    menu.style.padding = '8px 0';
    menu.style.zIndex = '1000';
    menu.innerHTML = '<div style="padding:8px 16px; cursor:pointer; color:white" onclick="viewUserProfile(\'' + username + '\'); this.parentElement.remove();">👤 Профиль</div>' +
        '<div style="padding:8px 16px; cursor:pointer; color:white" onclick="mentionUser(\'' + username + '\'); this.parentElement.remove();">@ Отметить</div>' +
        '<div style="padding:8px 16px; cursor:pointer; color:white" onclick="startPrivateChat(\'' + username + '\'); this.parentElement.remove();">🔒 Написать лично</div>';
    document.body.appendChild(menu);
    setTimeout(function() {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 10);
}

function viewUserProfile(username) { alert('Профиль ' + username); }
function mentionUser(username) {
    var input = document.getElementById('chatInput');
    if (input) input.value += '@' + username + ' ';
}
function startPrivateChat(username) { alert('Личный чат с ' + username + ' (в разработке)'); }

var chatInputElement = document.getElementById('chatInput');
if (chatInputElement) {
    chatInputElement.addEventListener('paste', function(e) {
        var item = e.clipboardData.items[0];
        if (item && item.type.indexOf('image') !== -1) {
            e.preventDefault();
            showImagePreview(item.getAsFile());
        }
    });
}

var fileInputElement = document.getElementById('fileInput');
if (fileInputElement) {
    fileInputElement.addEventListener('change', function(e) {
        if (e.target.files.length) showImagePreview(e.target.files[0]);
        e.target.value = '';
    });
}

function openImageViewer(url) {
    var modal = document.getElementById('imageViewerModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'imageViewerModal';
        modal.className = 'modal';
        modal.innerHTML = '<div class="modal-content" style="max-width:90%; background:transparent; box-shadow:none">' +
            '<button onclick="closeImageViewer()" class="close-btn" style="position:absolute; top:20px; right:30px; background:rgba(0,0,0,0.5); border-radius:50%; width:40px; height:40px; color:white">&times;</button>' +
            '<img id="viewerImage" style="max-width:90vw; max-height:80vh; border-radius:16px"></div>';
        document.body.appendChild(modal);
    }
    document.getElementById('viewerImage').src = url;
    modal.style.display = 'flex';
}

function closeImageViewer() {
    var modal = document.getElementById('imageViewerModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function playNotificationSound() {
    var audio = document.getElementById('notificationSound');
    if (audio) {
        audio.play().catch(function(e) { console.log('Звук не воспроизведён'); });
    }
}

function logout() {
    localStorage.clear();
    location.reload();
}

// ========== ВОССТАНОВЛЕНИЕ СЕССИИ И КОМНАТЫ ==========
var savedToken = localStorage.getItem('chat_token');
var savedUser = localStorage.getItem('chat_username');
if (savedToken && savedUser) {
    currentUser = savedUser;
    document.getElementById('authContainer').style.display = 'none';
    document.getElementById('roomsContainer').style.display = 'block';
    document.getElementById('userNameDisplay').innerHTML = currentUser;
    loadRooms();
    loadUserProfile();
    
    var savedRoom = localStorage.getItem('current_room');
    var savedRoomPassword = localStorage.getItem('current_room_password');
    if (savedRoom && savedRoomPassword && !currentRoom) {
        setTimeout(function() {
            var roomExists = false;
            for (var i = 0; i < roomsList.length; i++) {
                if (roomsList[i].name === savedRoom) {
                    roomExists = true;
                    break;
                }
            }
            if (roomExists) {
                promptJoinRoom(savedRoom, savedRoomPassword);
            } else {
                localStorage.removeItem('current_room');
                localStorage.removeItem('current_room_password');
            }
        }, 1000);
    }
}

var autoJoinRoom = localStorage.getItem('auto_join_room');
var autoJoinPassword = localStorage.getItem('auto_join_password');
if (autoJoinRoom && autoJoinPassword && !currentRoom) {
    localStorage.removeItem('auto_join_room');
    localStorage.removeItem('auto_join_password');
    setTimeout(function() {
        promptJoinRoom(autoJoinRoom, autoJoinPassword);
    }, 1000);
}

console.log('Script loaded successfully');