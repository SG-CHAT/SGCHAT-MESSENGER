const SUPABASE_URL = 'https://sfsxflsbueyotiksqknp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_32wqroL1fDtPIVwHbvZtIg_5Hipzmdj';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let messageSubscription = null;
let presenceSubscription = null;

// DOM элементы
const registrationScreen = document.getElementById('registration-screen');
const chatScreen = document.getElementById('chat-screen');
const registrationForm = document.getElementById('registration-form');
const userNameInput = document.getElementById('user-name');
const messagesList = document.getElementById('messages-list');
const messagesContainer = document.getElementById('messages-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const onlineStatus = document.getElementById('online-status');
const joinButton = document.getElementById('join-button');

// Кнопка прокрутки вниз
const scrollBottomButton = document.createElement('button');
scrollBottomButton.className = 'scroll-bottom-button';
scrollBottomButton.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M6 9L12 15L18 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
scrollBottomButton.onclick = () => scrollToBottom(true);
document.getElementById('chat-screen').appendChild(scrollBottomButton);

document.title = 'SG CHAT — Семейный Чат';

function formatTime(timestamp) {
    const d = new Date(timestamp);
    const now = new Date();
    const time = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    if (d.toDateString() === now.toDateString()) return time;
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate()-1);
    if (d.toDateString() === yesterday.toDateString()) return `Вчера ${time}`;
    return `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getFullYear()} ${time}`;
}

function scrollToBottom(smooth = true) {
    setTimeout(() => {
        messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
    }, 100);
}

function isNearBottom() {
    return messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 150;
}

function renderMessage(msg, isNew = false) {
    if (!currentUser) return;
    if (document.getElementById(`msg-${msg.id}`)) return;

    const isMine = msg.user_id === currentUser.id;
    const wrapper = document.createElement('div');
    wrapper.id = `msg-${msg.id}`;
    wrapper.className = `message-wrapper ${isMine ? 'sent' : 'received'}`;

    if (!isMine) {
        const header = document.createElement('div');
        header.className = 'message-header';
        header.innerHTML = `<span class="sender-name">${escapeHtml(msg.user_name)}</span>`;
        wrapper.appendChild(header);
    }

    wrapper.innerHTML += `
        <div class="message-bubble">${escapeHtml(msg.text)}</div>
        <div class="message-time">${formatTime(msg.created_at)}</div>
    `;
    messagesList.appendChild(wrapper);

    if (isNew || isNearBottom()) scrollToBottom();
    updateScrollButton();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderMessages(messages) {
    messagesList.innerHTML = '';
    messages.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    messages.forEach(m => renderMessage(m));
    scrollToBottom(false);
}

async function loadMessages() {
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(100);
    if (error) { console.error(error); return; }
    if (data) renderMessages(data);
}

function subscribeToMessages() {
    if (messageSubscription) supabase.removeChannel(messageSubscription);
    messageSubscription = supabase
        .channel('public:messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
            payload => renderMessage(payload.new, true)
        )
        .subscribe();
}

async function subscribeToPresence() {
    if (presenceSubscription) supabase.removeChannel(presenceSubscription);
    const channel = supabase.channel('online-users');
    channel
        .on('presence', { event: 'sync' }, () => {
            const count = Object.keys(channel.presenceState()).length;
            updateOnlineStatus(count);
        })
        .subscribe(async status => {
            if (status === 'SUBSCRIBED' && currentUser) {
                await channel.track({ user: currentUser.name, online_at: new Date().toISOString() });
            }
        });
    presenceSubscription = channel;
}

function updateOnlineStatus(count) {
    if (count === 0) onlineStatus.textContent = 'Нет пользователей онлайн';
    else if (count === 1) onlineStatus.textContent = '1 пользователь онлайн';
    else if (count < 5) onlineStatus.textContent = `${count} пользователя онлайн`;
    else onlineStatus.textContent = `${count} пользователей онлайн`;
}

async function registerUser(name) {
    // Ищем первого пользователя с таким именем
    const { data: existingUsers, error: selectError } = await supabase
        .from('users')
        .select('*')
        .eq('name', name)
        .limit(1);
    if (selectError) throw selectError;
    const existingUser = existingUsers?.[0] || null;

    if (existingUser) {
        await supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', existingUser.id);
        return existingUser;
    }

    const { data: newUser, error } = await supabase
        .from('users')
        .insert([{ name, email: null }])
        .select()
        .single();
    if (error) throw error;
    return newUser;
}

async function sendMessage(text) {
    if (!currentUser || !text.trim()) return;
    const { error } = await supabase
        .from('messages')
        .insert([{ user_id: currentUser.id, user_name: currentUser.name, text: text.trim() }]);
    if (error) {
        console.error(error);
        alert('Не удалось отправить сообщение');
        return;
    }
    messageInput.value = '';
    messageInput.focus();
}

function updateScrollButton() {
    scrollBottomButton.classList.toggle('visible', !isNearBottom());
}

messagesContainer.addEventListener('scroll', updateScrollButton);

registrationForm.addEventListener('submit', async e => {
    e.preventDefault();
    const name = userNameInput.value.trim();
    if (!name) return;

    joinButton.disabled = true;
    joinButton.classList.add('loading');
    joinButton.innerHTML = '<span>Вход в SG CHAT...</span>';

    try {
        currentUser = await registerUser(name);
        localStorage.setItem('sgchat_user', JSON.stringify(currentUser));

        registrationScreen.classList.remove('active');
        chatScreen.classList.add('active');

        await loadMessages();
        subscribeToMessages();
        subscribeToPresence();
        messageInput.focus();
    } catch (err) {
        alert('Ошибка входа. Попробуйте ещё раз.');
        joinButton.disabled = false;
        joinButton.classList.remove('loading');
        joinButton.innerHTML = '<span>Войти в SG CHAT</span><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
});

messageForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!messageInput.value.trim()) return;
    sendButton.disabled = true;
    await sendMessage(messageInput.value);
    setTimeout(() => { sendButton.disabled = false; }, 500);
});

messageInput.addEventListener('keypress', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        messageForm.dispatchEvent(new Event('submit'));
    }
});

async function checkExistingSession() {
    const saved = localStorage.getItem('sgchat_user');
    if (!saved) return;
    try {
        const user = JSON.parse(saved);
        const { data, error } = await supabase.from('users').select('*').eq('id', user.id).single();
        if (error || !data) { localStorage.removeItem('sgchat_user'); return; }
        currentUser = data;
        localStorage.setItem('sgchat_user', JSON.stringify(data));
        registrationScreen.classList.remove('active');
        chatScreen.classList.add('active');
        await loadMessages();
        subscribeToMessages();
        subscribeToPresence();
        messageInput.focus();
    } catch (e) {
        localStorage.removeItem('sgchat_user');
    }
}

async function initApp() {
    if (SUPABASE_URL === 'YOUR_SUPABASE_URL' || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
        document.querySelector('.app-subtitle').textContent = 'Настройте подключение к Supabase';
        return;
    }
    await checkExistingSession();
}
initApp();

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentUser) loadMessages();
});
