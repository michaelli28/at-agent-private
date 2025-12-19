import { ScreenReader } from './ScreenReader';

// Initialize the screen reader attached to the window so we can control it if needed
(window as any).adfScreenReader = new ScreenReader();
