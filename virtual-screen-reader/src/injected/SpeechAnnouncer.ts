import { computeAccessibleName } from 'dom-accessibility-api';
import { getRole, getHeadingLevel, getListInfo, getListItemPosition } from './accessibilityUtils';
import { NavigationTree } from './NavigationTree';

/**
 * Generates and emits screen reader announcements for elements.
 */
export class SpeechAnnouncer {
    private navigationTree: NavigationTree;

    constructor(navigationTree: NavigationTree) {
        this.navigationTree = navigationTree;
    }

    /**
     * Generate the spoken text for an element without emitting it.
     */
    getSpokenText(element: HTMLElement, action?: string): string {
        // Update navigation tree and get context
        const treeNode = this.navigationTree.visit(element, action);
        const treeContext = this.navigationTree.getTreeContext(treeNode);

        const name = computeAccessibleName(element);
        const role = getRole(element) || 'generic';
        const parts: string[] = [];

        // Add tree context at the beginning
        parts.push(treeContext);

        // Handle different element types with specific formatting
        if (role === 'heading') {
            const level = getHeadingLevel(element);
            if (level) {
                parts.push(`Heading Level ${level}`);
            } else {
                parts.push('Heading');
            }
            if (name) {
                parts.push(name);
            }
        } else if (role === 'img') {
            parts.push('Image');
            if (name) {
                parts.push(name);
            } else {
                parts.push('unlabeled');
            }
        } else if (role === 'link') {
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
        } else if (role === 'button') {
            parts.push('Button');
            if (name) {
                parts.push(name);
            }
            // Check for pressed state
            const pressed = element.getAttribute('aria-pressed');
            if (pressed === 'true') {
                parts.push('pressed');
            } else if (pressed === 'false') {
                parts.push('not pressed');
            }
            // Check for expanded state
            const expanded = element.getAttribute('aria-expanded');
            if (expanded === 'true') {
                parts.push('expanded');
            } else if (expanded === 'false') {
                parts.push('collapsed');
            }
        } else if (role === 'list') {
            const listInfo = getListInfo(element);
            if (listInfo) {
                if (listInfo.type === 'ordered') {
                    parts.push('Ordered List');
                } else {
                    parts.push('List');
                }
                parts.push(`${listInfo.itemCount} items`);
            }
            if (name) {
                parts.push(name);
            }
        } else if (role === 'listitem') {
            const posInfo = getListItemPosition(element);
            if (posInfo) {
                parts.push(`List item ${posInfo.position} of ${posInfo.total}`);
            } else {
                parts.push('List item');
            }
            if (name) {
                parts.push(name);
            }
        } else if (role === 'textbox') {
            const inputType = (element as HTMLInputElement).type || 'text';
            if (inputType === 'password') {
                parts.push('Password');
            } else if (inputType === 'search') {
                parts.push('Search');
            } else if (inputType === 'email') {
                parts.push('Email');
            } else {
                parts.push('Edit');
            }
            if (name) {
                parts.push(name);
            }
            // Add current value if any
            const value = (element as HTMLInputElement).value;
            if (value) {
                parts.push(`has text: ${value}`);
            } else {
                parts.push('blank');
            }
        } else if (role === 'navigation') {
            parts.push('Navigation');
            if (name) {
                parts.push(name);
            }
        } else if (role === 'main') {
            parts.push('Main');
            if (name) {
                parts.push(name);
            }
        } else if (role === 'banner') {
            parts.push('Banner');
            if (name) {
                parts.push(name);
            }
        } else if (role === 'contentinfo') {
            parts.push('Content Info');
            if (name) {
                parts.push(name);
            }
        } else if (role === 'complementary') {
            parts.push('Complementary');
            if (name) {
                parts.push(name);
            }
        } else if (role === 'form') {
            parts.push('Form');
            if (name) {
                parts.push(name);
            }
        } else if (role === 'region') {
            parts.push('Region');
            if (name) {
                parts.push(name);
            }
        } else {
            // Generic element - try to get some meaningful text
            const text = element.innerText?.trim();
            if (text && text.length > 0) {
                // Truncate if too long, but don't skip it
                const displayText = text.length > 200 ? text.substring(0, 200) + '...' : text;
                parts.push(displayText);
            } else if (name && name.trim().length > 0) {
                // Fallback to accessible name if no text content
                parts.push(name);
            } else {
                // Last resort: just announce the role
                parts.push(role);
            }
        }

        return parts.join(', ');
    }

    /**
     * Announce an element with full role-specific formatting.
     */
    speak(element: HTMLElement, action?: string): void {
        const output = this.getSpokenText(element, action);
        console.log(`[SR] ${output}`);

        // Log navigation stats for debugging
        const stats = this.navigationTree.getStats();
        console.log(`[SR Stats] Total nodes: ${stats.totalNodes}, Visited: ${stats.visitedNodes}, Max visits: ${stats.maxVisitCount}`);

        // Broadcast tree data for visualization
        const treeData = this.navigationTree.serialize();
        console.log(`[SR Tree] ${JSON.stringify(treeData)}`);

        // Dispatch event for the agent to catch
        window.dispatchEvent(new CustomEvent('adf-spoken-output', { detail: output }));
    }

    /**
     * Announce an arbitrary message.
     */
    announceMessage(message: string): void {
        console.log(`[SR] ${message}`);
        window.dispatchEvent(new CustomEvent('adf-spoken-output', { detail: message }));
    }
}
