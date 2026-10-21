// Runs in the page's own JS world (content_scripts "world": "MAIN") so it can use Steam's globals
// and dialog helpers (ShowConfirmDialog, ShowAlertDialog, $J). The extension's isolated content scripts
// call in through window.postMessage (callPage() in common.js); this side only ever replies.
(function () {
    if (typeof window.$J !== 'function' || typeof window.ShowAlertDialog !== 'function') return;

    const BLOCK_REASONS = ['Cheater', 'Scammer', 'Phisher', 'Stalker', 'Other'];
    const PLAYER_LIST_CHUNK = 100;
    const THROBBER = '<div class="group_invite_throbber"><img src="https://community.akamai.steamstatic.com/public/images/login/throbber.gif"></div>';

    function reply(msg) {
        window.postMessage({ sfeBridge: 'to-content', ...msg }, window.location.origin);
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

        blockReasonDialog({ title, description, okText, current }) {
            return showBlockReasonDialog(title, description, okText, current);
        },

        // Same modal as Steam's ShowPlayerList() ("Friends in Common"), but for an explicit list of
        // accounts, fetched in chunks so long lists don't overflow the request URL.
        // via maps accountid -> names of your friends who connect you, shown under each player.
        // Resolves 'rescan' if the user asks for a new scan, otherwise 'closed'.
        showPlayerList({ title, accountIds, note, via }) {
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
                        if (via) addViaNames($ListElement, via);
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
        const { id, type, payload } = event.data;

        const handler = handlers[type];
        if (!handler) return;
        try {
            reply({ replyTo: id, result: await handler(payload) });
        } catch (err) {
            reply({ replyTo: id, error: String(err?.message ?? err) });
        }
    });

    function addViaNames($List, via) {
        const done = new Set();
        $List.find('[data-miniprofile]').each(function () {
            const accountId = String($J(this).data('miniprofile'));
            const names = via[accountId];
            if (!names?.length || done.has(accountId)) return;
            done.add(accountId);

            const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '');
            const $Via = $J('<div/>', { 'class': 'sfe_mfic_via', title: 'via ' + names.join(', ') }).text('via ' + shown);
            const $Content = $J(this).find('.friendBlockContent, .friend_block_content').first();
            ($Content.length ? $Content : $J(this)).append($Via);
        });
    }

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
})();
