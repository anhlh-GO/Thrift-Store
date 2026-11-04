// Thrift Store: Cleaning ASMR on the FalconGame contract.
//
// One level = one item: scrub, foam, rinse and dry it (4 tool stages), then sell it to a buyer or keep it for
// display. The engine (./engine.js) owns all gameplay and its own economy; this file only maps it onto the
// contract the studio layer and Falcon IDE drive.
//
// - levelStart: the item is on the table and the first tool is ready.
// - win: the item was sold (deal resolved) or kept for display.
// - lose: never — running out of polish only opens the refill panel; the round is not lost.

import { createFalconEvents, type FalconGame } from './falcon-game';
import * as engine from './engine.js';
import './style.css';

const events = createFalconEvents();

engine.setHooks({
  levelStart: (index) => events.emit('levelStart', { index, difficulty: 'normal' }),
  win: () => events.emit('win'),
});

/** What the studio layer attaches to. See falcon-game.ts for every member. */
export const game: FalconGame = {
  getLevelCount: () => engine.LEVEL_COUNT,
  startLevel: (index) => engine.startLevel(index),
  on: events.on,
  pause: () => engine.pauseGame(),
  resume: () => engine.resumeGame(),
  getProgress: () => engine.getProgress(),
  audio: {
    set: (key, on) => engine.audioSet(key, on),
    get: (key) => engine.audioGet(key),
  },
};
