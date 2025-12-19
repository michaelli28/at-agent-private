import { computeAccessibleName } from 'dom-accessibility-api';

function getRole(element: HTMLElement): string | null {
  const explicitRole = element.getAttribute('role');
  if (explicitRole) return explicitRole;

  // Simple implicit role mapping (incomplete but sufficient for v1)
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3' || tagName === 'h4' || tagName === 'h5' || tagName === 'h6') return 'heading';
  if (tagName === 'button') return 'button';
  if (tagName === 'a' && element.hasAttribute('href')) return 'link';
  if (tagName === 'img') return 'img';
  if (tagName === 'input') return 'textbox'; // simplified
  if (tagName === 'ul' || tagName === 'ol') return 'list';
  if (tagName === 'li') return 'listitem';

  return null;
}

export class ScreenReader {
  private virtualCursor: HTMLElement | null = null;
  private highlightBox: HTMLElement | null = null;

  constructor() {
    this.initHighlightBox();
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
    console.log("In-Browser Screen Reader Initialized");
  }

  private initHighlightBox() {
    this.highlightBox = document.getElementById('adf-highlight-box');
    if (!this.highlightBox) {
      this.highlightBox = document.createElement('div');
      this.highlightBox.id = 'adf-highlight-box';
      this.highlightBox.style.position = 'fixed';
      this.highlightBox.style.border = '2px solid red';
      this.highlightBox.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
      this.highlightBox.style.pointerEvents = 'none';
      this.highlightBox.style.zIndex = '2147483647';
      this.highlightBox.style.display = 'none';
      document.body.appendChild(this.highlightBox);
    }
  }

  private handleKeyDown(event: KeyboardEvent) {
    // Only handle if we are "active" (could add a toggle)
    // For now, we intercept specific keys
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveNext();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.movePrev();
    } else if (event.key === 'h' || event.key === 'H') {
      event.preventDefault();
      this.moveToNextHeading();
    } else if (event.key === 'Enter') {
      // We don't prevent default for Enter, we let it bubble, 
      // BUT we might want to ensure focus is synced.
      if (this.virtualCursor) {
        this.virtualCursor.focus();
        this.virtualCursor.click(); // Force click for better compat
      }
    }
  }

  private moveNext() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          return this.isInteresting(node as HTMLElement);
        }
      }
    );

    if (this.virtualCursor) {
      walker.currentNode = this.virtualCursor;
    }

    if (walker.nextNode()) {
      this.setCursor(walker.currentNode as HTMLElement);
    }
  }

  private movePrev() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => this.isInteresting(node as HTMLElement)
      }
    );

    if (this.virtualCursor) {
      walker.currentNode = this.virtualCursor;
    }

    if (walker.previousNode()) {
      this.setCursor(walker.currentNode as HTMLElement);
    }
  }

  private moveToNextHeading() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          if (!this.isInteresting(node as HTMLElement)) return NodeFilter.FILTER_SKIP;
          const role = getRole(node as HTMLElement);
          return role === 'heading' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
      }
    );

    if (this.virtualCursor) {
      walker.currentNode = this.virtualCursor;
    }

    if (walker.nextNode()) {
      this.setCursor(walker.currentNode as HTMLElement);
    }
  }

  private setCursor(element: HTMLElement) {
    this.virtualCursor = element;
    element.focus();
    this.updateHighlight(element);
    this.speak(element);
  }

  private updateHighlight(element: HTMLElement) {
    if (!this.highlightBox) return;
    const rect = element.getBoundingClientRect();
    this.highlightBox.style.display = 'block';
    this.highlightBox.style.left = `${rect.left}px`;
    this.highlightBox.style.top = `${rect.top}px`;
    this.highlightBox.style.width = `${rect.width}px`;
    this.highlightBox.style.height = `${rect.height}px`;
  }

  private speak(element: HTMLElement) {
    const name = computeAccessibleName(element);
    const role = getRole(element) || 'generic';
    // Simple output format
    const output = `${role}, ${name}`;
    console.log(`[SR] ${output}`);

    // Dispatch event for the agent to catch
    window.dispatchEvent(new CustomEvent('adf-spoken-output', { detail: output }));
  }

  private isInteresting(element: HTMLElement): number {
    // Skip hidden elements
    if (element.offsetParent === null) return NodeFilter.FILTER_REJECT;

    // Use dom-accessibility-api to check if it has a role/name
    const role = getRole(element);
    const name = computeAccessibleName(element);

    if (role && role !== 'generic' && role !== 'presentation') return NodeFilter.FILTER_ACCEPT;
    if (name && name.trim().length > 0) return NodeFilter.FILTER_ACCEPT;

    // Also include text nodes? TreeWalker SHOW_ELEMENT doesn't show text nodes.
    // For now, relying on elements with roles/names is a good start.
    // If an element has text content but no role, it might be a generic div with text.
    if (element.innerText && element.innerText.trim().length > 0 && element.childElementCount === 0) {
      return NodeFilter.FILTER_ACCEPT;
    }

    return NodeFilter.FILTER_SKIP;
  }
}
