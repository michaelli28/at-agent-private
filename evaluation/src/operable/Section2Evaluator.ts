import { AXNode } from '@adf/browser/types';
import { AgentTrace } from '@adf/agent/types';
import { PageMetadata, Section2CheckResult } from '../types';

export class Section2Evaluator {
  evaluate(axTree: AXNode[], trace: AgentTrace, metadata: PageMetadata): Section2CheckResult[] {
    const results: Section2CheckResult[] = [];

    results.push(...this.checkKeyboardAccessible(axTree, trace));
    results.push(...this.checkNoKeyboardTrap(trace));
    results.push(...this.checkBypassBlocks(axTree));
    results.push(...this.checkPageTitled(metadata));
    results.push(...this.checkFocusOrder(axTree, trace));
    results.push(...this.checkLinkPurpose(axTree));
    results.push(...this.checkMultipleWays(axTree)); // 2.4.5
    results.push(...this.checkHeadingsAndLabels(axTree));
    results.push(...this.checkFocusVisible(trace));

    return results;
  }

  // 2.1.1 Keyboard / 2.1.3 Keyboard (No Exception)
  private checkKeyboardAccessible(axTree: AXNode[], trace: AgentTrace): Section2CheckResult[] {
    // Heuristic: Check if interactive elements in AXTree were ever focused or acted upon in trace.
    // This is a loose check because the agent might not have tried to visit everything.
    // A better check is: did the agent try to reach something and fail? Hard to know intent.
    // For now, we'll flag interactive elements that are NOT standard interactive roles as potential issues if they have click listeners (not visible in AXTree easily).
    // Let's stick to a basic check: Are there any interactive elements that the agent *could* not reach?
    // Without comprehensive crawling, we can't be sure.
    // Let's return a 'cannot_determine' or a heuristic pass.

    return [{
      guideline: '2.1 Keyboard Accessible',
      successCriterion: '2.1.1 Keyboard',
      level: 'A',
      status: 'cannot_determine',
      evidence: {
        reason: 'Requires comprehensive manual testing or full-crawl verification to ensure ALL content is accessible.'
      }
    }];
  }

  // 2.1.2 No Keyboard Trap
  private checkNoKeyboardTrap(trace: AgentTrace): Section2CheckResult[] {
    let consecutiveStaticTabs = 0;
    let lastObservationText = '';
    let trapDetected = false;
    const evidenceEvents: string[] = [];

    for (const step of trace.steps) {
      if (step.action.type === 'KEY_PRESS' && step.action.key === 'Tab') {
        if (step.observation.text === lastObservationText) {
          consecutiveStaticTabs++;
        } else {
          consecutiveStaticTabs = 0;
        }
        lastObservationText = step.observation.text;

        if (consecutiveStaticTabs >= 5) {
          trapDetected = true;
          evidenceEvents.push(`Step ${step.stepNumber}: Focus did not change after Tab.`);
          break;
        }
      } else {
        consecutiveStaticTabs = 0;
      }
    }

    if (trapDetected) {
      return [{
        guideline: '2.1 Keyboard Accessible',
        successCriterion: '2.1.2 No Keyboard Trap',
        level: 'A',
        status: 'fail',
        evidence: {
          reason: 'Focus appears trapped. Agent pressed Tab 5+ times without context change.',
          traceEvents: evidenceEvents
        }
      }];
    }

    return [{
      guideline: '2.1 Keyboard Accessible',
      successCriterion: '2.1.2 No Keyboard Trap',
      level: 'A',
      status: 'pass',
      evidence: { reason: 'No keyboard traps detected in interaction trace.' }
    }];
  }

  // 2.4.1 Bypass Blocks
  private checkBypassBlocks(axTree: AXNode[]): Section2CheckResult[] {
    const landmarkRoles = ['banner', 'complementary', 'contentinfo', 'form', 'main', 'navigation', 'region', 'search'];
    const hasLandmark = axTree.some(node =>
      node.role?.value && typeof node.role.value === 'string' && landmarkRoles.includes(node.role.value)
    );

    // Also check for "skip" links
    const hasSkipLink = axTree.some(node =>
      node.role?.value === 'link' &&
      node.name?.value &&
      typeof node.name.value === 'string' &&
      node.name.value.toLowerCase().includes('skip')
    );

    if (hasLandmark || hasSkipLink) {
      return [{
        guideline: '2.4 Navigable',
        successCriterion: '2.4.1 Bypass Blocks',
        level: 'A',
        status: 'pass',
        evidence: { reason: `Found ${hasLandmark ? 'landmarks' : ''} ${hasSkipLink ? 'skip link' : ''}.` }
      }];
    }

    return [{
      guideline: '2.4 Navigable',
      successCriterion: '2.4.1 Bypass Blocks',
      level: 'A',
      status: 'fail',
      evidence: { reason: 'No landmarks or skip links found.' }
    }];
  }

  // 2.4.2 Page Titled
  private checkPageTitled(metadata: PageMetadata): Section2CheckResult[] {
    if (metadata.title && metadata.title.trim().length > 0) {
      return [{
        guideline: '2.4 Navigable',
        successCriterion: '2.4.2 Page Titled',
        level: 'A',
        status: 'pass',
        evidence: { reason: `Page title is present: "${metadata.title}"` }
      }];
    }
    return [{
      guideline: '2.4 Navigable',
      successCriterion: '2.4.2 Page Titled',
      level: 'A',
      status: 'fail',
      evidence: { reason: 'Page title is empty or missing.' }
    }];
  }

  // 2.4.3 Focus Order
  private checkFocusOrder(axTree: AXNode[], trace: AgentTrace): Section2CheckResult[] {
    // Difficult to fully automate without understanding "meaning".
    // Heuristic: Did the agent successfully reach its goal? If so, order was likely passable.
    // If agent failed and complained about navigation, might be a fail.
    // For now, return cannot_determine.
    return [{
      guideline: '2.4 Navigable',
      successCriterion: '2.4.3 Focus Order',
      level: 'A',
      status: 'cannot_determine',
      evidence: { reason: 'Requires manual verification of logical order.' }
    }];
  }

  // 2.4.4 Link Purpose (In Context)
  private checkLinkPurpose(axTree: AXNode[]): Section2CheckResult[] {
    const suspiciousTexts = ['click here', 'read more', 'more', 'here', 'link', 'go'];
    const failures: string[] = [];

    for (const node of axTree) {
      if (node.role?.value === 'link') {
        const name = node.name?.value;
        if (typeof name === 'string' && suspiciousTexts.includes(name.toLowerCase().trim())) {
          failures.push(`Link (ID: ${node.nodeId}) has generic text: "${name}"`);
        }
      }
    }

    if (failures.length > 0) {
      return [{
        guideline: '2.4 Navigable',
        successCriterion: '2.4.4 Link Purpose (In Context)',
        level: 'A',
        status: 'fail',
        evidence: {
          reason: 'Found links with generic text and no obvious context.',
          domNodes: failures
        }
      }];
    }

    return [{
      guideline: '2.4 Navigable',
      successCriterion: '2.4.4 Link Purpose (In Context)',
      level: 'A',
      status: 'pass',
      evidence: { reason: 'No generic link text found.' }
    }];
  }

  // 2.4.5 Multiple Ways
  private checkMultipleWays(axTree: AXNode[]): Section2CheckResult[] {
    // Heuristics for finding navigation mechanisms
    let mechanismsFound = 0;
    const mechanisms: string[] = [];

    // 1. Search
    const hasSearch = axTree.some(node =>
      node.role?.value === 'search' ||
      (node.role?.value === 'textbox' && node.name?.value?.toLowerCase().includes('search')) ||
      (node.role?.value === 'button' && node.name?.value?.toLowerCase().includes('search'))
    );
    if (hasSearch) {
      mechanismsFound++;
      mechanisms.push('Search functionality');
    }

    // 2. Navigation Landmark (Primary Nav)
    const hasNav = axTree.some(node => node.role?.value === 'navigation');
    if (hasNav) {
      mechanismsFound++;
      mechanisms.push('Navigation landmark');
    }

    // 3. Sitemap / Table of Contents (Heuristic: link text)
    const hasSitemap = axTree.some(node =>
      node.role?.value === 'link' &&
      ['sitemap', 'site map', 'table of contents', 'toc'].includes((node.name?.value as string || '').toLowerCase())
    );
    if (hasSitemap) {
      mechanismsFound++;
      mechanisms.push('Sitemap/TOC link');
    }

    // 4. List of links (if not in nav) - hard to distinguish from just content links.
    // We'll stick to the strong signals above.

    if (mechanismsFound >= 2) {
      return [{
        guideline: '2.4 Navigable',
        successCriterion: '2.4.5 Multiple Ways',
        level: 'AA',
        status: 'pass',
        evidence: { reason: `Found ${mechanismsFound} ways to locate content: ${mechanisms.join(', ')}` }
      }];
    } else if (mechanismsFound === 1) {
      // Conservative failure: If only 1 way is found, it MIGHT be a failure, but could be a process step.
      // We will mark it as 'fail' per instructions, but note the ambiguity.
      return [{
        guideline: '2.4 Navigable',
        successCriterion: '2.4.5 Multiple Ways',
        level: 'AA',
        status: 'fail',
        evidence: { reason: `Only found 1 way to locate content (${mechanisms.join(', ')}). WCAG requires > 1.` }
      }];
    }

    return [{
      guideline: '2.4 Navigable',
      successCriterion: '2.4.5 Multiple Ways',
      level: 'AA',
      status: 'fail',
      evidence: { reason: 'No standard navigation mechanisms (Search, Nav, Sitemap) found.' }
    }];
  }

  // 2.4.6 Headings and Labels
  private checkHeadingsAndLabels(axTree: AXNode[]): Section2CheckResult[] {
    const failures: string[] = [];

    // Check form controls for labels
    const formRoles = ['textbox', 'checkbox', 'radio', 'combobox', 'listbox'];
    for (const node of axTree) {
      if (node.role?.value && typeof node.role.value === 'string' && formRoles.includes(node.role.value)) {
        const name = node.name?.value;
        if (!name || (typeof name === 'string' && name.trim() === '')) {
          failures.push(`Form control (ID: ${node.nodeId}, Role: ${node.role.value}) missing accessible name.`);
        }
      }
    }

    // Check headings for emptiness
    for (const node of axTree) {
      if (node.role?.value === 'heading') {
        const name = node.name?.value;
        if (!name || (typeof name === 'string' && name.trim() === '')) {
          failures.push(`Heading (ID: ${node.nodeId}) is empty.`);
        }
      }
    }

    if (failures.length > 0) {
      return [{
        guideline: '2.4 Navigable',
        successCriterion: '2.4.6 Headings and Labels',
        level: 'AA',
        status: 'fail',
        evidence: {
          reason: 'Found form controls without labels or empty headings.',
          domNodes: failures
        }
      }];
    }

    return [{
      guideline: '2.4 Navigable',
      successCriterion: '2.4.6 Headings and Labels',
      level: 'AA',
      status: 'pass',
      evidence: { reason: 'All form controls have labels and headings are non-empty.' }
    }];
  }

  // 2.4.7 Focus Visible
  private checkFocusVisible(trace: AgentTrace): Section2CheckResult[] {
    // Heuristic: If we have snapshots, we could check for focus ring.
    // But we don't have image processing here easily.
    // We'll return cannot_determine for now, or a placeholder.
    return [{
      guideline: '2.4 Navigable',
      successCriterion: '2.4.7 Focus Visible',
      level: 'AA',
      status: 'cannot_determine',
      evidence: { reason: 'Requires visual analysis of focus indicators.' }
    }];
  }
}
