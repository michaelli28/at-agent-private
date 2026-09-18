// Seeded defect operators M1-M6: which elements each applies to, how it mutates the DOM (in Chromium), the one inline
// script it may append, and how it changes the ground-truth labels.
import {
  VariantLabelsSchema,
  variantId,
  type ElementLabel,
  type GapType,
  type OperatorId,
  type PageFlags,
  type PageLabels,
  type VariantLabels,
} from "../labels-schema.js";

// Plain JS evaluated in the page as a string: tsx injects a `__name` helper into transpiled functions, which does not
// exist inside the browser. Targets must be visible at load and outside any aria-hidden subtree.
export const IN_PAGE_LIB = String.raw`(function () {
  var CLICKABLE = 'a[href], button, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="tab"], ' +
    '[role="menuitem"], input[type="checkbox"], input[type="radio"], input[type="submit"], input[type="button"], summary';
  var NAME_ONLY = '.sr-only, .visually-hidden, svg title';
  function tagged() { return Array.prototype.slice.call(document.querySelectorAll('[data-bench-id]')); }
  function benchId(el) { return el.getAttribute('data-bench-id'); }
  function visible(el) {
    return el.getClientRects().length > 0 && el.closest('[aria-hidden="true"]') === null &&
      el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  }
  function focusable(el) { return visible(el) && el.tabIndex >= 0 && el.disabled !== true; }
  function visibleText(el) {
    var copy = el.cloneNode(true);
    copy.querySelectorAll(NAME_ONLY).forEach(function (n) { n.remove(); });
    return copy.textContent.trim();
  }
  function hasNameSource(el) {
    if ((el.getAttribute('aria-label') || '').trim() !== '' || el.hasAttribute('aria-labelledby')) return true;
    if ((el.getAttribute('title') || '').trim() !== '') return true;
    return Array.prototype.some.call(el.querySelectorAll(NAME_ONLY + ', img[alt]'), function (n) {
      return (n.tagName === 'IMG' ? n.getAttribute('alt') : n.textContent).trim() !== '';
    });
  }
  var APPLIES = {
    M1: function (el) { return el.tagName === 'BUTTON' && visible(el) && visibleText(el) !== ''; },
    M2: function (el) {
      return el.tagName !== 'BUTTON' && el.getAttribute('role') === 'button' && el.hasAttribute('tabindex') && focusable(el);
    },
    M3: function (el) { return el.matches(CLICKABLE) && focusable(el); },
    M4: function (el) {
      return (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && visible(el) &&
        visibleText(el) === '' && hasNameSource(el);
    },
    M5: focusable,
    M6: focusable
  };
  var MUTATE = {
    M1: function (el) {
      var div = document.createElement('div');
      ['data-bench-id', 'id', 'class', 'style'].forEach(function (a) {
        if (el.hasAttribute(a)) div.setAttribute(a, el.getAttribute(a));
      });
      div.style.cursor = 'pointer';
      div.style.display = 'inline-block';
      while (el.firstChild) div.appendChild(el.firstChild);
      el.replaceWith(div);
    },
    M2: function (el) { el.removeAttribute('tabindex'); },
    M3: function (el) { el.setAttribute('aria-hidden', 'true'); },
    M4: function (el) {
      ['aria-label', 'aria-labelledby', 'title'].forEach(function (a) { el.removeAttribute(a); });
      el.querySelectorAll(NAME_ONLY).forEach(function (n) { n.remove(); });
      el.querySelectorAll('img[alt]').forEach(function (n) { n.setAttribute('alt', ''); });
    },
    M5: function () {},
    M6: function () {}
  };
  // Document markup with operator scripts dropped and every tagged element collapsed to a slot, so two pages can be
  // compared outside their tagged elements.
  function untaggedMarkup() {
    var root = document.documentElement.cloneNode(true);
    root.querySelectorAll('script[data-bench-op]').forEach(function (s) { s.remove(); });
    root.querySelectorAll('[data-bench-id]').forEach(function (el) {
      var slot = document.createElement('bench-slot');
      slot.setAttribute('data-bench-id', benchId(el));
      el.replaceWith(slot);
    });
    return root.outerHTML;
  }
  window.__benchLib = {
    candidates: function (op) { return tagged().filter(APPLIES[op]).map(benchId).sort(); },
    apply: function (op, target, script) {
      MUTATE[op](document.querySelector('[data-bench-id="' + target + '"]'));
      if (script !== null) {
        var s = document.createElement('script');
        s.setAttribute('data-bench-op', op);
        s.setAttribute('data-bench-target', target);
        s.textContent = script;
        document.body.appendChild(s);
      }
      // No newline after </html>: a reparse would move it into <body> and every reload would grow the page.
      return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
    },
    snapshot: function () {
      var html = {};
      tagged().forEach(function (el) { html[benchId(el)] = el.outerHTML; });
      return {
        ids: tagged().map(benchId),
        html: html,
        scripts: Array.prototype.map.call(document.querySelectorAll('script[data-bench-op]'), function (s) {
          return {
            op: s.getAttribute('data-bench-op'),
            target: s.getAttribute('data-bench-target'),
            text: s.textContent,
            lastInBody: s.parentElement === document.body && s.nextElementSibling === null
          };
        }),
        rest: untaggedMarkup(),
        hasExternalScript: document.querySelector('script[src]') !== null
      };
    }
  };
})()`;

type Operator = {
  summary: string;
  // Page-level defects are seeded only on pages with none, so the page flag is attributable to the seed.
  pageLevel: boolean;
  // false for script-only operators (M5, M6): the target's markup is untouched and its script carries the change.
  changesMarkup: boolean;
  // Source of the single <script data-bench-op> appended as the last child of <body>, or null.
  script: ((target: string) => string) | null;
  relabel: (label: ElementLabel) => ElementLabel;
  reflag: (flags: PageFlags) => PageFlags;
  // Elements shown only through the target lose keyboard access with it.
  removesKeyboardAccess: boolean;
};

const byId = (target: string): string =>
  `document.querySelector('[data-bench-id="${target}"]')`;

function seeded(
  label: ElementLabel,
  op: OperatorId,
  change: {
    keyboardAccessible: boolean;
    gap: GapType | null;
    acceptable?: [GapType, ...GapType[]];
    what: string;
  },
): ElementLabel {
  return {
    interactive: true,
    keyboardAccessible: change.keyboardAccessible,
    expectedGapType: change.gap,
    ...(change.acceptable ? { acceptableGapTypes: change.acceptable } : {}),
    ...(label.revealedBy ? { revealedBy: label.revealedBy } : {}),
    note: `${op}: ${change.what} Base: ${label.note}`,
  };
}

const samePage = (flags: PageFlags): PageFlags => flags;

export const OPERATORS: Record<OperatorId, Operator> = {
  M1: {
    summary:
      "native <button> -> <div> with the same content and an addEventListener click handler",
    pageLevel: false,
    changesMarkup: true,
    script: (t) =>
      `${byId(t)}.addEventListener('click', function () { (window.__benchClicks = window.__benchClicks || []).push('${t}'); });`,
    relabel: (l) =>
      seeded(l, "M1", {
        keyboardAccessible: false,
        // Chromium keeps the div as an unignored `generic` AX node, so it is NOT missing from the tree.
        gap: "wrong_role",
        acceptable: ["wrong_role", "not_focusable"],
        what: "native <button> replaced by a <div> with the same content and a click listener; no role, not focusable, mouse-only.",
      }),
    reflag: samePage,
    removesKeyboardAccess: true,
  },
  M2: {
    summary: "remove tabindex from a role=button div",
    pageLevel: false,
    changesMarkup: true,
    script: null,
    relabel: (l) =>
      seeded(l, "M2", {
        keyboardAccessible: false,
        gap: "not_focusable",
        what: "tabindex removed from this role=button div; still exposed as a button but unreachable by keyboard.",
      }),
    reflag: samePage,
    removesKeyboardAccess: true,
  },
  M3: {
    summary: 'aria-hidden="true" on a visible clickable element',
    pageLevel: false,
    changesMarkup: true,
    script: null,
    relabel: (l) =>
      seeded(l, "M3", {
        keyboardAccessible: true,
        gap: "hidden_but_interactive",
        // aria-hidden really does remove it from the AX tree, so the literal type is also true.
        acceptable: ["hidden_but_interactive", "missing_from_a11y_tree"],
        what: 'aria-hidden="true" added to this visible, focusable control; keyboard still works, assistive tech cannot see it.',
      }),
    reflag: samePage,
    removesKeyboardAccess: false,
  },
  M4: {
    summary: "strip the accessible name from an icon button",
    pageLevel: false,
    changesMarkup: true,
    script: null,
    relabel: (l) =>
      seeded(l, "M4", {
        keyboardAccessible: true,
        gap: "no_accessible_name",
        what: "every name source (aria-label/labelledby, title, sr-only text, svg title, img alt) stripped from this icon-only button.",
      }),
    reflag: samePage,
    removesKeyboardAccess: false,
  },
  M5: {
    summary:
      "keydown handler that preventDefaults Tab and Shift+Tab on one element",
    pageLevel: true,
    changesMarkup: false,
    script: (t) =>
      `${byId(t)}.addEventListener('keydown', function (e) { if (e.key === 'Tab') e.preventDefault(); });`,
    relabel: (l) => ({
      ...l,
      note: `M5: a keydown handler here swallows Tab and Shift+Tab, trapping focus (page-level keyboardTrap; Escape does not release it). Base: ${l.note}`,
    }),
    reflag: (f) => ({ ...f, keyboardTrap: true, trapEscapable: false }),
    removesKeyboardAccess: false,
  },
  M6: {
    summary: "focus handler on one element that navigates to ?changed=1",
    pageLevel: true,
    changesMarkup: false,
    // The guard stops a reload loop: after the context change the new page behaves normally.
    script: (t) =>
      `${byId(t)}.addEventListener('focus', function () { if (location.search !== '?changed=1') location.search = '?changed=1'; });`,
    relabel: (l) => ({
      ...l,
      note: `M6: focusing this element navigates to ?changed=1 (page-level contextChangeOnFocus). Base: ${l.note}`,
    }),
    reflag: (f) => ({ ...f, contextChangeOnFocus: true }),
    removesKeyboardAccess: false,
  },
};

export const isCleanPage = (f: PageFlags): boolean =>
  !f.keyboardTrap && !f.contextChangeOnFocus && !f.focusLostOnArrival;

// Seeds go on accessible, gap-free, visible-at-load elements so the variant's defect is the seeded one.
export const isCleanTarget = (l: ElementLabel): boolean =>
  l.interactive &&
  l.keyboardAccessible &&
  l.expectedGapType === null &&
  l.revealedBy === undefined;

function revealedThrough(
  elements: Record<string, ElementLabel>,
  id: string,
  target: string,
): boolean {
  const seen = new Set<string>();
  let cur = elements[id]?.revealedBy;
  while (cur !== undefined && !seen.has(cur)) {
    if (cur === target) return true;
    seen.add(cur);
    cur = elements[cur]?.revealedBy;
  }
  return false;
}

export function deriveVariantLabels(
  baseId: string,
  base: PageLabels,
  op: OperatorId,
  target: string,
): VariantLabels {
  const spec = OPERATORS[op];
  const elements: Record<string, ElementLabel> = {};
  for (const [id, label] of Object.entries(base.elements)) {
    if (id === target) {
      elements[id] = spec.relabel(label);
    } else if (
      spec.removesKeyboardAccess &&
      label.keyboardAccessible &&
      revealedThrough(base.elements, id, target)
    ) {
      elements[id] = {
        ...label,
        keyboardAccessible: false,
        note: `${label.note} Unreachable by keyboard in this variant: its opener ${target} is no longer keyboard-operable (${op}).`,
      };
    } else {
      elements[id] = label;
    }
  }
  const id = variantId(baseId, op, target);
  return VariantLabelsSchema.parse({
    file: `${id}.html`,
    base: baseId,
    operator: op,
    target,
    page: spec.reflag(base.page),
    elements,
  });
}
