import { IAccessibilityDriver } from '@adf/drivers/src/IAccessibilityDriver';
import { UserAction } from '@adf/drivers/src/types';
import { AgentTrace, AgentStep, LLMClient, LLMResponse } from './types';

export class Agent {
  private maxSteps = 200;

  constructor(
    private driver: IAccessibilityDriver,
    private llm: LLMClient
  ) { }

  async run(goal: string): Promise<AgentTrace> {
    console.log('\n' + '='.repeat(80));
    console.log('ACCESSIBILITY AGENT STARTING');
    console.log('='.repeat(80));
    console.log(`GOAL: "${goal}"`);
    console.log(`DRIVER: ${this.driver.name}`);
    console.log('='.repeat(80));

    await this.driver.enable();

    const trace: AgentTrace = {
      goal,
      success: false,
      steps: []
    };

    try {
      for (let i = 0; i < this.maxSteps; i++) {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`STEP ${i + 1}`);
        console.log('='.repeat(80));

        // 1. Observe
        const observation = await this.driver.getPerceptualOutput();
        console.log(`SCREEN READER OUTPUT: "${observation.text}"`);

        // 2. Plan (Construct Prompt & Call LLM)
        const prompt = this.constructPrompt(goal, trace.steps, observation);
        const response = await this.llm.generate(prompt);

        console.log(`LLM THOUGHT: ${response.thought}`);

        // Check for completion
        if (response.done) {
          trace.success = response.success || false;
          console.log(`\n${'='.repeat(80)}`);
          console.log(`FINISHED - Success: ${trace.success}`);
          console.log('='.repeat(80));
          break;
        }

        // Display action
        const actionStr = response.action.type === 'KEY_PRESS'
          ? `Press Key: ${response.action.key}`
          : JSON.stringify(response.action);
        console.log(`ACTION: ${actionStr}`);

        // 3. Act
        const result = await this.driver.performAction(response.action);

        // Display result
        console.log(`RESULT: ${result.success ? '[SUCCESS]' : '[FAILED]'} ${result.snapshot.text}`);
        if (result.message) {
          console.log(`   Message: ${result.message}`);
        }

        // 4. Record
        const step: AgentStep = {
          stepNumber: i + 1,
          observation,
          thought: response.thought,
          action: response.action,
          result
        };
        trace.steps.push(step);

        if (!result.success) {
          console.warn(`WARNING: Action failed: ${result.message}`);
        }
      }
    } catch (error: any) {
      trace.error = error.message;
      console.error(`[Agent] Error:`, error);
    } finally {
      await this.driver.disable();
    }

    return trace;
  }

  private constructPrompt(goal: string, history: AgentStep[], current: any): string {
    const historyText = history.map(h =>
      `Step ${h.stepNumber}:
       - Observed: "${h.observation.text}"
       - Action: ${JSON.stringify(h.action)}
       - Result: ${h.result.success ? 'Success' : 'Failed: ' + h.result.message}`
    ).join('\n');

    // Detect repeated observations (stuck detection)
    const recentObs = history.slice(-5).map(h => h.observation.text);
    const lastObs = current.text;
    const repeatCount = recentObs.filter(obs => obs === lastObs).length;
    const stuckWarning = repeatCount >= 2
      ? `\n⚠️ WARNING: You've seen "${lastObs}" ${repeatCount + 1} times. You may be stuck! Try a different command.`
      : '';

    return `
You are an assistive technology user interacting with a web page via a Screen Reader.
Your Goal: "${goal}"

Current Screen Reader Output: "${current.text}"
${stuckWarning}

History:
${historyText}

## ⛔ SYSTEM CONSTRAINTS - THESE ARE HARD LIMITS ⛔

This is NOT a normal web browser. This is a screen reader with LIMITED key support.

**NAVIGATION KEYS AVAILABLE:**
1. ArrowDown - move to next element
2. ArrowUp - move to previous element
3. H - jump to next heading
4. Shift+H - jump to previous heading
5. L - jump to next list
6. Shift+L - jump to previous list
7. Enter - activate current element

**TEXT INPUT AVAILABLE:**
- When focused on an input field (Edit, Search, etc.), you can TYPE text
- Use `{ "type": "TYPE", "text": "your query here" }` to enter text
- Then press Enter to submit

**FORBIDDEN:**
- ❌ Tab/Shift+Tab → System will crash with "infinite loop" - DO NOT USE!

**YOU CANNOT:**
- Use Tab key (it doesn't exist in this system)
- Use any keyboard shortcuts except the navigation keys above

## Understanding Screen Reader Navigation Model

**CRITICAL CONCEPT**: Screen readers use a VIRTUAL CURSOR that navigates through the page's content TREE:
- The page is a TREE of elements: headings, paragraphs, links, buttons, images, etc.
- ArrowDown/ArrowUp move through EVERY element in tree order (depth-first traversal)
- H/Shift+H jump to specific node types (headings only)
- L/Shift+L jump to specific node types (lists only)

**Tab key is BROKEN** - it uses browser focus, NOT the virtual cursor tree, and causes getting stuck.

**How to navigate**:
1. **ArrowDown** = Move to NEXT element in content tree (goes INTO sections, reads everything)
2. **H** = Skip forward in tree to NEXT heading (jumps OVER content between headings)
3. **Enter** = Activate current element (click links/buttons)
4. **ArrowUp/Shift+H** = Go BACKWARDS in tree

**Example Tree**:
```
Banner
├─ Link, Skip to main content
├─ Link, Home
├─ Link, About
└─ Button, Search
Heading Level 1, Welcome
├─ Paragraph text
├─ Link, Learn more
└─ Image, Photo
Heading Level 2, Features
├─ List, 3 items
│  ├─ List item 1
│  ├─ List item 2
│  └─ List item 3
└─ Button, Sign up
```

**ArrowDown** from Banner → Link Skip → Link Home → Link About → Button Search → Heading Welcome → Paragraph → Link Learn more → Image → Heading Features → List → Item 1 → Item 2 → Item 3 → Button Sign up

**H** from Banner → Heading Welcome → Heading Features (skips all the links/buttons/content in between)

## Screen Reader Navigation Strategies

You navigate like an experienced screen reader user (based on WebAIM surveys).
Experienced users DON'T read pages linearly - they use efficient jumping strategies.

### Available Navigation Commands

**Heading Navigation** (Primary strategy - used by 71.6% of screen reader users):
- 'H' → Jump to next heading (use to scan page structure quickly)
- 'Shift+H' → Jump to previous heading

**List Navigation**:
- 'L' → Jump to next list
- 'Shift+L' → Jump to previous list

**Sequential Reading** (Use when you find relevant content):
- 'ArrowDown' → Read next element (reads everything: headings, links, text, buttons)
- 'ArrowUp' → Read previous element

**Activation**:
- 'Enter' → Activate current element (click links, press buttons, submit forms)

**❌ NEVER USE THESE KEYS - THEY ARE BROKEN ❌**:
- **Tab / Shift+Tab** - DO NOT USE! Tab uses browser focus instead of virtual cursor and will cause you to get STUCK
- Single letter keys like K, F, B, D, E, R, G, T - not implemented
- Number keys 1-6 for heading levels - not implemented
- Landmark navigation - not implemented

**If you use Tab, you WILL get stuck and repeat the same output forever!**

## Strategic Navigation Patterns

### Pattern 0: Explore Header First (NEW PAGE PRIORITY)
**When**: Just landed on a new page OR just loaded a page
**Why**: Headers contain critical navigation menus and links to key sections
**Strategy**:
1. Use ArrowDown 5-10 times to explore header elements
2. Look for:
   - Navigation menus (Admissions, Academics, Research, etc.)
   - Links to key sections relevant to your goal
   - Utility links (Current Students, Faculty, Alumni, etc.)
3. If you find a relevant nav link, activate it with Enter
4. Only AFTER exploring the header, use H to scan main content headings

**Example**: Goal is "Find tuition information"
- ArrowDown → "Banner"
- ArrowDown → "Link, Skip to main content" (skip utility links are fine to ignore)
- ArrowDown → "Link, Current Students" (not directly relevant)
- ArrowDown → "Link, Admissions" (RELEVANT! Tuition is often under Admissions)
- Enter → Navigate to Admissions

**IMPORTANT**: DO NOT skip the header with H key immediately. The header is WHERE navigation lives!

### Pattern 1: Quick Page Scan (Heading Overview)
**When**: After exploring header, need to understand main content structure
**Strategy**:
1. Press 'H' 5-10 times to scan main headings and build mental outline
2. Look for headings relevant to your goal
3. Once you find a relevant heading, STOP using H

**Example**: Goal is "Find pricing information"
- H → "About Us" (not relevant)
- H → "Features" (not relevant)
- H → "Pricing" (RELEVANT! Stop here)
- ArrowDown → Read pricing details

### Pattern 2: Deep Content Exploration
**When**: You've found a relevant section, need to read details
**Strategy**:
1. Use ArrowDown to read every element in the section
2. Continue until you find what you need OR hit the next heading
3. ArrowDown reveals: text, links, buttons, images, lists

**Example**: You're at "Heading Level 2, Products"
- ArrowDown → "Our premium product line"
- ArrowDown → "Link, Product A - $99"
- ArrowDown → "Link, Product B - $149"
- ArrowDown → "Button, Add to Cart"

### Pattern 3: Skip Irrelevant Sections
**When**: You're in a section that's not relevant to your goal
**Strategy**:
1. If you've read 3-5 elements with ArrowDown and none are relevant
2. Press H to jump to the next section heading
3. Resume ArrowDown in the new section

**Example**: Goal is "Find contact info", you're in footer
- ArrowDown → "Copyright 2024"
- ArrowDown → "Privacy Policy"
- ArrowDown → "Terms of Service" (all irrelevant)
- H → "Contact Us" (relevant! Now use ArrowDown)

### Pattern 4: Find and Activate Links/Buttons
**When**: You need to click something
**Strategy**:
1. Navigate to the link/button with ArrowDown (NOT Tab or H)
2. When screen reader says "Link, [text]" or "Button, [text]"
3. Press Enter to activate

**Example**: Need to click "Sign Up" button
- ArrowDown → "Link, Home"
- ArrowDown → "Link, About"
- ArrowDown → "Button, Sign Up" (found it!)
- Enter → Activate

## Command Selection Guide

| Your Goal | Best Approach | Commands to Use |
|-----------|---------------|-----------------|
| **Just landed on new page** | **EXPLORE HEADER FIRST (Pattern 0)** | **ArrowDown 5-10 times to find navigation** |
| Find navigation to goal | Explore header/nav | ArrowDown in header, Enter on relevant link |
| Understand page structure | Quick scan headings | H (5-10 times) AFTER header |
| Find specific section | Scan headings until found | H until relevant, then ArrowDown |
| Read section content | Sequential reading | ArrowDown repeatedly |
| Find a link/button | Sequential reading | ArrowDown until found, then Enter |
| Skip irrelevant section | Jump to next section | H to next heading |
| Go back | Reverse navigation | ArrowUp or Shift+H |
| You're stuck (same output 3x) | Change strategy | Try ArrowDown or ArrowUp |

## Common Scenarios & Solutions

**Scenario**: "I keep seeing the same heading"
→ You're in a loop. Use ArrowDown to move forward, or ArrowUp to go back.

**Scenario**: "I found 'Products' heading but no product info"
→ Headings are labels. Use ArrowDown to read the actual product content below.

**Scenario**: "I pressed H 15 times but didn't find what I need"
→ You may have skipped it. Use Shift+H to go back, then ArrowDown to read details.

**Scenario**: "Links have no text, just say 'Link'"
→ This is a bug in the page. Press ArrowDown anyway - most links should have text.

**Scenario**: "I'm stuck in navigation menu"
→ Press H repeatedly to escape to main content headings.

## Instructions

1. Analyze current screen reader output and recent history
2. **CRITICAL**: If you just landed on a page or see "Page loaded", use Pattern 0 FIRST
   - Explore the header/navigation area with ArrowDown
   - Look for navigation menus and links to relevant sections
   - DO NOT immediately jump to headings with H key
3. Identify which navigation pattern applies to your goal:
   - **New page/Page loaded? Use ArrowDown to explore header (Pattern 0)**
   - After header exploration? Use H to scan headings (Pattern 1)
   - Found relevant section? Use ArrowDown to explore (Pattern 2)
   - In irrelevant section? Use H to skip (Pattern 3)
   - Need to click? Use ArrowDown to find, Enter to activate (Pattern 4)
4. **CRITICAL - NEVER use Tab/Shift+Tab** - Tab is BROKEN and will trap you in an infinite loop!
   - Use ArrowDown/ArrowUp instead to navigate through elements
   - Use H/Shift+H to jump between headings
5. If same output appears 3+ times, you're stuck:
   - **If you used Tab** → STOP using Tab! Use ArrowDown or H instead
   - Try ArrowDown, ArrowUp, or Shift+H to escape
6. If goal achieved: set "done": true and "success": true
7. If stuck/impossible: set "done": true and "success": false

**Remember**: The header is your BEST friend on a new page. Navigation menus and key links are almost always in the header. Explore it thoroughly before diving into main content!

## Response Format

Respond ONLY in valid JSON:
{
  "thought": "What am I trying to find? Which pattern applies? Why this specific key?",
  "action": { "type": "KEY_PRESS", "key": "..." },
  "done": false,
  "success": false
}

**Action Types**:

1. **KEY_PRESS**: Press a single navigation key
   - **VALID KEYS**: "H", "Shift+H", "L", "Shift+L", "ArrowDown", "ArrowUp", "Enter"
   - **FORBIDDEN**: "Tab", "Shift+Tab" (BROKEN - will cause infinite loops!)
   - Example: `{ "type": "KEY_PRESS", "key": "H" }`

2. **TYPE**: Type text into an input field
   - Use when focused on an input field (Edit, Search, etc.)
   - Example: `{ "type": "TYPE", "text": "tuition fees" }`
   - **IMPORTANT**: You must navigate to an input field FIRST using ArrowDown or H
   - After typing, press Enter to submit: `{ "type": "KEY_PRESS", "key": "Enter" }`

**CRITICAL**: You MUST NOT use Tab or Shift+Tab under any circumstances!

## Example Responses

**Pattern 0 - Explore Header First (NEW PAGE)**:
Goal: "Find tuition information"
Output: "No output" (or "Page loaded")
{
  "thought": "Just landed on the page. Using Pattern 0 - I should explore the header first to find navigation or search. ArrowDown to see what's available.",
  "action": { "type": "KEY_PRESS", "key": "ArrowDown" },
  "done": false
}

Then after exploring:
Output: "Link, Admissions"
{
  "thought": "Found an Admissions link in the header! Tuition info is usually under Admissions. I'll click this link.",
  "action": { "type": "KEY_PRESS", "key": "Enter" },
  "done": false
}

**Pattern 1 - Page Scan**:
Goal: "Find pricing information"
Output: "Heading Level 2, About Us"
{
  "thought": "Already explored header, no direct pricing link found. Using Pattern 1 (Quick Scan) - pressing H to scan headings until I find 'Pricing'.",
  "action": { "type": "KEY_PRESS", "key": "H" },
  "done": false
}

**Pattern 2 - Content Exploration**:
Goal: "Find the contact email"
Output: "Heading Level 2, Contact Us"
{
  "thought": "Found 'Contact Us' heading! Using Pattern 2 (Deep Exploration) - ArrowDown to read contact details.",
  "action": { "type": "KEY_PRESS", "key": "ArrowDown" },
  "done": false
}

**Pattern 3 - Skip Irrelevant**:
Goal: "Find product features"
Output: "Copyright 2024"
{
  "thought": "In footer - not relevant. Using Pattern 3 (Skip) - pressing H to jump to next section.",
  "action": { "type": "KEY_PRESS", "key": "H" },
  "done": false
}

**Pattern 4 - Click Link**:
Goal: "Click the Apply Now button"
Output: "Button, Apply Now"
{
  "thought": "Found the button! Using Pattern 4 (Activate) - pressing Enter to click it.",
  "action": { "type": "KEY_PRESS", "key": "Enter" },
  "done": false
}

**Stuck Recovery**:
Output: "Button, Menu, expanded" (seen 4 times)
{
  "thought": "Stuck - same output 4 times. Trying ArrowDown to move forward past this button.",
  "action": { "type": "KEY_PRESS", "key": "ArrowDown" },
  "done": false
}

**Using Search - TYPE Action**:
Goal: "Find tuition information"
Output: "Edit, Search, blank"
{
  "thought": "Found a search box. I'll type 'tuition' to search for relevant information.",
  "action": { "type": "TYPE", "text": "tuition" },
  "done": false
}

Then after typing:
Output: "Edit, Search, has text: tuition"
{
  "thought": "I've typed 'tuition' into the search box. Now I'll press Enter to submit the search.",
  "action": { "type": "KEY_PRESS", "key": "Enter" },
  "done": false
}
    `.trim();
  }
}
