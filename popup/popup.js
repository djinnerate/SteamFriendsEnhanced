const extApi = globalThis.browser ?? globalThis.chrome;

// Each section renders one storage map of { steamId: entry }; Remove only forgets the local record.
const SECTIONS = [
    {
        key: 'nicknames',
        list: 'nicknames',
        empty: 'nicknames-empty',
        label: entry => entry.nickname,
        removeTitle: 'Stop re-applying this nickname (does not clear it on Steam)'
    },
    {
        key: 'blockReasons',
        list: 'blocked',
        empty: 'blocked-empty',
        label: entry => entry.personaName || 'Unknown',
        detail: entry => entry.reason,
        removeTitle: 'Forget this block reason (does not unblock on Steam)'
    }
];

async function renderSection(section) {
    const all = (await extApi.storage.local.get(section.key))[section.key] ?? {};
    const list = document.getElementById(section.list);
    list.replaceChildren();

    const entries = Object.entries(all).sort(([, a], [, b]) => section.label(a).localeCompare(section.label(b)));
    document.getElementById(section.empty).hidden = entries.length > 0;

    for (const [steamId, entry] of entries) {
        const li = document.createElement('li');

        const names = document.createElement('div');
        names.className = 'names';
        const link = document.createElement('a');
        link.href = `https://steamcommunity.com/profiles/${steamId}`;
        link.target = '_blank';
        link.textContent = section.label(entry);
        names.append(link);

        if (section.detail) {
            const detail = document.createElement('span');
            detail.className = 'persona reason';
            detail.textContent = section.detail(entry);
            names.append(detail);
        }
        const persona = document.createElement('span');
        persona.className = 'persona';
        persona.textContent = entry.personaName && !section.detail ? `${entry.personaName} · ${steamId}` : steamId;
        names.append(persona);

        const remove = document.createElement('button');
        remove.textContent = 'Remove';
        remove.title = section.removeTitle;
        remove.onclick = async () => {
            const current = (await extApi.storage.local.get(section.key))[section.key] ?? {};
            delete current[steamId];
            await extApi.storage.local.set({ [section.key]: current });
            renderSection(section);
        };

        li.append(names, remove);
        list.append(li);
    }
}

SECTIONS.forEach(renderSection);
