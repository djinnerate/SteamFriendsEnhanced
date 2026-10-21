// Background scan for "Mutual Friends in Common" (see scripts/mutual.js).
// Runs as an MV3 service worker in Chrome/Brave and as a non-persistent background script in Firefox.
// Progress is checkpointed to storage after every request, so a scan resumes if the worker is restarted.

const extApi = globalThis.browser ?? globalThis.chrome;

const JOB_PREFIX = 'mfic:';
const REQUEST_DELAY_MS = 1500;
const MAX_RATE_LIMIT_RETRIES = 5;
const STEAMID64_BASE = 76561197960265728n;

let activeJob = null;

class RateLimitError extends Error {}

function toSteamId64(accountId) {
    return (STEAMID64_BASE + BigInt(accountId)).toString();
}

// Chrome stops an idle service worker after 30s, and timers don't count as activity.
// Calling an extension API at least every 20s keeps it alive while we wait.
async function sleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        await new Promise(resolve => setTimeout(resolve, Math.min(20000, end - Date.now())));
        await extApi.runtime.getPlatformInfo();
    }
}

// Friend blocks on /friends/ pages are <div id="fr_<accountid>" ...>. Returns null when the list isn't visible.
function parseFriendAccountIds(html) {
    const ids = [...html.matchAll(/id="fr_(\d+)"/g)].map(m => Number(m[1]));
    if (ids.length === 0 && html.includes('profile_private_info')) return null;
    return ids;
}

async function fetchFriendAccountIds(accountId) {
    const url = `https://steamcommunity.com/profiles/${toSteamId64(accountId)}/friends/`;
    for (let attempt = 0; ; attempt++) {
        let response;
        try {
            response = await fetch(url, { credentials: 'include' });
        } catch (err) {
            if (attempt >= 2) return null;
            await sleep(5000);
            continue;
        }

        if (response.status === 429) {
            if (attempt >= MAX_RATE_LIMIT_RETRIES) throw new RateLimitError();
            await sleep(15000 * 2 ** attempt); // 15s, 30s, 1m, 2m, 4m
            continue;
        }
        if (!response.ok) {
            if (response.status < 500 || attempt >= 2) return null;
            await sleep(5000);
            continue;
        }
        return parseFriendAccountIds(await response.text());
    }
}

async function getJob(steamId) {
    const key = JOB_PREFIX + steamId;
    return (await extApi.storage.local.get(key))[key] ?? null;
}

async function setJob(job) {
    await extApi.storage.local.set({ [JOB_PREFIX + job.target.steamId]: job });
}

async function findRunningJob() {
    const all = await extApi.storage.local.get(null);
    return Object.entries(all)
        .filter(([key, job]) => key.startsWith(JOB_PREFIX) && job?.status === 'running')
        .map(([, job]) => job)[0] ?? null;
}

function notify(job, message) {
    extApi.notifications.create(JOB_PREFIX + job.target.steamId, {
        type: 'basic',
        iconUrl: extApi.runtime.getURL('images/steam.png'),
        title: `Mutual Friends in Common: ${job.target.personaName}`,
        message
    });
}

async function runJob(steamId) {
    if (activeJob) return;
    activeJob = steamId;
    try {
        let job = await getJob(steamId);
        if (job?.status !== 'running') return;

        // mode 'mine': walk your friends' lists looking for the target's friends.
        // mode 'theirs': walk the target's friends' lists looking for your friends.
        const lookFor = new Set(job.lookFor);
        while (job.index < job.queue.length) {
            const accountId = job.queue[job.index];
            const friends = await fetchFriendAccountIds(accountId);

            if (friends === null) {
                job.privateCount++;
            } else {
                const hits = friends.filter(id => lookFor.has(id));
                if (job.mode === 'mine') {
                    for (const hit of hits) (job.results[hit] ??= []).push(accountId);
                } else if (hits.length) {
                    job.results[accountId] = hits;
                }
            }

            job.index++;
            await setJob(job);
            if (job.index < job.queue.length) await sleep(REQUEST_DELAY_MS);
        }

        job = {
            status: 'done',
            target: job.target,
            results: job.results,
            privateCount: job.privateCount,
            checked: job.queue.length,
            startedAt: job.startedAt,
            finishedAt: Date.now()
        };
        await setJob(job);
        notify(job, `The list is ready: ${Object.keys(job.results).length} mutual friends in common found.`);
    } catch (err) {
        const job = await getJob(steamId);
        if (job) {
            job.status = 'error';
            job.error = err instanceof RateLimitError
                ? 'Steam is rate limiting requests.'
                : String(err?.message ?? err);
            await setJob(job);
            notify(job, `Scan paused (${job.error}) Open the profile and click Mutual Friends in Common to resume.`);
        }
        console.error('[SteamFriendsEnhanced] Mutual friends scan failed:', err);
    } finally {
        activeJob = null;
    }
}

async function startJob({ target, resume, myAccountId, myFriends, targetFriends }) {
    const running = await findRunningJob();
    if (running && running.target.steamId !== target.steamId) {
        throw new Error(`Already scanning ${running.target.personaName}'s friends (${running.index}/${running.queue.length}). Please wait for it to finish.`);
    }

    const existing = await getJob(target.steamId);
    if (existing?.status === 'running' || (resume && existing?.status === 'error')) {
        existing.status = 'running';
        delete existing.error;
        await setJob(existing);
        runJob(target.steamId);
        return { ok: true };
    }

    const mine = new Set(myFriends);
    const candidates = targetFriends.filter(id => !mine.has(id) && id !== myAccountId);
    const iterateMine = myFriends.length <= candidates.length;

    await setJob({
        status: 'running',
        target,
        mode: iterateMine ? 'mine' : 'theirs',
        queue: candidates.length ? (iterateMine ? myFriends : candidates) : [],
        lookFor: iterateMine ? candidates : myFriends,
        index: 0,
        results: {},
        privateCount: 0,
        startedAt: Date.now()
    });
    runJob(target.steamId);
    return { ok: true };
}

extApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'mfic:start') return;
    startJob(message.payload).then(sendResponse, err => sendResponse({ error: err.message }));
    return true;
});

extApi.notifications.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith(JOB_PREFIX)) return;
    extApi.tabs.create({ url: `https://steamcommunity.com/profiles/${notificationId.slice(JOB_PREFIX.length)}/` });
    extApi.notifications.clear(notificationId);
});

// Pick an interrupted scan back up whenever the worker starts
findRunningJob().then(job => job && runJob(job.target.steamId));
