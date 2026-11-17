import { createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    QISHUI_APP_IDENTITY, QISHUI_CLIENT_KEY, QISHUI_COMMON, QISHUI_UA,
    buildCsrRequest, buildGuardInfo, createQishuiGuard, der, ecdsaRawToDer,
    QishuiError, readSessionRecord, serializeSession, toBridgeError, upstreamSentence,
} from '../../../src/nativeBridge/api/qishui.js';

// test/unit/qishui/protocolPort.test.ts
// The browser port signs with WebCrypto instead of node:crypto. These tests pin the wire format that
// differs between them (raw r||s → DER, the PKCS#10 skeleton) and the stored/errored shapes the
// renderer reads; no request leaves the process.

type Tlv = { tag: number; value: Uint8Array; start: number; end: number };

const readTlv = (input: Uint8Array, offset: number): Tlv => {
    const tag = input[offset]!;
    let length = input[offset + 1]!;
    let start = offset + 2;
    if (length & 0x80) {
        const count = length & 0x7f;
        length = 0;
        for (let index = 0; index < count; index += 1) length = length * 256 + input[start + index]!;
        start += count;
    }
    return { tag, value: input.subarray(start, start + length), start, end: start + length };
};

const indexOfBytes = (haystack: Uint8Array, needle: number[]): number => {
    for (let start = 0; start + needle.length <= haystack.length; start += 1) {
        if (needle.every((byte, index) => haystack[start + index] === byte)) return start;
    }
    return -1;
};

const base64ToBytes = (value: string): Uint8Array => {
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
};

describe('DER length encoding', () => {
    it('uses the short form below 128 bytes', () => {
        expect(Array.from(der(0x30))).toEqual([0x30, 0x00]);
        expect(Array.from(der(0x04, new Uint8Array(127))).slice(0, 2)).toEqual([0x04, 0x7f]);
    });

    it('uses 0x81 at 128 bytes and 0x82 at 256', () => {
        expect(Array.from(der(0x04, new Uint8Array(128))).slice(0, 3)).toEqual([0x04, 0x81, 0x80]);
        const long = der(0x04, new Uint8Array(256));
        expect(Array.from(long.slice(0, 4))).toEqual([0x04, 0x82, 0x01, 0x00]);
        expect(long.length).toBe(256 + 4);
    });
});

describe('ECDSA signature encoding', () => {
    it('turns raw r||s into two DER integers, padding a high bit and trimming leading zeros', () => {
        const raw = new Uint8Array(64);
        raw[31] = 0x7f; // r = 0x00..7f after stripping the leading zeros
        raw[32] = 0x80; // s starts with a high bit: DER needs a 0x00 in front
        raw[63] = 0x01;
        const sequence = ecdsaRawToDer(raw);
        const outer = readTlv(sequence, 0);
        expect(outer.tag).toBe(0x30);
        const r = readTlv(sequence, outer.start);
        const s = readTlv(sequence, r.end);
        expect(r.tag).toBe(0x02);
        expect(Array.from(r.value)).toEqual([0x7f]);
        expect(s.tag).toBe(0x02);
        expect(Array.from(s.value)).toEqual([0x00, 0x80, ...new Array(30).fill(0), 0x01]);
        expect(s.end).toBe(outer.end);
    });

    it('produces a signature node:crypto verifies with the same P-256 key', async () => {
        const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
        const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
        const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
        const info = buildGuardInfo(spki);
        const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, info));
        const signature = ecdsaRawToDer(raw);
        const publicKey = createPublicKey({ key: Buffer.from(spki), format: 'der', type: 'spki' });
        expect(verify('sha256', Buffer.from(info), publicKey, Buffer.from(signature))).toBe(true);
        // The exported PKCS#8 is what the session stores as guardKey; it must import back.
        const privateKey = createPrivateKey({ key: Buffer.from(pkcs8), format: 'der', type: 'pkcs8' });
        expect(privateKey.asymmetricKeyType).toBe('ec');
        expect(privateKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
    });
});

describe('PKCS#10 request', () => {
    it('is a base64(PEM) CSR with the car SDK subject, algorithm and BIT STRING signature', async () => {
        const guard = await createQishuiGuard();
        expect(guard.guardKey.startsWith('-----BEGIN PRIVATE KEY-----')).toBe(true);

        const pem = atob(guard.csr);
        expect(pem.startsWith('-----BEGIN CERTIFICATE REQUEST-----\n')).toBe(true);
        expect(pem.endsWith('-----END CERTIFICATE REQUEST-----\n')).toBe(true);
        const lines = pem.split('\n').slice(1, -2);
        expect(lines.every(line => line.length <= 64)).toBe(true);

        const request = base64ToBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
        const outer = readTlv(request, 0);
        expect(outer.tag).toBe(0x30);
        expect(outer.end).toBe(request.length);

        const info = readTlv(request, outer.start);
        const algorithm = readTlv(request, info.end);
        const signature = readTlv(request, algorithm.end);
        expect([info.tag, algorithm.tag, signature.tag]).toEqual([0x30, 0x30, 0x03]);
        expect(signature.end).toBe(outer.end);

        const infoText = new TextDecoder().decode(info.value);
        expect(infoText).toContain('bd-ticket-guard');
        // OID 2.5.4.3 (commonName), then ecdsa-with-SHA256 (1.2.840.10045.4.3.2).
        expect(indexOfBytes(info.value, [0x06, 0x03, 0x55, 0x04, 0x03])).toBeGreaterThan(-1);
        expect(Array.from(algorithm.value)).toEqual([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
        expect(signature.value[0]).toBe(0);

        // guardKey is the private key that signed this request; the signed bytes are the whole
        // CertificationRequestInfo TLV (the first child of the outer SEQUENCE).
        const publicKey = createPublicKey(createPrivateKey(guard.guardKey));
        const infoDer = request.subarray(outer.start, info.end);
        expect(verify('sha256', Buffer.from(infoDer), publicKey, Buffer.from(signature.value.subarray(1)))).toBe(true);
    });

    it('binds the request to the exported SubjectPublicKeyInfo', async () => {
        const spki = new Uint8Array(await crypto.subtle.exportKey('spki',
            (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair).publicKey));
        const info = buildGuardInfo(spki);
        expect(indexOfBytes(info, Array.from(spki))).toBeGreaterThan(-1);
        const request = buildCsrRequest(info, Uint8Array.of(0x30, 0x00));
        expect(readTlv(request, 0).tag).toBe(0x30);
    });
});

describe('car protocol constants', () => {
    it('carries the MD5 app identity the service expects, not a runtime MD5 implementation', () => {
        expect(QISHUI_APP_IDENTITY).toBe('82a0737a3f8d93d9958c8a7938bbc365');
        expect(QISHUI_CLIENT_KEY).toBe('aw4bbxfujo741d09');
        expect(QISHUI_UA).toBe('LunaOpenSDK/1.0.10');
        expect(QISHUI_COMMON).toMatchObject({ aid: '765213', app_id: '765213', channel: 'bydSong', device_platform: 'android' });
    });
});

describe('session serialization', () => {
    const session = {
        version: 1 as const,
        deviceId: '1234567890123456789',
        userId: 'account-1',
        user: { id: 'account-1', nickname: 'Listener', isVip: false },
        ticket: 'ticket-value',
        guardKey: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
        guardCert: 'cert-value',
        guardTsSign: 'ts-sign-value',
        accessCode: 'access-code-value',
        openId: 'open-id',
        expiresAt: Date.now() + 3600_000,
    };

    it('writes version 1 and restores the same account', () => {
        const stored = serializeSession(session);
        expect(JSON.parse(stored).version).toBe(1);
        expect(readSessionRecord(stored)).toEqual(session);
    });

    it('refuses a record that cannot carry the ticket-guard flow', () => {
        expect(readSessionRecord('{not json')).toBeNull();
        expect(readSessionRecord(JSON.stringify({ ...session, version: 2 }))).toBeNull();
        expect(readSessionRecord(JSON.stringify({ ...session, ticket: '' }))).toBeNull();
        expect(readSessionRecord(JSON.stringify({ ...session, userId: 'has space' }))).toBeNull();
        expect(readSessionRecord(JSON.stringify({ ...session, expiresAt: 'later' }))).toBeNull();
    });
});

describe('bridge error wrapping', () => {
    it('passes the package code, sentence, upstream code and sign-in stage through', () => {
        const error = new QishuiError('auth-required', 'Sign in to Qishui first', '28001003');
        expect(toBridgeError(error)).toEqual({
            code: 'auth-required', message: 'Sign in to Qishui first', upstreamCode: '28001003',
        });
        Object.assign(error, { stage: 'ticket' });
        expect(toBridgeError(error)).toEqual({
            code: 'auth-required', message: 'Sign in to Qishui first', upstreamCode: '28001003', stage: 'ticket',
        });
    });

    it('passes the platform sentence for a refusal through to the renderer', () => {
        const error = new QishuiError('unavailable', 'Qishui rejected the request', '1092');
        error.upstreamMessage = 'status=scanned description=操作过于频繁';
        expect(toBridgeError(error)).toEqual({
            code: 'unavailable', message: 'Qishui rejected the request', upstreamCode: '1092',
            upstreamMessage: 'status=scanned description=操作过于频繁',
        });
    });

    it('keeps only the status and words the platform itself wrote', () => {
        expect(upstreamSentence({ err_no: 1092, status: 'scanned', description: '操作过于频繁' }))
            .toBe('status=scanned description=操作过于频繁');
        expect(upstreamSentence({ err_no: 4, description: '参数错误', message: 'error' }))
            .toBe('description=参数错误 message=error');
        expect(upstreamSentence({ err_no: 4, message: 'success' })).toBeUndefined();
        expect(upstreamSentence({ err_no: 4 })).toBeUndefined();
        expect(upstreamSentence({ data: { error_code: 2, description: '\n 不安全的请求 \n' } }))
            .toBe('description=不安全的请求');
        expect(upstreamSentence({ err_no: 1092, data: { captcha: '1' }, message: 'SUCCESS' }))
            .toBe('captcha=required');
        expect(upstreamSentence({ err_no: 4, captcha: 'false' })).toBeUndefined();
        expect(upstreamSentence({ err_no: 1092, description: 'bad \u0007value `x`' }))
            .toBe("description=bad value 'x'");
    });

    it('turns anything else into the fixed invalid-response sentence', () => {
        expect(toBridgeError(new Error('fetch failed: https://example.test/?token=secret'))).toEqual({
            code: 'invalid-response', message: 'Qishui operation failed',
        });
    });
});
