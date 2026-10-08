// "Mutual Friends in Common": people on this profile's friends list who are friends with at least
// one of your friends (but aren't your friends already - those show under Friends in Common).
// The scan runs in background.js because it has to load one friends list per person checked.

const MFIC_PREFIX = 'mfic:';
const MFIC_REQUEST_SECONDS = 1.7; // keep in sync with REQUEST_DELAY_MS in background.js, plus request time

async function getMficJob(steamId) {
    const key = MFIC_PREFIX + steamId;
    return (await extApi.storage.local.get(key))[key] ?? null;
}

function mficStatusText(job) {
    if (!job) return '';
    if (job.status === 'running') return `scanning ${job.index}/${job.queue.length}`;
    if (job.status === 'error') return 'paused - click to resume';
    if (job.status === 'done') return `${Object.keys(job.results).length}`;
    return '';
}

function updateMutualLink(job) {
    const status = document.getElementById('sfe-mfic-status');
    if (!status) return;
    const text = mficStatusText(job);
    status.textContent = text ? ` (${text})` : '';
}

function injectMutualLink(steamId) {
    if (document.getElementById('sfe-mfic')) return;

    let link;

    // Mirror Steam's own Friends in Common entry so ours looks the same
    const fic = document.querySelector('a[href*="ShowFriendsInCommon"], [onclick*="ShowFriendsInCommon"]');
    if (fic) {
        const parent = fic.parentElement;
        const wrapper = parent && parent !== document.body && parent.children.length === 1 ? parent : fic;
        const clone = wrapper.cloneNode(true);
        link = clone.matches('a, [onclick]') ? clone : clone.querySelector('a, [onclick]');
        link.removeAttribute('onclick');
        link.setAttribute('href', '#');
        link.id = 'sfe-mfic';
        link.replaceChildren(document.createTextNode('Mutual Friends in Common'));
        wrapper.parentNode.insertBefore(clone, wrapper.nextSibling);
    } else {
        // Steam omits Friends in Common when there are none; fall back to the Friends count block
        const friendsLink = document.querySelector('.profile_friend_links .profile_count_link');
        if (!friendsLink) return;
        const row = document.createElement('div');
        row.className = 'profile_count_link ellipsis';
        link = document.createElement('a');
        link.href = '#';
        link.id = 'sfe-mfic';
        const label = document.createElement('span');
        label.className = 'count_link_label';
        label.textContent = 'Mutual Friends in Common';
        link.append(label);
        row.append(link);
        friendsLink.parentNode.insertBefore(row, friendsLink.nextSibling);
    }

    const status = document.createElement('span');
    status.id = 'sfe-mfic-status';
    status.className = 'sfe_mfic_status';
    link.append(status);

    link.addEventListener('click', (e) => {
        e.preventDefault();
        onMutualClick(steamId).catch(err => {
            console.error('[SteamFriendsEnhanced] Mutual Friends in Common failed:', err);
            callPage('alert', { title: 'Mutual Friends in Common', message: err.message });
        });
    });
}

async function onMutualClick(steamId) {
    const job = await getMficJob(steamId);

    if (job?.status === 'running') {
        await callPage('alert', {
            title: 'Mutual Friends in Common',
            message: `Still scanning: ${job.index} of ${job.queue.length} friend lists checked. You'll be notified when the list is ready.`
        });
        return;
    }

    if (job?.status === 'done') {
        const accountIds = Object.keys(job.results).map(Number);
        const privateNote = job.privateCount ? ` ${job.privateCount} of ${job.checked} friend lists were private and could not be checked.` : '';
        const action = await callPage('showPlayerList', {
            title: 'Mutual Friends in Common',
            accountIds,
            note: `Generated ${new Date(job.finishedAt).toLocaleString()}.${privateNote}`
        });
        if (action === 'rescan') await startMutualScan(steamId, { fresh: true });
        return;
    }

    await startMutualScan(steamId, { fresh: job?.status !== 'error' });
}

async function startMutualScan(steamId, { fresh }) {
    const { personaName } = getProfileInfo();
    const target = { steamId, personaName };

    if (!fresh) {
        const response = await extApi.runtime.sendMessage({ type: 'mfic:start', payload: { target, resume: true } });
        if (response?.error) throw new Error(response.error);
        return;
    }

    const mySteamId = getMySteamId();
    const [myFriends, targetFriends] = await Promise.all([
        fetchFriendAccountIds(mySteamId),
        fetchFriendAccountIds(steamId)
    ]);
    if (!myFriends) throw new Error('Could not load your own friends list.');
    if (!targetFriends) throw new Error(`${personaName}'s friends list is private, so mutual friends can't be worked out.`);

    const myAccountId = toAccountId(mySteamId);
    const mine = new Set(myFriends);
    const candidates = targetFriends.filter(id => !mine.has(id) && id !== myAccountId).length;
    const requests = Math.min(myFriends.length, candidates);
    const minutes = Math.max(1, Math.ceil(requests * MFIC_REQUEST_SECONDS / 60));

    const ok = await callPage('confirm', {
        title: 'Mutual Friends in Common',
        message: `This checks ${requests} friend lists in the background and will take about ${minutes} minute${minutes === 1 ? '' : 's'}. ` +
            `Requests are spaced out to avoid Steam's rate limits. You can keep browsing; you'll be notified when the list is ready.`,
        ok: 'Start Scan'
    });
    if (!ok) return;

    const response = await extApi.runtime.sendMessage({
        type: 'mfic:start',
        payload: { target, myAccountId, myFriends, targetFriends }
    });
    if (response?.error) throw new Error(response.error);
}

function initMutualFriends() {
    const { steamId } = getProfileInfo();
    const mySteamId = getMySteamId();
    if (!steamId || !mySteamId || steamId === mySteamId) return;

    injectMutualLink(steamId);
    getMficJob(steamId).then(updateMutualLink);

    const key = MFIC_PREFIX + steamId;
    extApi.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[key]) return;
        const { oldValue, newValue } = changes[key];
        updateMutualLink(newValue);
        if (oldValue?.status === 'running' && newValue?.status === 'done') {
            callPage('alert', {
                title: 'Mutual Friends in Common',
                message: `The list is ready: ${Object.keys(newValue.results).length} mutual friends in common found. Click "Mutual Friends in Common" to view it.`
            });
        }
    });
}

initMutualFriends();
