// Runs in the page's own JS world (content_scripts "world": "MAIN") so it can use Steam's globals
// and dialog helpers (ShowConfirmDialog, ShowAlertDialog, g_rgProfileData, g_sessionID, $J).
// Talks to the extension's isolated content scripts through window.postMessage; see callPage() in common.js.
(function () {
    if (typeof window.$J !== 'function' || typeof window.ShowAlertDialog !== 'function') return;

    const BLOCK_REASONS = ['Cheater', 'Scammer', 'Phisher', 'Stalker', 'Other'];
    const PLAYER_LIST_CHUNK = 100;
    const THROBBER = '<div class="group_invite_throbber"><img src="https://community.akamai.steamstatic.com/public/images/login/throbber.gif"></div>';

    const pending = new Map();
    let nextId = 1;

    function post(msg) {
        window.postMessage({ sfeBridge: 'to-content', ...msg }, window.location.origin);
    }

    function callContent(type, payload) {
        const id = 'page-' + nextId++;
        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            post({ id, type, payload });
        });
    }

    const handlers = {
        alert({ title, message }) {
            return new Promise(resolve => {
                ShowAlertDialog(title, $J('<div/>').text(message)).always(() => resolve());
            });
        },

        confirm({ title, message, ok }) {
            return new Promise(resolve => {
                ShowConfirmDialog(title, $J('<div/>').text(message), ok)
                    .done(() => resolve(true))
                    .fail(() => resolve(false));
            });
        },

        editBlockReason({ personaName, current }) {
            return showBlockReasonDialog('Block Reason', `Why did you block ${personaName}?`, 'Save', current);
        },

        // Same modal as Steam's ShowPlayerList() ("Friends in Common"), but for an explicit list of
        // accounts, fetched in chunks so long lists don't overflow the request URL.
        // Resolves 'rescan' if the user asks for a new scan, otherwise 'closed'.
        showPlayerList({ title, accountIds, note }) {
            return new Promise(resolve => {
                const Modal = ShowAlertDialog(title, THROBBER);
                const $ListElement = $J('<div/>', { 'class': 'player_list_ctn' });
                const $Buttons = Modal.GetContent().find('.newmodal_buttons').detach();
                Modal.GetContent().css('min-width', 268);
                Modal.always(() => resolve('closed'));

                const $Note = $J('<div/>', { 'class': 'sfe_mfic_note' }).text(note + ' ');
                $J('<a/>', { href: '#' }).text('Rescan').click(e => {
                    e.preventDefault();
                    resolve('rescan');
                    Modal.Dismiss();
                }).appendTo($Note);

                const chunks = [];
                for (let i = 0; i < accountIds.length; i += PLAYER_LIST_CHUNK) {
                    chunks.push(accountIds.slice(i, i + PLAYER_LIST_CHUNK));
                }
                Promise.all(chunks.map(chunk => new Promise((res, rej) => {
                    $J.get('https://steamcommunity.com/actions/PlayerList/', { accountids: chunk.join(',') }).done(res).fail(rej);
                }))).then(htmlParts => {
                    if (accountIds.length) {
                        $ListElement.html(htmlParts.join(''));
                    } else {
                        $ListElement.text('No mutual friends in common were found.');
                    }
                }, () => {
                    $ListElement.text('Error loading the player list. Please try again.');
                }).then(() => {
                    const $Content = Modal.GetContent().find('.newmodal_content');
                    $Content.html(''); // erase the throbber
                    $Content.append($Note, $ListElement, $Buttons);
                    Modal.AdjustSizing();
                });
            });
        }
    };

    window.addEventListener('message', async (event) => {
        if (event.source !== window || event.data?.sfeBridge !== 'to-page') return;
        const { id, type, payload, replyTo, result, error } = event.data;

        if (replyTo) {
            const call = pending.get(replyTo);
            if (!call) return;
            pending.delete(replyTo);
            error ? call.reject(new Error(error)) : call.resolve(result);
            return;
        }

        const handler = handlers[type];
        if (!handler) return;
        try {
            post({ replyTo: id, result: await handler(payload) });
        } catch (err) {
            post({ replyTo: id, error: String(err?.message ?? err) });
        }
    });

    // Resolves { category, reason } (category null when none was picked), or null if cancelled.
    function showBlockReasonDialog(title, description, okText, current) {
        const $Form = $J('<div/>', { 'class': 'sfe_block_reason_form' });
        $J('<div/>', { 'class': 'newmodal_prompt_description' }).text(description).appendTo($Form);
        $J('<div/>', { 'class': 'sfe_block_reason_label' }).text('Reason for blocking:').appendTo($Form);

        const $Other = $J('<input/>', { type: 'text', 'class': 'sfe_block_reason_other', placeholder: 'Enter a reason', maxlength: 200 });
        const $Options = $J('<div/>', { 'class': 'sfe_block_reason_options' }).appendTo($Form);
        for (const reason of BLOCK_REASONS) {
            const $Radio = $J('<input/>', { type: 'radio', name: 'sfe_block_reason', value: reason });
            if (current?.category === reason) $Radio.prop('checked', true);
            $J('<label/>', { 'class': 'sfe_block_reason_option' }).append($Radio, document.createTextNode(' ' + reason)).appendTo($Options);
        }
        $J('<div/>', { 'class': 'newmodal_prompt_input gray_bevel for_text_input fullwidth' }).append($Other).appendTo($Form);

        const isOther = () => $Form.find('input[name=sfe_block_reason]:checked').val() === 'Other';
        if (current?.category === 'Other') $Other.val(current.reason);
        $Other.prop('disabled', !isOther());
        $Options.on('change', 'input', () => {
            $Other.prop('disabled', !isOther());
            if (isOther()) $Other.focus();
        });

        return new Promise(resolve => {
            ShowConfirmDialog(title, $Form, okText).done(() => {
                const category = $Form.find('input[name=sfe_block_reason]:checked').val() ?? null;
                const reason = category === 'Other' ? ($Other.val().trim() || 'Other') : category;
                resolve({ category, reason });
            }).fail(() => resolve(null));
        });
    }

    // Replace Steam's ConfirmBlock() (profile.js) with one that also asks for a reason
    if (typeof window.ConfirmBlock === 'function') {
        window.ConfirmBlock = function () {
            const steamid = g_rgProfileData['steamid'];
            const strPersonaName = g_rgProfileData['personaname'];

            showBlockReasonDialog('Block All Communication',
                `You are about to block all communication with ${strPersonaName}.`,
                'Yes, block them'
            ).then(choice => {
                if (!choice) return;
                $J.post(
                    'https://steamcommunity.com/actions/BlockUserAjax',
                    { sessionID: g_sessionID, steamid: steamid, block: 1 }
                ).done(async () => {
                    if (choice.category) {
                        try {
                            await callContent('saveBlockReason', { steamId: steamid, personaName: strPersonaName, ...choice });
                        } catch (err) {
                            console.warn('[SteamFriendsEnhanced] Could not save block reason:', err);
                        }
                    }
                    ShowAlertDialog('Block All Communication',
                        'You have blocked all communications with this player.'
                    ).done(() => location.reload());
                }).fail(() => {
                    ShowAlertDialog('Block All Communication',
                        'Error processing your request. Please try again.'
                    );
                });
            });
        };
    }
})();
