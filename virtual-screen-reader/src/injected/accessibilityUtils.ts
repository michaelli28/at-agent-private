/**
 * Pure utility functions for extracting accessibility information from DOM elements.
 * These functions have no side effects or internal state.
 */

export interface ListInfo {
    type: 'ordered' | 'unordered';
    itemCount: number;
}

export interface ListItemPosition {
    position: number;
    total: number;
}

export function getRole(element: HTMLElement): string | null {
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
    if (tagName === 'nav') return 'navigation';
    if (tagName === 'main') return 'main';
    if (tagName === 'header') return 'banner';
    if (tagName === 'footer') return 'contentinfo';
    if (tagName === 'aside') return 'complementary';
    if (tagName === 'section') return 'region';
    if (tagName === 'form') return 'form';

    return null;
}

export function getHeadingLevel(element: HTMLElement): number | null {
    const tagName = element.tagName.toLowerCase();
    const match = tagName.match(/^h([1-6])$/);
    if (match) return parseInt(match[1], 10);

    // Check for aria-level
    const ariaLevel = element.getAttribute('aria-level');
    if (ariaLevel && element.getAttribute('role') === 'heading') {
        return parseInt(ariaLevel, 10);
    }

    return null;
}

export function getListInfo(element: HTMLElement): ListInfo | null {
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

export function getListItemPosition(element: HTMLElement): ListItemPosition | null {
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

/**
 * Returns the landmark role of an element, if any.
 * Handles both explicit ARIA roles and implicit HTML5 element roles.
 */
export function getLandmarkRole(element: HTMLElement): string | null {
    const landmarkRoles = ['banner', 'main', 'navigation', 'search', 'complementary', 'contentinfo', 'form', 'region'];

    const explicitRole = element.getAttribute('role');
    if (explicitRole && landmarkRoles.includes(explicitRole)) {
        return explicitRole;
    }

    // Implicit landmark roles from HTML5 elements
    const tagName = element.tagName.toLowerCase();

    // header/footer are only landmarks when not nested in sectioning content
    if (tagName === 'header') {
        if (!element.closest('article, aside, main, nav, section')) {
            return 'banner';
        }
    }
    if (tagName === 'footer') {
        if (!element.closest('article, aside, main, nav, section')) {
            return 'contentinfo';
        }
    }

    if (tagName === 'main') return 'main';
    if (tagName === 'nav') return 'navigation';
    if (tagName === 'aside') return 'complementary';

    // form is only a landmark when it has an accessible name
    if (tagName === 'form') {
        if (element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby') || element.hasAttribute('title')) {
            return 'form';
        }
    }

    // section is only a landmark when it has an accessible name
    if (tagName === 'section') {
        if (element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby') || element.hasAttribute('title')) {
            return 'region';
        }
    }

    return null;
}

/**
 * Checks if an element is a form field (input, select, textarea).
 */
export function isFormField(element: HTMLElement): boolean {
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'select' || tagName === 'textarea') {
        return true;
    }

    const role = element.getAttribute('role');
    return role === 'textbox' || role === 'combobox' || role === 'listbox' ||
           role === 'spinbutton' || role === 'slider' || role === 'checkbox' || role === 'radio';
}

/**
 * Checks if an element is a button.
 */
export function isButton(element: HTMLElement): boolean {
    if (element.tagName.toLowerCase() === 'button') return true;
    if (element.getAttribute('role') === 'button') return true;

    // input type="button", type="submit", type="reset"
    if (element.tagName.toLowerCase() === 'input') {
        const type = element.getAttribute('type');
        return type === 'button' || type === 'submit' || type === 'reset';
    }

    return false;
}

/**
 * Checks if an element is a table.
 */
export function isTable(element: HTMLElement): boolean {
    return element.tagName.toLowerCase() === 'table' ||
           element.getAttribute('role') === 'table' ||
           element.getAttribute('role') === 'grid';
}

/**
 * Checks if an element is a link.
 */
export function isLink(element: HTMLElement): boolean {
    if (element.tagName.toLowerCase() === 'a' && element.hasAttribute('href')) {
        return true;
    }
    return element.getAttribute('role') === 'link';
}
