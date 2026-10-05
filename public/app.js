const FEELS = ['angry', 'sad', 'annoyed', 'exhausted', 'hurt', 'heh'];
const FEEL_NAME = {
    angry: 'Wroth',
    sad: 'Woeful',
    annoyed: 'Vexed',
    exhausted: 'Weary',
    hurt: 'Pained',
    heh: 'Wry'
};

let items = [],
    session = null,
    token = null,
    view = 'login',
    openId = null,
    feel = FEELS[0];

const keep = (t, r) => {
    try { localStorage.setItem('portal', JSON.stringify({ token: t, role: r })); } catch (e) {}
};
const forget = () => {
    try { localStorage.removeItem('portal'); } catch (e) {}
};
try {
    const saved = JSON.parse(localStorage.getItem('portal') || 'null');
    if (saved && saved.token) {
        token = saved.token;
        session = saved.role;
    }
} catch (e) {}

const $ = id => document.getElementById(id);
const fmt = t => {
    const d = new Date(t);
    return d.toLocaleString('en', {
        month: 'long'
    }) + ' ' + String(d.getDate()).padStart(2, '0') + '. ' + d.getFullYear() + ' - ' + d.toLocaleTimeString('en', {
        hour: '2-digit',
        minute: '2-digit'
    });
};

// ---- server ----
async function api(path, opts = {}) {
    const r = await fetch('/api/' + path, {
        ...opts,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? {
                Authorization: 'Bearer ' + token
            } : {})
        }
    });
    if (!r.ok) {
        if (r.status === 401 && token) {
            forget();
            token = null;
            session = null;
            items = [];
            draw();
        }
        throw new Error(r.status);
    }
    return r.json();
}
const load = async () => {
    items = await api('grievances');
};
async function markRead(id, val) {
    try {
        await api('grievances/' + id + '/read', {
            method: 'PATCH',
            body: JSON.stringify({
                read: val
            })
        });
        const g = items.find(x => x.id == id);
        if (g) g.read = val;
    } catch (e) {
        alert('Alas, it could not be marked. Please try again Princess.');
    }
    draw();
}

// ---- screen switching ----
function draw() {
    document.body.className = session === 'admin' ? 'admin' : '';
    if (!session) view = 'login';
    else if (view === 'login') view = session === 'admin' ? 'list' : 'write';
    if (view === 'detail' && !items.find(x => x.id == openId)) view = 'list';
    document.querySelectorAll('[data-view]').forEach(s => s.hidden = s.dataset.view !== view);
    if (view === 'list') renderList();
    if (view === 'detail') renderDetail();
}

function go(v) {
    view = v;
    draw();
    window.scrollTo(0, 0);
}

function feelIcon(container, f) {
    container.innerHTML = '';
    if (FEELS.includes(f)) {
        const i = document.createElement('img');
        i.className = 'fi';
        i.src = 'assets/' + f + '.svg';
        i.alt = f;
        container.append(i);
    } else {
        const s = document.createElement('span');
        s.textContent = f;
        container.append(s);
    }
}

function renderList() {
    const admin = session === 'admin',
        unread = items.filter(x => !x.read).length;
    $('list-title').textContent = admin ? 'Missives for the Council' : 'Missives Dispatched';
    $('banner').hidden = !(admin && unread);
    $('banner').textContent = `🔔 ${unread} new missive${unread > 1 ? 's' : ''} awaiteth thee`;
    $('new').hidden = admin;
    $('empty').hidden = items.length > 0;
    const box = $('rows');
    box.innerHTML = '';
    [...items].reverse().forEach(x => {
        const row = $('tpl-item').content.firstElementChild.cloneNode(true);
        row.querySelector('.ttl').textContent = x.title;
        row.querySelector('.date').textContent = fmt(x.date);
        row.querySelector('.st').textContent = admin ? (x.read ? 'Beheld' : 'Newly Come!') : (x.read ? 'Perused' : 'Not Yet Perused');
        row.onclick = () => {
            openId = x.id;
            go('detail');
        };
        box.append(row);
    });
}

function renderDetail() {
    const g = items.find(x => x.id == openId),
        admin = session === 'admin';
    feelIcon($('d-icon'), g.feeling);
    $('d-title').textContent = g.title;
    $('d-date').textContent = (FEEL_NAME[g.feeling] || '') + ' · ' + fmt(g.date);
    $('d-msg').textContent = g.body || '(no words, only a title)';
    $('seen-wrap').hidden = !admin;
    $('seen').checked = !!g.read;
    $('d-status').hidden = admin;
    $('d-status').textContent = g.read ? '✓ Perused' : 'Not Yet Perused';
}

// ---- login ----
async function login() {
    const u = $('u').value.trim().toLowerCase(),
        p = $('p').value,
        err = $('login-err');
    let r;
    try {
        r = await api('login', {
            method: 'POST',
            body: JSON.stringify({
                username: u,
                password: p
            })
        });
    } catch (e) {
        err.textContent = e.message === '401' ?
            'Alas, thy name or secret word is false.' :
            'The server answereth not (' + e.message + '). Is it running, and opened via its address rather than as a file?';
        return;
    }
    token = r.token;
    session = r.role;
    keep(token, session);
    err.textContent = '';
    $('p').value = '';
    try {
        await load();
    } catch (e) {
        items = [];
    }
    go(r.role === 'admin' ? 'list' : 'write');
}
$('go').onclick = login;
$('p').onkeydown = $('u').onkeydown = e => {
    if (e.key === 'Enter') login();
};
$('forgot').onclick = () => $('hints').classList.toggle('open');

// ---- write ----
function pickFeel(f) {
    feel = f;
    document.querySelectorAll('.feel button').forEach(b => b.classList.toggle('on', b.dataset.f === f));
}
document.querySelectorAll('.feel button').forEach(b => b.onclick = () => pickFeel(b.dataset.f));
pickFeel(feel);

$('send').onclick = async () => {
    const title = $('t').value.trim();
    if (!title) {
        $('write-err').textContent = 'Prithee, give thy plea a title.';
        return;
    }
    try {
        items.push(await api('grievances', {
            method: 'POST',
            body: JSON.stringify({
                title,
                body: $('b').value.trim(),
                feeling: feel
            })
        }));
    } catch (e) {
        alert('Alas, the messenger hath fallen ill. Prithee, try again.');
        return;
    }
    $('t').value = '';
    $('b').value = '';
    $('write-err').textContent = '';
    const s = $('sent');
    s.hidden = false;
    s.style.animation = 'none';
    void s.offsetWidth;
    s.style.animation = '';
    setTimeout(() => s.hidden = true, 2200);
};
$('see').onclick = () => go('list');
$('new').onclick = () => go('write');
$('back').onclick = () => go('list');
$('seen').onchange = e => markRead(openId, e.target.checked);

// ---- logout ----
document.querySelectorAll('[data-logout]').forEach(b => b.onclick = () => {
    forget();
    session = null;
    token = null;
    items = [];
    $('u').value = '';
    $('p').value = '';
    go('login');
});

// ---- auto-refresh (not while writing) ----
setInterval(async () => {
    if (session && view !== 'write') {
        try {
            await load();
            draw();
        } catch (e) {}
    }
}, 10000);

// ---- scale whole page to fit narrow screens ----
function fit() {
    document.documentElement.style.setProperty('--s', Math.min(1, window.innerWidth / 560));
}
fit();
addEventListener('resize', fit);
draw();
if (session) load().then(draw).catch(() => {});