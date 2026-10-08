async function ShowModal() {
    // Prevent duplicate modals
    if (document.getElementById('nickname-steam-modal')) return;

    const { steamId, profileUrl, personaName } = getProfileInfo();
    if (!steamId) {
        showAlert('Could not determine the SteamID for this profile.');
        return;
    }

    // Modal overlay
    const overlay = document.createElement('div');
    overlay.id = 'nickname-steam-modal';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.background = 'rgba(0,0,0,0.5)';
    overlay.style.zIndex = '9999';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';

    // Modal HTML
    overlay.innerHTML = `
        <div class="newmodal" style="position: relative; z-index: 1000; max-width: 500px;">
            <div class="modal_top_bar"></div>
            <div class="newmodal_header_border">
                <div class="newmodal_header">
                    <div class="newmodal_close" tabindex="0" style="cursor:pointer;"></div>
                    <div class="title_text">Add Nickname</div>
                </div>
            </div>
            <div class="newmodal_content_border">
                <div class="newmodal_content">
                    <form id="nickname-form">
                        <div class="newmodal_prompt_description">
                            Add a persistent nickname to this player to keep track of who they are.
                            The nickname is backed up in your browser and re-applied if Steam clears it.
                            Leave the box empty to remove it.
                        </div>
                        <div class="newmodal_prompt_input gray_bevel for_text_input fullwidth">
                            <input type="text" id="nickname-input" class="" style="width:100%;">
                        </div>
                        <div class="newmodal_buttons" style="margin-top:16px; display:flex; gap:8px;">
                            <button type="submit" class="btn_green_white_innerfade btn_medium">
                                <span>Save Nickname</span>
                            </button>
                            <div class="btn_grey_steamui btn_medium" id="nickname-cancel" tabindex="0" style="cursor:pointer;">
                                <span>Cancel</span>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector('#nickname-input');
    const saved = await getSavedNickname(steamId);
    input.value = getDisplayedNickname() || saved?.nickname || '';
    input.focus();

    // Close modal on close button or cancel
    overlay.querySelector('.newmodal_close').onclick = () => overlay.remove();
    overlay.querySelector('#nickname-cancel').onclick = () => overlay.remove();

    // Handle form submit
    overlay.querySelector('#nickname-form').onsubmit = async (e) => {
        e.preventDefault();
        const nickname = input.value.trim();

        try {
            const applied = await setSteamNickname(steamId, nickname);
            renderNickname(applied);

            if (applied) {
                await saveNickname(steamId, { nickname: applied, personaName, profileUrl });
            } else {
                await removeSavedNickname(steamId);
            }
        } catch (err) {
            console.error('[SteamFriendsEnhanced] Error setting nickname:', err);
            showAlert('Error processing your request. Please try again.\n' + err.message);
            return;
        }

        overlay.remove();
    };
}

// Simple alert dialog
function showAlert(message) {
    alert(message);
}
