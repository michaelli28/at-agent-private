"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScreenReader = void 0;
const dom_accessibility_api_1 = require("dom-accessibility-api");
function getRole(element) {
    const explicitRole = element.getAttribute('role');
    if (explicitRole)
        return explicitRole;
    // Simple implicit role mapping (incomplete but sufficient for v1)
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3' || tagName === 'h4' || tagName === 'h5' || tagName === 'h6')
        return 'heading';
    if (tagName === 'button')
        return 'button';
    if (tagName === 'a' && element.hasAttribute('href'))
        return 'link';
    if (tagName === 'img')
        return 'img';
    if (tagName === 'input')
        return 'textbox'; // simplified
    if (tagName === 'ul' || tagName === 'ol')
        return 'list';
    if (tagName === 'li')
        return 'listitem';
    if (tagName === 'nav')
        return 'navigation';
    if (tagName === 'main')
        return 'main';
    if (tagName === 'header')
        return 'banner';
    if (tagName === 'footer')
        return 'contentinfo';
    if (tagName === 'aside')
        return 'complementary';
    if (tagName === 'section')
        return 'region';
    if (tagName === 'form')
        return 'form';
    return null;
}
function getHeadingLevel(element) {
    const tagName = element.tagName.toLowerCase();
    const match = tagName.match(/^h([1-6])$/);
    if (match)
        return parseInt(match[1], 10);
    // Check for aria-level
    const ariaLevel = element.getAttribute('aria-level');
    if (ariaLevel && element.getAttribute('role') === 'heading') {
        return parseInt(ariaLevel, 10);
    }
    return null;
}
function getListInfo(element) {
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'ul' || tagName === 'ol') {
        const items = element.querySelectorAll(':scope > li');
        return {
            type: tagName === 'ol' ? 'ordered' : 'unordered',
            itemCount: items.length
        };
    }
    return null;
}
function getListItemPosition(element) {
    if (element.tagName.toLowerCase() === 'li') {
        const parent = element.parentElement;
        if (parent && (parent.tagName.toLowerCase() === 'ul' || parent.tagName.toLowerCase() === 'ol')) {
            const items = Array.from(parent.querySelectorAll(':scope > li'));
            const position = items.indexOf(element) + 1;
            return { position, total: items.length };
        }
    }
    return null;
}
class ScreenReader {
    constructor() {
        this.virtualCursor = null;
        this.highlightBox = null;
        this.initHighlightBox();
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        console.log("In-Browser Screen Reader Initialized");
        // Initialize cursor to the first interesting element
        this.initializeCursor();
    }
    initializeCursor() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.findFirstElement());
        }
        else {
            this.findFirstElement();
        }
    }
    findFirstElement() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => this.isInteresting(node)
        });
        if (walker.firstChild()) {
            this.virtualCursor = walker.currentNode;
            this.updateHighlight(this.virtualCursor);
            // Don't announce the first element automatically
            console.log("[SR] Screen reader ready");
        }
    }
    initHighlightBox() {
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
    ensureValidCursor(walker) {
        if (this.virtualCursor && document.body.contains(this.virtualCursor)) {
            walker.currentNode = this.virtualCursor;
            return true;
        }
        else if (this.virtualCursor) {
            console.log("[SR] Virtual cursor lost, resetting");
            this.findFirstElement();
            return false;
        }
        return true; // No cursor set yet, walker will start from body
    }
    handleKeyDown(event) {
        // Only handle if we are "active" (could add a toggle)
        // For now, we intercept specific keys
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            this.moveNext();
        }
        else if (event.key === 'ArrowUp') {
            event.preventDefault();
            this.movePrev();
        }
        else if (event.key === 'h' || event.key === 'H') {
            event.preventDefault();
            if (event.shiftKey) {
                this.moveToPrevHeading();
            }
            else {
                this.moveToNextHeading();
            }
        }
        else if (event.key === 'Tab') {
            // DON'T prevent default - let native Tab work
            // We'll track where it goes and announce it
            setTimeout(() => {
                const focused = document.activeElement;
                if (focused && focused !== document.body) {
                    this.virtualCursor = focused;
                    this.updateHighlight(focused);
                    this.speak(focused);
                }
            }, 10);
        }
        else if (event.key === 'l' || event.key === 'L') {
            event.preventDefault();
            if (event.shiftKey) {
                this.moveToPrevList();
            }
            else {
                this.moveToNextList();
            }
        }
        else if (event.key === 'Enter') {
            event.preventDefault();
            if (this.virtualCursor) {
                console.log(`[SR] Activating element: ${this.virtualCursor.tagName}`);
                // Focus the element first
                this.virtualCursor.focus();
                // For links, directly navigate
                if (this.virtualCursor.tagName.toLowerCase() === 'a') {
                    const href = this.virtualCursor.getAttribute('href');
                    if (href) {
                        console.log(`[SR] Navigating to: ${href}`);
                        window.location.href = href;
                        return; // Navigation will reload page, no need to continue
                    }
                }
                // For other elements, dispatch click events
                // Use both synthetic click and native click for maximum compatibility
                this.virtualCursor.click(); // Native click first
                // Also dispatch MouseEvent for event listeners
                const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    detail: 1,
                    button: 0
                });
                this.virtualCursor.dispatchEvent(clickEvent);
                // Dispatch Enter key events for elements that listen for keyboard
                const keydownEvent = new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true
                });
                this.virtualCursor.dispatchEvent(keydownEvent);
                const keyupEvent = new KeyboardEvent('keyup', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true
                });
                this.virtualCursor.dispatchEvent(keyupEvent);
                // After clicking, re-establish cursor position by checking what's focused
                // or finding the next valid element
                setTimeout(() => {
                    const activeElement = document.activeElement;
                    if (activeElement && activeElement !== document.body && this.isInteresting(activeElement) === NodeFilter.FILTER_ACCEPT) {
                        this.setCursor(activeElement);
                    }
                    else {
                        // Find the next interesting element from current position
                        this.moveNext();
                    }
                }, 100);
            }
        }
    }
    moveNext() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => {
                return this.isInteresting(node);
            }
        });
        if (!this.ensureValidCursor(walker))
            return;
        if (walker.nextNode()) {
            this.setCursor(walker.currentNode);
        }
        else {
            this.announceMessage("End of page");
        }
    }
    movePrev() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => this.isInteresting(node)
        });
        if (!this.ensureValidCursor(walker))
            return;
        if (walker.previousNode()) {
            this.setCursor(walker.currentNode);
        }
        else {
            this.announceMessage("Top of page");
        }
    }
    moveToNextHeading() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => {
                if (!this.isInteresting(node))
                    return NodeFilter.FILTER_SKIP;
                const role = getRole(node);
                return role === 'heading' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
        });
        if (!this.ensureValidCursor(walker))
            return;
        if (walker.nextNode()) {
            this.setCursor(walker.currentNode);
        }
        else {
            this.announceMessage("No next heading");
        }
    }
    moveToPrevHeading() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => {
                if (!this.isInteresting(node))
                    return NodeFilter.FILTER_SKIP;
                const role = getRole(node);
                return role === 'heading' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
        });
        if (!this.ensureValidCursor(walker))
            return;
        if (walker.previousNode()) {
            this.setCursor(walker.currentNode);
        }
        else {
            this.announceMessage("No previous heading");
        }
    }
    moveToNextFocusable() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => {
                if (!this.isInteresting(node))
                    return NodeFilter.FILTER_SKIP;
                const role = getRole(node);
                // Focusable elements: links, buttons, inputs, etc.
                return (role === 'link' || role === 'button' || role === 'textbox')
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP;
            }
        });
        if (!this.ensureValidCursor(walker))
            return;
        if (walker.nextNode()) {
            this.setCursor(walker.currentNode);
        }
        else {
            this.announceMessage("No next focusable element");
        }
    }
    moveToPrevFocusable() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => {
                if (!this.isInteresting(node))
                    return NodeFilter.FILTER_SKIP;
                const role = getRole(node);
                return (role === 'link' || role === 'button' || role === 'textbox')
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_SKIP;
            }
        });
        if (!this.ensureValidCursor(walker))
            return;
        if (walker.previousNode()) {
            this.setCursor(walker.currentNode);
        }
        else {
            this.announceMessage("No previous focusable element");
        }
    }
    moveToNextList() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => {
                if (!this.isInteresting(node))
                    return NodeFilter.FILTER_SKIP;
                const role = getRole(node);
                return role === 'list' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
        });
        if (!this.ensureValidCursor(walker))
            return;
        if (walker.nextNode()) {
            this.setCursor(walker.currentNode);
        }
        else {
            this.announceMessage("No next list");
        }
    }
    moveToPrevList() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) => {
                if (!this.isInteresting(node))
                    return NodeFilter.FILTER_SKIP;
                const role = getRole(node);
                return role === 'list' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
            }
        });
        if (!this.ensureValidCursor(walker))
            return;
        if (walker.previousNode()) {
            this.setCursor(walker.currentNode);
        }
        else {
            this.announceMessage("No previous list");
        }
    }
    setCursor(element) {
        this.virtualCursor = element;
        // Don't call element.focus() - it interferes with TreeWalker navigation
        // Instead, just track the virtual cursor position
        this.updateHighlight(element);
        this.speak(element);
    }
    updateHighlight(element) {
        if (!this.highlightBox)
            return;
        const rect = element.getBoundingClientRect();
        this.highlightBox.style.display = 'block';
        this.highlightBox.style.left = `${rect.left}px`;
        this.highlightBox.style.top = `${rect.top}px`;
        this.highlightBox.style.width = `${rect.width}px`;
        this.highlightBox.style.height = `${rect.height}px`;
    }
    speak(element) {
        const name = (0, dom_accessibility_api_1.computeAccessibleName)(element);
        const role = getRole(element) || 'generic';
        const parts = [];
        // Handle different element types with specific formatting
        if (role === 'heading') {
            const level = getHeadingLevel(element);
            if (level) {
                parts.push(`Heading Level ${level}`);
            }
            else {
                parts.push('Heading');
            }
            if (name) {
                parts.push(name);
            }
        }
        else if (role === 'img') {
            parts.push('Image');
            if (name) {
                parts.push(name);
            }
            else {
                parts.push('unlabeled');
            }
        }
        else if (role === 'link') {
            parts.push('Link');
            // Get link text - try accessible name first, then innerText, then href
            let linkText = name;
            if (!linkText || linkText.trim().length === 0) {
                linkText = element.innerText?.trim();
            }
            if (!linkText || linkText.trim().length === 0) {
                linkText = element.getAttribute('href') || 'no text';
            }
            parts.push(linkText);
            // Check if link opens in new window/tab
            const target = element.getAttribute('target');
            if (target === '_blank') {
                parts.push('(opens in new window)');
            }
        }
        else if (role === 'button') {
            parts.push('Button');
            if (name) {
                parts.push(name);
            }
            // Check for pressed state
            const pressed = element.getAttribute('aria-pressed');
            if (pressed === 'true') {
                parts.push('pressed');
            }
            else if (pressed === 'false') {
                parts.push('not pressed');
            }
            // Check for expanded state
            const expanded = element.getAttribute('aria-expanded');
            if (expanded === 'true') {
                parts.push('expanded');
            }
            else if (expanded === 'false') {
                parts.push('collapsed');
            }
        }
        else if (role === 'list') {
            const listInfo = getListInfo(element);
            if (listInfo) {
                if (listInfo.type === 'ordered') {
                    parts.push('Ordered List');
                }
                else {
                    parts.push('List');
                }
                parts.push(`${listInfo.itemCount} items`);
            }
            if (name) {
                parts.push(name);
            }
        }
        else if (role === 'listitem') {
            const posInfo = getListItemPosition(element);
            if (posInfo) {
                parts.push(`List item ${posInfo.position} of ${posInfo.total}`);
            }
            else {
                parts.push('List item');
            }
            if (name) {
                parts.push(name);
            }
        }
        else if (role === 'textbox') {
            const inputType = element.type || 'text';
            if (inputType === 'password') {
                parts.push('Password');
            }
            else if (inputType === 'search') {
                parts.push('Search');
            }
            else if (inputType === 'email') {
                parts.push('Email');
            }
            else {
                parts.push('Edit');
            }
            if (name) {
                parts.push(name);
            }
            // Add current value if any
            const value = element.value;
            if (value) {
                parts.push(`has text: ${value}`);
            }
            else {
                parts.push('blank');
            }
        }
        else if (role === 'navigation') {
            parts.push('Navigation');
            if (name) {
                parts.push(name);
            }
        }
        else if (role === 'main') {
            parts.push('Main');
            if (name) {
                parts.push(name);
            }
        }
        else if (role === 'banner') {
            parts.push('Banner');
            if (name) {
                parts.push(name);
            }
        }
        else if (role === 'contentinfo') {
            parts.push('Content Info');
            if (name) {
                parts.push(name);
            }
        }
        else if (role === 'complementary') {
            parts.push('Complementary');
            if (name) {
                parts.push(name);
            }
        }
        else if (role === 'form') {
            parts.push('Form');
            if (name) {
                parts.push(name);
            }
        }
        else if (role === 'region') {
            parts.push('Region');
            if (name) {
                parts.push(name);
            }
        }
        else {
            // Generic element - try to get some meaningful text
            // First try innerText (actual visible text content)
            const text = element.innerText?.trim();
            if (text && text.length > 0) {
                // Truncate if too long, but don't skip it
                const displayText = text.length > 200 ? text.substring(0, 200) + '...' : text;
                parts.push(displayText);
            }
            else if (name && name.trim().length > 0) {
                // Fallback to accessible name if no text content
                parts.push(name);
            }
            else {
                // Last resort: just announce the role
                parts.push(role);
            }
        }
        // Join all parts with commas
        const output = parts.join(', ');
        console.log(`[SR] ${output}`);
        // Dispatch event for the agent to catch
        window.dispatchEvent(new CustomEvent('adf-spoken-output', { detail: output }));
    }
    announceMessage(message) {
        console.log(`[SR] ${message}`);
        window.dispatchEvent(new CustomEvent('adf-spoken-output', { detail: message }));
    }
    isInteresting(element) {
        // Skip hidden elements
        if (element.offsetParent === null)
            return NodeFilter.FILTER_REJECT;
        // Use dom-accessibility-api to check if it has a role/name
        const role = getRole(element);
        const name = (0, dom_accessibility_api_1.computeAccessibleName)(element);
        if (role && role !== 'generic' && role !== 'presentation')
            return NodeFilter.FILTER_ACCEPT;
        if (name && name.trim().length > 0)
            return NodeFilter.FILTER_ACCEPT;
        // Also include text nodes? TreeWalker SHOW_ELEMENT doesn't show text nodes.
        // For now, relying on elements with roles/names is a good start.
        // If an element has text content but no role, it might be a generic div with text.
        if (element.innerText && element.innerText.trim().length > 0 && element.childElementCount === 0) {
            return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
    }
}
exports.ScreenReader = ScreenReader;
