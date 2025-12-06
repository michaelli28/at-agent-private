/**
 * Callbacks for keyboard events.
 */
export interface KeyboardCallbacks {
    // Basic navigation
    onNavigateNext: () => void;
    onNavigatePrev: () => void;
    onNextHeading: () => void;
    onPrevHeading: () => void;
    onNextList: () => void;
    onPrevList: () => void;
    onTabFocus: (element: HTMLElement) => void;
    onActivate: () => void;

    // Landmark navigation
    onNextLandmark: () => void;
    onPrevLandmark: () => void;
    onJumpToMain: () => void;

    // Element type navigation
    onNextButton: () => void;
    onPrevButton: () => void;
    onNextFormField: () => void;
    onPrevFormField: () => void;
    onNextTable: () => void;
    onPrevTable: () => void;
    onNextLink: () => void;
    onPrevLink: () => void;

    // Heading level navigation
    onNextHeadingLevel: (level: number) => void;
    onPrevHeadingLevel: (level: number) => void;

    // History navigation
    onGoBack: () => void;
    onGoForward: () => void;

    // Auto-traverse
    onAutoTraverse: () => void;
    onStopTraverse: () => void;
    onInstantTraverse: () => void;
}

/**
 * Handles keyboard event dispatch for screen reader navigation.
 */
export class KeyboardHandler {
    private callbacks: KeyboardCallbacks;
    private boundHandler: (event: KeyboardEvent) => void;

    constructor(callbacks: KeyboardCallbacks) {
        this.callbacks = callbacks;
        this.boundHandler = this.handleKeyDown.bind(this);
    }

    attach(): void {
        document.addEventListener('keydown', this.boundHandler);
    }

    detach(): void {
        document.removeEventListener('keydown', this.boundHandler);
    }

    private handleKeyDown(event: KeyboardEvent): void {
        const key = event.key;

        // Basic navigation
        if (key === 'ArrowDown') {
            event.preventDefault();
            this.callbacks.onNavigateNext();
        } else if (key === 'ArrowUp') {
            event.preventDefault();
            this.callbacks.onNavigatePrev();
        } else if (key === 'h' || key === 'H') {
            event.preventDefault();
            if (event.shiftKey) {
                this.callbacks.onPrevHeading();
            } else {
                this.callbacks.onNextHeading();
            }
        } else if (key === 'Tab') {
            // DON'T prevent default - let native Tab work
            // We'll track where it goes and announce it
            setTimeout(() => {
                const focused = document.activeElement as HTMLElement;
                if (focused && focused !== document.body) {
                    this.callbacks.onTabFocus(focused);
                }
            }, 10);
        } else if (key === 'l' || key === 'L') {
            event.preventDefault();
            if (event.shiftKey) {
                this.callbacks.onPrevList();
            } else {
                this.callbacks.onNextList();
            }
        } else if (key === 'Enter' || key === ' ') {
            event.preventDefault();
            this.callbacks.onActivate();
        }
        // Landmark navigation
        else if (key === 'd' || key === 'D') {
            event.preventDefault();
            if (event.shiftKey) {
                this.callbacks.onPrevLandmark();
            } else {
                this.callbacks.onNextLandmark();
            }
        } else if (key === 'q' || key === 'Q') {
            event.preventDefault();
            this.callbacks.onJumpToMain();
        }
        // Element type navigation
        else if (key === 'b' || key === 'B') {
            event.preventDefault();
            if (event.shiftKey) {
                this.callbacks.onPrevButton();
            } else {
                this.callbacks.onNextButton();
            }
        } else if (key === 'f' || key === 'F') {
            event.preventDefault();
            if (event.shiftKey) {
                this.callbacks.onPrevFormField();
            } else {
                this.callbacks.onNextFormField();
            }
        } else if (key === 't' || key === 'T') {
            event.preventDefault();
            if (event.shiftKey) {
                this.callbacks.onPrevTable();
            } else {
                this.callbacks.onNextTable();
            }
        } else if (key === 'k' || key === 'K') {
            event.preventDefault();
            if (event.shiftKey) {
                this.callbacks.onPrevLink();
            } else {
                this.callbacks.onNextLink();
            }
        }
        // Heading level navigation (1-6)
        else if (['1', '2', '3', '4', '5', '6'].includes(key)) {
            event.preventDefault();
            const level = parseInt(key, 10);
            if (event.shiftKey) {
                this.callbacks.onPrevHeadingLevel(level);
            } else {
                this.callbacks.onNextHeadingLevel(level);
            }
        }
        // History navigation (Backspace = back, Shift+Backspace = forward)
        else if (key === 'Backspace') {
            event.preventDefault();
            if (event.shiftKey) {
                this.callbacks.onGoForward();
            } else {
                this.callbacks.onGoBack();
            }
        }
        // Auto-traverse (Cmd/Ctrl+Shift+Down)
        else if (key === 'ArrowDown' && event.shiftKey && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            this.callbacks.onAutoTraverse();
        }
        // Stop traversal (Escape)
        else if (key === 'Escape') {
            event.preventDefault();
            this.callbacks.onStopTraverse();
        }
        // Instant full traversal (Shift+A)
        else if ((key === 'a' || key === 'A') && event.shiftKey) {
            event.preventDefault();
            this.callbacks.onInstantTraverse();
        }
    }
}
