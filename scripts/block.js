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

// Replaces Steam's ConfirmBlock() flow with one that also asks for a reason.
async function blockWithReason() {
    const { steamId, profileUrl, personaName } = getProfileInfo();
    if (!steamId) return;

    const title = 'Block All Communication';
    const choice = await callPage('blockReasonDialog', {
        title,
        description: `You are about to block all communication with ${personaName}.`,
        okText: 'Yes, block them'
    });
    if (!choice) return;

    // Saved before blocking so the reason survives even if the page is closed or reloaded mid-request
    if (choice.category) {
        await saveBlockReason(steamId, { category: choice.category, reason: choice.reason, personaName, profileUrl, blockedAt: Date.now() });
    }

    try {
        await setSteamBlocked(steamId, true);
    } catch (err) {
        console.error('[SteamFriendsEnhanced] Block failed:', err);
        if (choice.category) await removeBlockReason(steamId);
        await callPage('alert', { title, message: 'Error processing your request. Please try again.' });
        return;
    }

    await callPage('alert', { title, message: 'You have blocked all communications with this player.' });
    // Steam renders the blocked state server-side, so reload like its own ConfirmBlock() does
    location.reload();
}

// Catch the "Block All Communication" menu item before Steam's own handler runs.
// Capturing at the document fires ahead of the link's inline onclick, and preventDefault stops its javascript: href.
function interceptBlockLinks() {
    document.addEventListener('click', (e) => {
        const link = e.target.closest?.('a[href*="ConfirmBlock"], [onclick*="ConfirmBlock"]');
        if (!link) return;
        e.preventDefault();
        e.stopImmediatePropagation();

        const dropdown = document.getElementById('profile_action_dropdown');
        if (dropdown) dropdown.style.display = 'none';
        document.getElementById('profile_action_dropdown_link')?.classList.remove('focus');

        blockWithReason().catch(err => console.error('[SteamFriendsEnhanced] Block failed:', err));
    }, true);
}

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
        const choice = await callPage('blockReasonDialog', {
            title: 'Block Reason',
            description: `Why did you block ${personaName}?`,
            okText: 'Save',
            current: saved ?? null
        });
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

interceptBlockLinks();
renderBlockReason();
