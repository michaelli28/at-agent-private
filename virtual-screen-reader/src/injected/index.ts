import { ScreenReader } from './ScreenReader';

// Prevent double initialization (script may run via both addInitScript and evaluate)
if (!(window as any).adfScreenReader) {
    (window as any).adfScreenReader = new ScreenReader();
}
