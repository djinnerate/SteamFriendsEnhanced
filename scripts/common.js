// Shared helpers for the content scripts. Content scripts are loaded as classic
// scripts in manifest order and share one isolated scope, so everything declared
// here is visible to nickname.js and modal.js.

// Firefox exposes promise-based `browser.*`; Chrome/Brave MV3 `chrome.*` also returns promises.
const extApi = globalThis.browser ?? globalThis.chrome;

const NICKNAME_STORE_KEY = 'nicknames';

// Content scripts run in an isolated world and cannot read page globals such as
// g_rgProfileData or g_sessionID, so pull what we need from the DOM, inline scripts and cookies.
function getProfileInfo() {
    let steamId = null;
    let profileUrl = null;

    for (const script of document.querySelectorAll('script:not([src])')) {
        const text = script.textContent;
        if (!text.includes('g_rgProfileData')) continue;

        const json = text.match(/g_rgProfileData\s*=\s*(\{.*?\});\s*$/m);
        if (json) {
            try {
                const data = JSON.parse(json[1]);
                steamId = data.steamid ?? null;
                profileUrl = data.url ?? null;
            } catch {
                // Fall through to the regex below
            }
        }
        if (!steamId) {
            steamId = text.match(/"steamid"\s*:\s*"(\d{17})"/)?.[1] ?? null;
        }
        break;
    }

    if (!steamId) {
        steamId = window.location.pathname.match(/^\/profiles\/(\d{17})/)?.[1] ?? null;
    }

    const personaName = document.querySelector('.persona_name .actual_persona_name')?.textContent.trim() ?? '';

    return { steamId, profileUrl: profileUrl || window.location.href.split(/[?#]/)[0], personaName };
}

function getSessionId() {
    const cookie = document.cookie.match(/(?:^|;\s*)sessionid=([^;]+)/);
    if (cookie) return decodeURIComponent(cookie[1]);

    const input = document.querySelector('input[name="sessionid"]');
    if (input?.value) return input.value;

    for (const script of document.querySelectorAll('script:not([src])')) {
        const match = script.textContent.match(/g_sessionID\s*=\s*"([^"]+)"/);
        if (match) return match[1];
    }
    return null;
}

// In Firefox, content.fetch() sends the request as the page would (same Origin/cookies),
// which Steam's AJAX endpoints expect. Chrome content scripts already behave that way.
function pageFetch(url, options) {
    if (typeof content !== 'undefined' && typeof content.fetch === 'function') {
        return content.fetch(url, options);
    }
    return fetch(url, options);
}

// Sets (or clears, with an empty string) the Steam nickname. Resolves to the nickname Steam reports.
async function setSteamNickname(steamId, nickname) {
    const sessionId = getSessionId();
    if (!sessionId) throw new Error('Could not find a Steam session. Are you logged in?');

    const response = await pageFetch(`https://steamcommunity.com/profiles/${steamId}/ajaxsetnickname/`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body: new URLSearchParams({ nickname, sessionid: sessionId })
    });
    if (!response.ok) throw new Error(`Steam returned HTTP ${response.status}`);

    const data = await response.json();
    if (data.success !== 1 && data.success !== true) {
        throw new Error(`Steam rejected the nickname (success=${data.success})`);
    }
    return data.nickname ?? '';
}

// The nickname Steam rendered into the profile header, or '' if none.
function getDisplayedNickname() {
    const el = document.querySelector('.persona_name .nickname');
    if (!el || el.style.display === 'none') return '';
    return el.textContent.trim().replace(/^\((.*)\)$/, '$1').trim();
}

function renderNickname(nickname) {
    let target = document.querySelector('.persona_name .nickname');
    if (!nickname) {
        if (target) target.style.display = 'none';
        return;
    }
    if (!target) {
        const personaName = document.querySelector('.persona_name');
        if (!personaName) return;
        target = document.createElement('span');
        target.className = 'nickname';
        const nameHistoryLink = personaName.querySelector('.namehistory_link');
        if (nameHistoryLink && nameHistoryLink.parentNode === personaName) {
            personaName.insertBefore(target, nameHistoryLink);
        } else {
            personaName.appendChild(target);
        }
    }
    target.textContent = `(${nickname}) `;
    target.style.display = '';
}

async function getSavedNicknames() {
    const result = await extApi.storage.local.get(NICKNAME_STORE_KEY);
    return result[NICKNAME_STORE_KEY] ?? {};
}

async function getSavedNickname(steamId) {
    return (await getSavedNicknames())[steamId] ?? null;
}

async function saveNickname(steamId, entry) {
    const all = await getSavedNicknames();
    all[steamId] = { ...entry, updated: Date.now() };
    await extApi.storage.local.set({ [NICKNAME_STORE_KEY]: all });
}

async function removeSavedNickname(steamId) {
    const all = await getSavedNicknames();
    delete all[steamId];
    await extApi.storage.local.set({ [NICKNAME_STORE_KEY]: all });
}

const STEAMID64_BASE = 76561197960265728n;

function toAccountId(steamId64) {
    return Number(BigInt(steamId64) - STEAMID64_BASE);
}

// The logged-in user's SteamID64, or null when logged out (Steam sets g_steamID = false).
function getMySteamId() {
    for (const script of document.querySelectorAll('script:not([src])')) {
        const match = script.textContent.match(/g_steamID\s*=\s*"(\d{17})"/);
        if (match) return match[1];
    }
    return null;
}

// Friend blocks on /friends/ pages are <div id="fr_<accountid>" ...>. Returns null when the list isn't visible.
function parseFriendAccountIds(html) {
    const ids = [...html.matchAll(/id="fr_(\d+)"/g)].map(m => Number(m[1]));
    if (ids.length === 0 && html.includes('profile_private_info')) return null;
    return [...new Set(ids)];
}

async function fetchFriendAccountIds(steamId64) {
    const response = await pageFetch(`https://steamcommunity.com/profiles/${steamId64}/friends/`, { credentials: 'include' });
    if (!response.ok) throw new Error(`Steam returned HTTP ${response.status}`);
    return parseFriendAccountIds(await response.text());
}

// --- Bridge to scripts/page-bridge.js, which runs in the page's world and can use Steam's own dialogs ---

const pageCalls = new Map();
const contentHandlers = {};
let nextPageCallId = 1;

function postToPage(msg) {
    window.postMessage({ sfeBridge: 'to-page', ...msg }, window.location.origin);
}

function callPage(type, payload) {
    const id = 'content-' + nextPageCallId++;
    return new Promise((resolve, reject) => {
        pageCalls.set(id, { resolve, reject });
        postToPage({ id, type, payload });
    });
}

window.addEventListener('message', async (event) => {
    if (event.source !== window || event.data?.sfeBridge !== 'to-content') return;
    const { id, type, payload, replyTo, result, error } = event.data;

    if (replyTo) {
        const call = pageCalls.get(replyTo);
        if (!call) return;
        pageCalls.delete(replyTo);
        error ? call.reject(new Error(error)) : call.resolve(result);
        return;
    }

    const handler = contentHandlers[type];
    if (!handler) return;
    try {
        postToPage({ replyTo: id, result: await handler(payload) });
    } catch (err) {
        postToPage({ replyTo: id, error: String(err?.message ?? err) });
    }
});
