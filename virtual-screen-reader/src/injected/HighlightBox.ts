/**
 * Manages the visual highlight box that shows the current virtual cursor position.
 */
export class HighlightBox {
    private element: HTMLElement | null = null;

    constructor() {
        this.init();
    }

    private init(): void {
        this.element = document.getElementById('adf-highlight-box');
        if (!this.element) {
            this.element = document.createElement('div');
            this.element.id = 'adf-highlight-box';
            this.element.style.position = 'fixed';
            this.element.style.border = '2px solid red';
            this.element.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
            this.element.style.pointerEvents = 'none';
            this.element.style.zIndex = '2147483647';
            this.element.style.display = 'none';
            document.body.appendChild(this.element);
        }
    }

    update(target: HTMLElement): void {
        if (!this.element) return;
        const rect = target.getBoundingClientRect();
        this.element.style.display = 'block';
        this.element.style.left = `${rect.left}px`;
        this.element.style.top = `${rect.top}px`;
        this.element.style.width = `${rect.width}px`;
        this.element.style.height = `${rect.height}px`;
    }

    hide(): void {
        if (this.element) {
            this.element.style.display = 'none';
        }
    }
}
