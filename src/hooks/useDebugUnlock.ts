import { useTapSequence } from "./useTapSequence";

const REQUIRED_TAPS = 7;
const TAP_INTERVAL_MS = 1200;

/** Hidden debug entry shared by desktop and mobile version buttons. */
export function useDebugUnlock(onUnlock: () => void): () => void {
  return useTapSequence(REQUIRED_TAPS, TAP_INTERVAL_MS, onUnlock);
}
