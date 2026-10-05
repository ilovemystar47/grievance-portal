const express = require('express'),
    fs = require('fs'),
    path = require('path'),
    crypto = require('crypto');
const app = express();
app.use(express.json({
    limit: '50kb'
}));
app.use(express.static(path.join(__dirname, 'public')));

const USERS = {
    [(process.env.USER_NAME || 'star').toLowerCase()]: {
        pass: process.env.USER_PASS || 'rapunzel47',
        role: 'user'
    },
    [(process.env.ADMIN_NAME || 'gayl').toLowerCase()]: {
        pass: process.env.ADMIN_PASS || 'lovessophie',
        role: 'admin'
    }
};

// ---- logins that survive restarts (signed tokens, no memory) ----
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const makeToken = role => {
    const p = role + '.' + (Date.now() + 30 * 864e5);
    return p + '.' + sign(p);
};
const roleOf = t => {
    const [role, exp, sig] = String(t).split('.');
    if (!role || !exp || !sig) return null;
    const good = Buffer.from(sign(role + '.' + exp)),
        got = Buffer.from(sig);
    if (good.length !== got.length || !crypto.timingSafeEqual(good, got) || Date.now() > +exp) return null;
    return role;
};
const auth = role => (req, res, next) => {
    const r = roleOf((req.headers.authorization || '').replace('Bearer ', ''));
    if (!r || (role && r !== role)) return res.status(401).json({
        error: 'not allowed'
    });
    next();
};

// ---- storage: a private GitHub repo if GH_TOKEN + GH_REPO are set, else a local file ----
const FILE = path.join(__dirname, 'grievances.json');
const {
    GH_TOKEN,
    GH_REPO
} = process.env, GH_API = process.env.GH_API || 'https://api.github.com';
const useGH = !!(GH_TOKEN && GH_REPO);
const gh = (method, body) => fetch(`${GH_API}/repos/${GH_REPO}/contents/grievances.json`, {
    method,
    headers: {
        Authorization: 'Bearer ' + GH_TOKEN,
        'User-Agent': 'grievance-portal',
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
    },
    body: body && JSON.stringify(body)
});
async function load() {
    if (!useGH) {
        try {
            return {
                data: JSON.parse(fs.readFileSync(FILE, 'utf8')),
                sha: null
            };
        } catch {
            return {
                data: [],
                sha: null
            };
        }
    }
    const r = await gh('GET');
    if (r.status === 404) return {
        data: [],
        sha: null
    };
    if (!r.ok) throw new Error('github ' + r.status);
    const j = await r.json();
    return {
        data: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8') || '[]'),
        sha: j.sha
    };
}
async function save(data, sha) {
    if (!useGH) {
        fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
        return;
    }
    const r = await gh('PUT', {
        message: 'update',
        content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
        ...(sha ? {
            sha
        } : {})
    });
    if (!r.ok) throw new Error('github ' + r.status);
}
let chain = Promise.resolve();
const mutate = fn => {
    const run = chain.then(async () => {
        const {
            data,
            sha
        } = await load();
        const out = fn(data);
        if (out) await save(data, sha);
        return out;
    });
    chain = run.catch(() => {});
    return run;
};
const wrap = fn => (req, res) => fn(req, res).catch(e => {
    console.error(e.message);
    res.status(500).json({
        error: 'server error'
    });
});

app.post('/api/login', (req, res) => {
    const {
        username = '', password = ''
    } = req.body || {};
    const u = USERS[String(username).toLowerCase()];
    if (!u || u.pass !== password) return res.status(401).json({
        error: 'bad login'
    });
    res.json({
        token: makeToken(u.role),
        role: u.role
    });
});

app.get('/api/grievances', auth(), wrap(async (req, res) => res.json((await load()).data)));

app.post('/api/grievances', auth('user'), wrap(async (req, res) => {
    const {
        title = '', body = '', feeling = ''
    } = req.body || {};
    if (!String(title).trim()) return res.status(400).json({
        error: 'title required'
    });
    const g = {
        id: String(Date.now()),
        title: String(title).slice(0, 80),
        body: String(body).slice(0, 5000),
        feeling: String(feeling).slice(0, 40),
        date: Date.now(),
        read: false
    };
    await mutate(all => {
        all.push(g);
        return g;
    });
    res.json(g);
}));

app.patch('/api/grievances/:id/read', auth('admin'), wrap(async (req, res) => {
    const val = !!(req.body && req.body.read);
    const g = await mutate(all => {
        const x = all.find(y => y.id === req.params.id);
        if (x) x.read = val;
        return x;
    });
    if (!g) return res.status(404).json({
        error: 'not found'
    });
    res.json(g);
}));

app.listen(process.env.PORT || 3000, () => console.log('Grievance portal running' + (useGH ? ' (github storage)' : ' (local file)')));