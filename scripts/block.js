const BLOCK_STORE_KEY = 'blockReasons';

async function getBlockReasons() {
    const result = await extApi.storage.local.get(BLOCK_STORE_KEY);
    return result[BLOCK_STORE_KEY] ?? {};
}

async function saveBlockReason(steamId, entry) {
    const all = await getBlockReasons();
    all[steamId] = { ...all[steamId], ...entry, updated: Date.now() };
    await extApi.storage.local.set({ [BLOCK_STORE_KEY]: all });
}

async function removeBlockReason(steamId) {
    const all = await getBlockReasons();
    if (!(steamId in all)) return;
    delete all[steamId];
    await extApi.storage.local.set({ [BLOCK_STORE_KEY]: all });
}

// Steam offers ConfirmUnblock() on profiles you've blocked and ConfirmBlock() on the rest.
function getBlockState() {
    if (document.querySelector('a[href*="ConfirmUnblock"], [onclick*="ConfirmUnblock"]')) return 'blocked';
    if (document.querySelector('a[href*="ConfirmBlock"], [onclick*="ConfirmBlock"]')) return 'unblocked';
    return 'unknown';
}

// Called by page-bridge.js after its ConfirmBlock() replacement has blocked the user
contentHandlers.saveBlockReason = async ({ steamId, personaName, category, reason }) => {
    const { profileUrl } = getProfileInfo();
    await saveBlockReason(steamId, { category, reason, personaName, profileUrl, blockedAt: Date.now() });
};

async function renderBlockReason() {
    const { steamId, profileUrl, personaName } = getProfileInfo();
    if (!steamId) return;

    const state = getBlockState();
    if (state === 'unblocked') {
        // Unblocked since (here or elsewhere) - the reason no longer applies
        await removeBlockReason(steamId);
        return;
    }
    if (state !== 'blocked') return;

    const saved = (await getBlockReasons())[steamId];

    document.getElementById('sfe-block-reason')?.remove();
    const banner = document.createElement('div');
    banner.id = 'sfe-block-reason';
    banner.className = 'sfe_block_reason';

    const title = document.createElement('span');
    title.className = 'sfe_block_reason_title';
    title.textContent = 'Blocked Reason: ';
    const text = document.createElement('span');
    text.className = 'sfe_block_reason_text';
    text.textContent = saved?.reason ?? 'None recorded';
    if (saved?.blockedAt) text.title = `Blocked ${new Date(saved.blockedAt).toLocaleString()}`;

    const edit = document.createElement('a');
    edit.href = '#';
    edit.className = 'sfe_block_reason_edit';
    edit.textContent = saved ? 'Edit' : 'Add reason';
    edit.onclick = async (e) => {
        e.preventDefault();
        const choice = await callPage('editBlockReason', { personaName, current: saved ?? null });
        if (!choice) return;
        if (choice.category) {
            await saveBlockReason(steamId, { category: choice.category, reason: choice.reason, personaName, profileUrl });
        } else {
            await removeBlockReason(steamId);
        }
        renderBlockReason();
    };

    banner.append(title, text, edit);

    // Sit directly above the (greyed out) Add Friend / profile actions area
    const actions = document.querySelector('.profile_header_actions');
    if (actions) {
        actions.parentNode.insertBefore(banner, actions);
    } else {
        document.querySelector('.profile_header_summary')?.append(banner);
    }
}

renderBlockReason();
