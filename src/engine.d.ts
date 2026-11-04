// Types for engine.js (plain JS ported from the HTML rebuild).

export const LEVEL_COUNT: number;
/** Enter level `index` (0-based; wraps past the last item) straight into cleaning. */
export function startLevel(index: number): void;
export function setHooks(hooks: { levelStart?: (index: number) => void; win?: () => void }): void;
export function pauseGame(): void;
export function resumeGame(): void;
/** 0–100 for the current item. */
export function getProgress(): number;
export function audioGet(key: 'sound' | 'music' | 'haptic'): boolean;
export function audioSet(key: 'sound' | 'music' | 'haptic', on: boolean): void;
