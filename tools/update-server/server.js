// tools/update-server/server.js
// 自建更新服务：管理页上传 APK 与更新说明，客户端拉清单后弹窗。只依赖 express + multer。
// 数据全部落在本目录 data/ 下：releases.json 记版本，apk/ 存安装包。

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const express = require('express');
const multer = require('multer');

const PORT = Number(process.env.PORT || 8787);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const COOKIE_NAME = 'folia_update_admin';
const APP_ID = 'top.izuna.foliamajor';
const CHANNELS = new Set(['stable', 'beta']);
const MAX_APK_BYTES = 120 * 1024 * 1024;

if (!ADMIN_PASSWORD) {
    console.error('[update-server] ADMIN_PASSWORD is required (set it in the environment).');
    process.exit(1);
}

// 数据目录可用 DATA_DIR 覆盖（测试或多实例时用），默认就是本目录下的 data/。
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const apkDir = path.join(dataDir, 'apk');
const manifestFile = path.join(dataDir, 'releases.json');
fs.mkdirSync(apkDir, { recursive: true });

/**
 * 从 APK 自己读出包名与 versionCode：手填容易填错（版本名里的数字不是它），
 * aapt2 就在 Android SDK 的 build-tools 里，找不到时退回手填值。
 */
const findAapt2 = () => {
    if (process.env.AAPT2 && fs.existsSync(process.env.AAPT2)) return process.env.AAPT2;
    const exe = process.platform === 'win32' ? 'aapt2.exe' : 'aapt2';
    const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(os.homedir(), 'Android', 'Sdk')]
        .filter(root => root && fs.existsSync(root));
    for (const root of roots) {
        const buildTools = path.join(root, 'build-tools');
        if (!fs.existsSync(buildTools)) continue;
        const versions = fs.readdirSync(buildTools).sort().reverse();
        for (const version of versions) {
            const candidate = path.join(buildTools, version, exe);
            if (fs.existsSync(candidate)) return candidate;
        }
    }
    return null;
};

const readApkFacts = (file) => new Promise((resolve) => {
    const aapt2 = findAapt2();
    if (!aapt2) {
        resolve(null);
        return;
    }
    execFile(aapt2, ['dump', 'badging', file], { timeout: 20000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
        if (error || !stdout) {
            resolve(null);
            return;
        }
        const appId = /package: name='([^']+)'/.exec(stdout)?.[1] || '';
        const versionCode = Number(/versionCode='(\d+)'/.exec(stdout)?.[1]);
        const versionName = /versionName='([^']*)'/.exec(stdout)?.[1] || '';
        resolve(Number.isFinite(versionCode) && versionCode > 0 ? { appId, versionCode, versionName } : null);
    });
});

const readManifest = () => {
    try {
        const parsed = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

const writeManifest = async (manifest) => {
    const temp = manifestFile + '.tmp';
    await fsp.writeFile(temp, JSON.stringify(manifest, null, 2), 'utf8');
    await fsp.rename(temp, manifestFile);
};

const tokenFor = () => crypto.createHmac('sha256', ADMIN_PASSWORD).update(COOKIE_NAME).digest('hex');
const isAdmin = (req) => {
    const raw = req.headers.cookie || '';
    const match = raw.split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE_NAME + '='));
    if (!match) return false;
    const value = match.slice(COOKIE_NAME.length + 1);
    const expected = tokenFor();
    return value.length === expected.length
        && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected));
};

const app = express();
// 穿透（cloudflared / frp）会把 https 转成 http 回源：相信代理给的 X-Forwarded-Proto，
// 否则清单里的 apkUrl 会写成 http://，安卓直接拒绝下载。
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, apkDir),
        filename: (_req, file, cb) => {
            const safe = String(file.originalname || 'update.apk').replace(/[^A-Za-z0-9._-]/g, '_');
            cb(null, Date.now() + '-' + safe);
        },
    }),
    limits: { fileSize: MAX_APK_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, /\.apk$/i.test(file.originalname || '')),
});

/** 公开清单：只回客户端需要的字段。 */
app.get('/api/update', (req, res) => {
    const platform = String(req.query.platform || 'android');
    const channel = CHANNELS.has(String(req.query.channel)) ? String(req.query.channel) : 'stable';
    const clientVersion = Number(req.query.versionCode || 0);
    const release = readManifest()?.[platform]?.[channel];
    if (!release) {
        res.json({ update: null });
        return;
    }
    const newer = Number(release.versionCode) > clientVersion;
    const tooOld = clientVersion > 0 && clientVersion < Number(release.minSupportedVersionCode || 0);
    res.json({
        update: newer || tooOld
            ? {
                versionCode: release.versionCode,
                versionName: release.versionName,
                notes: release.notes || '',
                mandatory: Boolean(release.mandatory) || tooOld,
                minSupportedVersionCode: release.minSupportedVersionCode || 0,
                size: release.size,
                sha256: release.sha256,
                apkUrl: req.protocol + '://' + req.get('host') + '/downloads/' + encodeURIComponent(release.file),
                publishedAt: release.publishedAt,
            }
            : null,
    });
});

app.get('/downloads/:file', (req, res) => {
    const name = path.basename(String(req.params.file || ''));
    const file = path.join(apkDir, name);
    if (!name || !fs.existsSync(file)) {
        res.status(404).json({ error: 'not found' });
        return;
    }
    res.sendFile(file);
});

app.post('/admin/login', (req, res) => {
    const password = String(req.body?.password || '');
    const expected = Buffer.from(ADMIN_PASSWORD);
    const given = Buffer.from(password);
    const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
    if (!ok) {
        res.status(401).json({ error: 'wrong password' });
        return;
    }
    res.setHeader('Set-Cookie', COOKIE_NAME + '=' + tokenFor() + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000');
    res.json({ ok: true });
});

app.post('/admin/logout', (_req, res) => {
    res.setHeader('Set-Cookie', COOKIE_NAME + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.json({ ok: true });
});

app.get('/admin/state', (req, res) => {
    if (!isAdmin(req)) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    res.json({ releases: readManifest() });
});

app.post('/admin/publish', (req, res, next) => {
    if (!isAdmin(req)) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    next();
}, upload.single('apk'), async (req, res) => {
    const file = req.file;
    const cleanup = async () => { if (file) await fsp.unlink(file.path).catch(() => {}); };
    try {
        if (!file) {
            res.status(400).json({ error: 'APK is required' });
            return;
        }
        const platform = String(req.body.platform || 'android');
        const channel = CHANNELS.has(String(req.body.channel)) ? String(req.body.channel) : 'stable';
        // 以 APK 自己写的为准；只有读不出来时才用表单里手填的值。
        const apkFacts = await readApkFacts(file.path);
        if (apkFacts?.appId && apkFacts.appId !== APP_ID) {
            await cleanup();
            res.status(400).json({ error: 'this APK belongs to ' + apkFacts.appId + ', not ' + APP_ID });
            return;
        }
        const submittedCode = Number(req.body.versionCode);
        const versionCode = apkFacts?.versionCode ?? submittedCode;
        const versionName = String(req.body.versionName || '').trim() || apkFacts?.versionName || '';
        const notes = String(req.body.notes || '');
        const mandatory = String(req.body.mandatory) === 'true';
        const minSupportedVersionCode = Number(req.body.minSupportedVersionCode || 0);
        if (!Number.isInteger(versionCode) || versionCode <= 0) {
            await cleanup();
            res.status(400).json({ error: 'versionCode is unknown: it could not be read from the APK, and none was given' });
            return;
        }
        if (!versionName) {
            await cleanup();
            res.status(400).json({ error: 'versionName is required' });
            return;
        }
        const manifest = readManifest();
        const current = manifest?.[platform]?.[channel];
        if (current && versionCode <= Number(current.versionCode)) {
            await cleanup();
            res.status(400).json({ error: 'versionCode must be greater than the published ' + current.versionCode });
            return;
        }
        const bytes = await fsp.readFile(file.path);
        if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
            await cleanup();
            res.status(400).json({ error: 'not a zip/apk file' });
            return;
        }
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        if (current && current.file && current.file !== file.filename) {
            await fsp.unlink(path.join(apkDir, current.file)).catch(() => {});
        }
        manifest[platform] = manifest[platform] || {};
        manifest[platform][channel] = {
            versionCode,
            versionName,
            notes,
            mandatory,
            minSupportedVersionCode: Number.isFinite(minSupportedVersionCode) ? minSupportedVersionCode : 0,
            file: file.filename,
            size: bytes.length,
            sha256,
            appId: APP_ID,
            publishedAt: new Date().toISOString(),
        };
        await writeManifest(manifest);
        console.log('[update-server] published', platform, channel, versionCode, versionName, bytes.length + 'B',
            apkFacts ? '(version read from the APK)' : '(version typed by hand)');
        res.json({ ok: true, release: manifest[platform][channel], source: apkFacts ? 'apk' : 'form' });
    } catch (error) {
        await cleanup();
        console.error('[update-server] publish failed', error);
        res.status(500).json({ error: 'publish failed' });
    }
});

app.post('/admin/unpublish', async (req, res) => {
    if (!isAdmin(req)) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const platform = String(req.body?.platform || 'android');
    const channel = String(req.body?.channel || 'stable');
    const manifest = readManifest();
    if (manifest?.[platform]?.[channel]) {
        delete manifest[platform][channel];
        await writeManifest(manifest);
    }
    res.json({ ok: true });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// 上传过大或格式不对：multer 抛的错走这里，回 JSON 而不是默认的 HTML 错误页。
app.use((error, _req, res, _next) => {
    if (error && (error.code === 'LIMIT_FILE_SIZE' || error.name === 'MulterError')) {
        res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'APK is too large' : 'upload rejected' });
        return;
    }
    console.error('[update-server] request failed', error);
    res.status(500).json({ error: 'request failed' });
});

app.listen(PORT, () => {
    console.log('[update-server] listening on http://127.0.0.1:' + PORT);
});
