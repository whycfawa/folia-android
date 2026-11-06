const { validateRequest, requestExpression } = require('../electron/appleMusic/companionRequests.cjs');

// Runs inside the Android Apple Music WebView. Java asks for the page expression, then evaluates it
// directly so Apple's CSP never sees an eval().
window.__foliaAppleMusicBuild = function (message) {
    const request = validateRequest(message);
    return request ? requestExpression(request) : null;
};

// The page's own console is where a start that never sounds explains itself. Keep the tail on the
// page for the native diagnostics; Java forwards the same lines to logcat.
const LOG_LIMIT = 80;
window.__foliaLog = [];
const describe = argument => {
    if (typeof argument === 'string') return argument;
    try {
        return JSON.stringify(argument);
    } catch {
        return String(argument);
    }
};
for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = function (...args) {
        try {
            const line = level + ' ' + args.map(describe).join(' ');
            window.__foliaLog.push(line.slice(0, 300));
            if (window.__foliaLog.length > LOG_LIMIT) window.__foliaLog.shift();
        } catch { /* Logging must never break the page. */ }
        return original(...args);
    };
}

// Encrypted media never says out loud whether it was refused or simply never got that far. Every step
// of the CDM is recorded here: which key system was asked for and what was granted, whether keys were
// built, whether a key session ran, whether a licence request left (message) and whether one came
// back (update). The prototypes are patched, not the instances the page holds, because Blink builds
// these objects with their methods already fixed: an instance-level wrapper misses every call.
const EME_LIMIT = 40;
window.__foliaEme = [];
const noteEme = entry => {
    try {
        window.__foliaEme.push({ at: Date.now(), ...entry });
        if (window.__foliaEme.length > EME_LIMIT) window.__foliaEme.shift();
    } catch { /* The tape is a bonus. */ }
};
const nameOf = error => String((error && (error.name || error.message)) || error || '').slice(0, 80);

/** Replace one prototype method and keep the original's behaviour and rejection reason. */
const patchMethod = (prototype, name, factory) => {
    try {
        if (!prototype || typeof prototype[name] !== 'function') return;
        const original = prototype[name];
        prototype[name] = factory(original);
    } catch { /* A build that freezes the prototype still answers the rest. */ }
};

try {
    const requestAccess = navigator.requestMediaKeySystemAccess && navigator.requestMediaKeySystemAccess.bind(navigator);
    if (requestAccess) {
        navigator.requestMediaKeySystemAccess = async (keySystem, configurations) => {
            let access;
            try {
                access = await requestAccess(keySystem, configurations);
            } catch (error) {
                noteEme({ step: 'access', system: String(keySystem), ok: false, error: nameOf(error), configurations: describe(configurations).slice(0, 240) });
                throw error;
            }
            let granted = '';
            try { granted = describe(access.getConfiguration()).slice(0, 400); } catch { /* Older builds have no configuration. */ }
            noteEme({
                step: 'access',
                system: String(keySystem),
                ok: true,
                configurations: describe(configurations).slice(0, 240),
                granted,
            });
            return access;
        };
    }
} catch { /* A page without an eme table still answers the rest. */ }

const mediaKeySystemAccess = typeof MediaKeySystemAccess === 'undefined' ? null : MediaKeySystemAccess.prototype;
patchMethod(mediaKeySystemAccess, 'createMediaKeys', original => function (...args) {
    noteEme({ step: 'keys-start' });
    let result;
    try {
        result = original.apply(this, args);
    } catch (error) {
        noteEme({ step: 'keys', ok: false, error: nameOf(error) });
        throw error;
    }
    return Promise.resolve(result).then(keys => {
        noteEme({ step: 'keys', ok: true });
        return keys;
    }, error => {
        noteEme({ step: 'keys', ok: false, error: nameOf(error) });
        throw error;
    });
});

const mediaKeys = typeof MediaKeys === 'undefined' ? null : MediaKeys.prototype;
patchMethod(mediaKeys, 'createSession', original => function (...args) {
    const session = original.apply(this, args);
    try {
        noteEme({ step: 'session' });
        session.addEventListener('message', event => noteEme({
            step: 'message',
            kind: String(event && event.messageType ? event.messageType : ''),
            bytes: event && event.message ? event.message.byteLength : 0,
        }));
        session.addEventListener('keystatuseschange', () => noteEme({ step: 'keyschange' }));
    } catch { /* A session without events still plays or fails on its own. */ }
    return session;
});

const mediaKeySession = typeof MediaKeySession === 'undefined' ? null : MediaKeySession.prototype;
patchMethod(mediaKeySession, 'update', original => function (data) {
    noteEme({ step: 'update', bytes: data && data.byteLength ? data.byteLength : 0 });
    let result;
    try {
        result = original.apply(this, arguments);
    } catch (error) {
        noteEme({ step: 'update-failed', error: nameOf(error) });
        throw error;
    }
    return Promise.resolve(result).then(value => {
        noteEme({ step: 'updated' });
        return value;
    }, error => {
        noteEme({ step: 'update-failed', error: nameOf(error) });
        throw error;
    });
});
