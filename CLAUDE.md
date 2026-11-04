# Thrift Store: Cleaning ASMR — notes for the AI assistant

This is a Falcon web game: Vite + TypeScript, built to ONE `dist/index.html`, shipped inside the Falcon shell app.

## The game runs on the Falcon Game Client SDK

`src/game.ts` exports `game: FalconGame` and `src/main.ts` hands it to `registerFalconGame(game)`
(see `src/falcon-game.ts` for every member). That call boots the ALWAYS-ON half of the SDK — the shell bridge,
the save (`userData`) and level analytics (`log_level`: a turn opens on `levelStart`, closes on `win`/`lose`).
Keep the contract honest:

- `startLevel(index)` (0-based) lands STRAIGHT in gameplay: close your own menus, splash and popups yourself.
- Emit `levelStart` when the board is ready to play (every start and restart, never only at boot).
- Emit `win` when the level is cleared, `lose` when the round is lost.
- `pause()` / `resume()` freeze time and input.

## How this game maps onto the contract

- **One level = one item.** 80 levels (`LEVEL_COUNT` = the 80 items in `assets/data.json`), in a fixed seeded
  order (`ORDER` in `src/engine.js`); no Rare item in the first 4 levels. Past the last level it wraps to 0.
- `levelStart` fires in `startItem()` once stage 0 is painted and input is open.
- `win` fires when the item is resolved: sold (after the haggle and sale toast) or kept for display.
  After a sale the game moves on itself with `startLevel(LEVEL + 1)`. After "Keep for Display" it opens Decorate
  (`openDecorate({ focus, thenNext: true })`): the kept item is first in the tray and highlighted, the empty slots
  it fits glow, and Done (`leaveDecorate()`) goes to the next level. Decorate opened from the menu returns to the menu.
- `lose` is never emitted: running out of polish opens the refill panel (wait / watch ad / 5 gems); the round goes on.
- `pause()` blocks tool input and ducks the music (pauseDuck 0.3, from the original AudioManager).
- `audio.set/get` map sound/music/haptic onto the game's own settings toggles.

## Code layout

- `src/engine.js` — all gameplay (plain JS, ported from the HTML rebuild): tween engine with DOTween easings,
  wipe-reveal cleaning, tools, polish meter, haggle, power-ups, daily goals, shop tiers, display, settings.
  It reports the lifecycle through `setHooks()` and never imports the SDK.
- `src/engine.d.ts` — its types. Keep in sync when engine exports change.
- `src/game.ts` — the FalconGame adapter. `src/style.css` — all styling (720×1280 portrait frame, scaled to fit).
- `index.html` — the screens and panels. Static images use `data-src="img/…"`; `initView()` resolves them.
- `src/assets/` — `items/` (80 items × 5 cleaning stages), `ui/`, `snd/`, `fonts/`, `data.json`.
  Every asset is reached through `import.meta.glob` in engine.js (`U("img/ui/coin.webp")`, `SND_URL(name)`),
  so the build inlines it. Do not reference asset paths any other way.
- Numbers in `data.json` (items, tools, power-ups, tiers, goals, sound bank, panel show/hide styles, core loop)
  were decoded from the original Unity build: change gameplay feel in engine.js, not by editing that data.

## Decorate (menu → Decorate, section "Decorate" in engine.js)

- Rebuilt from DisplayRoomPanel / DisplaySlotView / DisplayTrayCellView. Room art `room_1..3` follows the shop tier.
- `data.json` → `displaySlots[tier]`: the 26 slots read from the Unity scene (centre-origin, y-up, on 1080×1920;
  `slotRect()` maps them to the 720×1280 `#room` layer, which is positioned exactly like `.bgimg` so slots stay on
  the art at any frame size). `items[].displayCategory` (Hangable / Shelf) decides which slots an item fits.
- Save: `S.display` = kept items, `S.placed[tier][slotId] = itemId`. The tray shows kept items not placed in the
  current tier; the menu badge counts them.
- Drag from the tray (horizontal swipe scrolls it instead), drop on a slot of the same category; dropping on a
  filled slot swaps (room→room) or sends the old item back to the tray (tray→room); drag a placed item onto the
  tray to unplace it; tap a placed item to sell it (`displayPrice`) or send it back.
- Tuning from the scene, in `data.json` → `decorate`: trayScrollSeconds 0.25, dragGhostSize 240, dragGhostLift 70,
  dropPadding 25 (all on the 1080-wide layout, scaled by `RS`).

## Optional features: build them when asked, in THIS game's own style

Ads, shop/IAP, lives, remove-ads, boosters, a next-level flow — none of these is pre-built or forbidden.
When the developer asks for one, BUILD IT: design the UI to match the game, and drive it through the SDK
(the logic — store calls, ad calls, lives regen, purchase grants — is the SDK's job, never re-implement it):

- Get the SDK instance from `registerFalconGame`'s return value, or `import FalconSDK from
  '@falcongames/game-client-sdk'` anywhere (same instance once registered).
- Module configs go through the second argument: `registerFalconGame(game, { ads: { minLevel: 10 },
  lives: { max: 5, regenSec: 1800 }, shop: { enabled: true }, packs: [...] })`. A module is OFF until it
  gets a config (SDK 1.3); off modules answer locally (`ads.showRewarded()` → false, lives stay full).
- Call sites: `SDK.ads.showRewarded()` / `SDK.ads.maybeShowInterstitial(level)`, `SDK.shop.open()`,
  `SDK.iap.onGrant(...)`, `SDK.lives.*`, `SDK.removeAds.*`, `SDK.analytics.turn.tick(dt)` /
  `turn.useBooster(key)` for richer analytics.
- Let feature UI check its module (`SDK.ads.enabled`, `SDK.shop.isEnabled()`) and hide when off: at
  publish time the server's CMS switches have the FINAL word — a module the server turns off is off in the
  shipped build, one it turns on is on — whatever the code passed.

Today the game's own "Watch Ad for Full Refill" and coin/gem shop are local placeholders (free / simulated):
wire them to `SDK.ads.showRewarded()` and `SDK.shop` when ads and IAP are wanted.

Do NOT: edit `src/falcon-game.ts` (IDE-owned), call `FalconSDK.init()` yourself (`registerFalconGame`
already did; a second init is ignored with FSDK-001), or hard-code a `gameId` anywhere — it is set to the
game's package name at publish time.

## Working here

- `npm run dev` or the IDE's Preview runs the game. `?level=N` jumps to a level.
- `npm run build` must keep producing exactly one file, `dist/index.html`.
- Assets go through Vite imports so they are inlined into that one file.
- The studio-layer numbers a reviewer may tune live in `.falcon/sdk-config.json`.
