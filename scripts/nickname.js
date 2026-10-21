// Steam's own menu already offers a nickname option for friends; only add ours when it is missing.
function hasNativeNicknameOption(menu) {
    return Array.from(menu.querySelectorAll('a.popup_menu_item')).some(a =>
        a.id !== 'sfe-add-nickname' &&
        (/nickname/i.test(a.getAttribute('href') ?? '') ||
         /nickname/i.test(a.getAttribute('onclick') ?? '') ||
         a.textContent.includes('Nickname')));
}

function injectNicknameLink() {
    // Insert the <a> element into the target div only if not already present
    const targetDiv = document.querySelector('.popup_body.popup_menu.shadow_content');
    if (!targetDiv || document.getElementById('sfe-add-nickname') || hasNativeNicknameOption(targetDiv)) return;

    const link = document.createElement('a');
    link.id = 'sfe-add-nickname';
    link.className = 'popup_menu_item';
    link.href = '#';
    link.onclick = function(e) {
        e.preventDefault();
        // HideMenu() lives in the page's world and isn't reachable from a content script
        const dropdown = document.getElementById('profile_action_dropdown');
        if (dropdown) dropdown.style.display = 'none';
        document.getElementById('profile_action_dropdown_link')?.classList.remove('focus');
        ShowModal();
    };
    link.innerHTML = `
        <img src="https://community.akamai.steamstatic.com/public/images/skin_1/notification_icon_edit_bright.png">
        &nbsp; Add Nickname
    `;
    targetDiv.appendChild(link);
}

// If a nickname was backed up locally and Steam has since dropped it, put it back.
async function reapplySavedNickname() {
    const { steamId, profileUrl, personaName } = getProfileInfo();
    if (!steamId) return;

    const saved = await getSavedNickname(steamId);
    if (!saved?.nickname) return;

    const displayed = getDisplayedNickname();
    if (displayed === saved.nickname) return;

    if (displayed) {
        // Changed through Steam itself (e.g. the desktop client) - treat that as the new value
        await saveNickname(steamId, { ...saved, nickname: displayed, personaName, profileUrl });
        return;
    }

    try {
        const applied = await setSteamNickname(steamId, saved.nickname);
        renderNickname(applied);
        console.info(`[SteamFriendsEnhanced] Re-applied nickname "${applied}" for ${steamId}`);
        await saveNickname(steamId, { ...saved, personaName, profileUrl });
    } catch (err) {
        console.warn('[SteamFriendsEnhanced] Could not re-apply saved nickname:', err);
    }
}

injectNicknameLink();
reapplySavedNickname();
