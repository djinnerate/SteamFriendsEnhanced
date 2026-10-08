# SteamFriendsEnhanced

This browser extension (Chrome, Brave and other Chromium browsers, plus Firefox) adds a UI to Non Friend Steam Users so they can still have Nicknames added.
Steam will often purge Nickname Data for non Friends, so this information is backed up locally in the browser. When the account is re-visited, the extension automatically re-applies the nickname if it is no longer present.\
Additionally, there will be an attempt at an additional drop down similar to an accounts previous aliases but to list alt accounts with their steam url link.

## Features

- **Add Nickname** entry in the "More" menu of non-friend profiles (`/id/...` and `/profiles/...`).
- Nicknames are saved to `storage.local` keyed by SteamID64 and re-applied on your next visit if Steam has cleared them.
  If a nickname is changed through Steam itself (e.g. the desktop client), the local backup is updated to match.
- **Mutual Friends in Common** link under Friends in Common: people on the profile's friends list who are friends with at least one of
  your friends (excluding your own friends, who already appear under Friends in Common). The scan loads one friends list per person checked,
  spaced 1.5s apart to stay under Steam's rate limits. It runs in the background, survives the worker restarting, and sends a notification
  (and an in-page alert if the profile is open) when done. The result opens in Steam's own player-list dialog, with the friends of yours who connect you to each person listed under their name. Only one scan runs at a time.
- **Block reasons:** blocking from a profile's menu asks for a reason (Cheater, Scammer, Phisher, Stalker or Other with your own text).
  The reason is shown above the profile's header actions while the user is blocked, can be edited there, and is forgotten when they're unblocked.
- Toolbar popup lists saved nicknames and block reasons. **Remove** forgets the local record only. To clear a nickname on Steam too, save an empty nickname from the profile.

`scripts/page-bridge.js` runs in the page's own JavaScript world (`"world": "MAIN"`) so it can use Steam's dialogs. The other
content scripts call it through `window.postMessage` (`callPage()` in `scripts/common.js`); it only ever replies. `scripts/block.js`
intercepts the Block menu item's click itself rather than overriding Steam's `ConfirmBlock()`.

## Installing (development)

**Chrome / Brave (111+):** open `chrome://extensions` (or `brave://extensions`), enable *Developer mode*, click *Load unpacked* and select this folder (or `dist/chrome`).

**Firefox (140+):** run `./build.sh firefox`, open `about:debugging#/runtime/this-firefox`, click *Load Temporary Add-on...* and select `dist/firefox/manifest.json`.

## Building

```sh
./build.sh            # builds dist/chrome(.zip) and dist/firefox(.zip)
./build.sh firefox    # one target only
```

`manifest.json` is the Chromium manifest. `manifest.firefox.json` is the Firefox manifest, which the build copies in as `manifest.json`.
Both manifests share the same scripts, so keep their `content_scripts` and `version` in sync.
