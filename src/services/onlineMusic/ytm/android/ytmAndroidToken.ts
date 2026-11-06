import { ytmNativeFetch } from './ytmNativeFetch';
import { createYtmSandbox } from './ytmAndroidSandbox';

// src/services/onlineMusic/ytm/android/ytmAndroidToken.ts
// Android App：YouTube 的音频服务器只认带「来源证明」（PoToken）的请求，没有就只给开头约 1 MB，
// 之后一律 403（2026-10-19 实测）。令牌由 Google 的 BotGuard 脚本算出来，做法同桌面版
// electron/ytm/poToken.cjs：BotGuard 在沙盒 iframe 里跑，前后两次请求（取脚本、拿答案换完整性令牌）走原生 HTTP。

// YouTube 网页播放器要 BotGuard 脚本时报的名字。
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
const SIGNALS = '__foliaYtmSignals';
const MINT = '__foliaYtmMint';
// Google 没说完整性令牌能用多久时按这个算（实测是 12 小时）。
const DEFAULT_LIFETIME_MS = 6 * 60 * 60 * 1000;

type Challenge = {
    program: string;
    globalName: string;
    interpreterJavascript?: { privateDoNotAccessOrElseSafeScriptWrappedValue?: string | null };
};

// 页面脚本：启动 BotGuard 程序，得到它的答案；它交出的铸币函数留在 iframe 里。
const runProgram = (challenge: Challenge) => `(async () => {
  const vm = globalThis[${JSON.stringify(challenge.globalName)}];
  if (!vm || typeof vm.a !== 'function') throw new Error('BotGuard is unavailable');
  let started;
  const functions = new Promise(resolve => { started = resolve; });
  const quiet = () => {};
  await vm.a(${JSON.stringify(challenge.program)}, snapshot => started(snapshot), true, undefined, quiet, [[], []], undefined, false, [quiet, quiet, quiet, quiet, quiet]);
  const snapshot = await functions;
  const signals = [];
  const answer = await new Promise(resolve => snapshot(resolve, [undefined, undefined, signals, undefined]));
  globalThis.${SIGNALS} = signals;
  return answer;
})()`;

// 页面脚本：拿完整性令牌换一个按绑定值（视频 id）铸令牌的函数。
const installMinter = (integrityToken: string) => `(async () => {
  const standard = ${JSON.stringify(integrityToken)}.split('-').join('+').split('_').join('/').split('.').join('=');
  const mint = await globalThis.${SIGNALS}[0](Uint8Array.from(atob(standard), char => char.charCodeAt(0)));
  if (typeof mint !== 'function') throw new Error('BotGuard returned no minter');
  globalThis.${MINT} = async binding => {
    const bytes = await mint(new TextEncoder().encode(binding));
    return btoa(String.fromCharCode(...bytes)).split('+').join('-').split('/').join('_');
  };
  return true;
})()`;

const mintIn = (binding: string) => `(typeof globalThis.${MINT} === 'function' ? globalThis.${MINT}(${JSON.stringify(binding)}) : null)`;

const sandbox = createYtmSandbox();

type Holder = { ready: Promise<void>; until: number | null };
let current: Holder | null = null;

const setUp = async (): Promise<number> => {
    const [{ getChallenge }, { buildURL, getHeaders }] = await Promise.all([import('bgutils-js/botguard'), import('bgutils-js/utils')]);
    const challenge = await getChallenge({ fetchFunction: ytmNativeFetch, requestKey: REQUEST_KEY, useYouTubeAPI: true }) as Challenge | undefined;
    const interpreter = challenge?.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (!challenge || !interpreter || !challenge.program || !challenge.globalName) throw new Error('BotGuard challenge is incomplete');
    // 换一次 BotGuard 就换一个 iframe，旧程序的全局变量跟着丢掉。
    sandbox.reset();
    await sandbox.evaluate(`(() => { ${interpreter}\n })(); true`);
    const answer = await sandbox.evaluate(runProgram(challenge));
    const response = await ytmNativeFetch(buildURL('GenerateIT', true), {
        method: 'POST', headers: getHeaders(), body: JSON.stringify([REQUEST_KEY, answer]),
    });
    if (!response.ok) throw new Error(`BotGuard answer was refused (status ${response.status})`);
    const [integrityToken, lifetimeSeconds] = await response.json() as [unknown, unknown];
    if (typeof integrityToken !== 'string' || !integrityToken) throw new Error('BotGuard returned no integrity token');
    await sandbox.evaluate(installMinter(integrityToken));
    console.log('[Ytm] BotGuard is ready');
    return Number(lifetimeSeconds) > 0 ? Number(lifetimeSeconds) * 1000 : DEFAULT_LIFETIME_MS;
};

// 同一时间只做一次准备，并发的调用共用它；过了令牌寿命的一半就重做。
const minter = (): Holder => {
    if (!current || (current.until !== null && Date.now() >= current.until)) {
        const holder: Holder = { ready: Promise.resolve(), until: null };
        holder.ready = setUp().then(lifetimeMs => { holder.until = Date.now() + lifetimeMs / 2; });
        holder.ready.catch(() => { if (current === holder) current = null; });
        current = holder;
    }
    return current;
};

/** 铸一个绑定到这首歌（视频 id）的令牌：只解锁这首歌的音频。 */
export const mintYtmToken = async (binding: string): Promise<string> => {
    let holder = minter();
    await holder.ready;
    let token = await sandbox.evaluate(mintIn(binding));
    if (typeof token !== 'string') {
        if (current === holder) current = null;
        holder = minter();
        await holder.ready;
        token = await sandbox.evaluate(mintIn(binding));
    }
    if (typeof token !== 'string' || !token) throw new Error('BotGuard minted no token');
    return token;
};
