import { IAccessibilityDriver } from './IAccessibilityDriver';
import { UserAction, ActionResult, PerceptualSnapshot } from './types';
import { BrowserClient } from '@adf/browser/playwrightClient';
import * as fs from 'fs';
import * as path from 'path';

export class ScreenReaderDriver implements IAccessibilityDriver {
  name = "ScreenReader";
  private enabled = false;
  private lastSpokenText: string = "";
  private lastCursorBox: any = null; // Injected driver handles highlighting, but we might want to track it
  private currentUrl: string = "";
  private scriptContent: string = "";

  constructor(private client: BrowserClient) { }

  async enable(): Promise<void> {
    this.enabled = true;
    console.log("Screen Reader Enabled (In-Browser)");

    // Load and cache the driver script
    const scriptPath = path.join(__dirname, '../dist/injected.js');
    if (fs.existsSync(scriptPath)) {
      this.scriptContent = fs.readFileSync(scriptPath, 'utf-8');
      await this.client.injectScript(this.scriptContent);
    } else {
      console.error("Injected driver script not found at:", scriptPath);
    }

    // Listen for spoken output
    this.client.onConsoleMessage((msg) => {
      if (msg.startsWith('[SR] ')) {
        this.lastSpokenText = msg.replace('[SR] ', '');
      }
    });

    // Store initial URL
    this.currentUrl = await this.client.getCurrentUrl();
  }

  private async checkForNavigation(): Promise<boolean> {
    // Check if browser detected a full page load event
    const pageLoadOccurred = this.client.checkAndClearNavigation();

    if (pageLoadOccurred) {
      const newUrl = await this.client.getCurrentUrl();
      console.log(`[ScreenReaderDriver] Full page navigation detected to ${newUrl}`);
      this.currentUrl = newUrl;

      // Clear stale spoken text IMMEDIATELY to prevent old page text from persisting
      this.lastSpokenText = "";

      // Wait for the new page to be ready and for any pending operations to complete
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Re-inject the screen reader script
      console.log(`[ScreenReaderDriver] Re-injecting screen reader script on new page`);
      await this.client.reinjectScript(this.scriptContent);

      // Set initial text for new page
      this.lastSpokenText = "Page loaded";

      // Give the screen reader time to initialize and find first element
      await new Promise(resolve => setTimeout(resolve, 500));

      return true;
    }

    return false;
  }

  async disable(): Promise<void> {
    this.enabled = false;
    console.log("Screen Reader Disabled");
  }

  async performAction(action: UserAction): Promise<ActionResult> {
    if (!this.enabled) {
      return { success: false, message: "Driver not enabled", snapshot: await this.getPerceptualOutput() };
    }

    // Check for navigation BEFORE performing action
    // This handles cases where previous action caused navigation
    const preNavigated = await this.checkForNavigation();
    if (preNavigated) {
      console.log("[ScreenReaderDriver] Pre-action navigation detected, screen reader re-initialized");
    }

    if (action.type === 'KEY_PRESS') {
      if (action.key) {
        // Normalize key names that LLMs might use
        let normalizedKey = action.key;

        // Translate common LLM key names to Playwright-compatible names
        const keyTranslations: { [key: string]: string } = {
          'Ctrl': 'Control',
          'ctrl': 'Control',
          'CTRL': 'Control',
          'Alt': 'Alt',
          'alt': 'Alt',
          'ALT': 'Alt',
          'Esc': 'Escape',
          'esc': 'Escape',
          'ESC': 'Escape',
          'Del': 'Delete',
          'del': 'Delete',
          'DEL': 'Delete',
          'Ins': 'Insert',
          'ins': 'Insert',
          'INS': 'Insert'
        };

        // Handle compound keys like "Ctrl+F" -> "Control+F"
        if (normalizedKey.includes('+')) {
          const parts = normalizedKey.split('+');
          normalizedKey = parts.map(part => keyTranslations[part] || part).join('+');
        } else if (keyTranslations[normalizedKey]) {
          normalizedKey = keyTranslations[normalizedKey];
        }

        // Pass the normalized key to the browser
        await this.client.pressKey(normalizedKey);

        // If Enter key, wait longer as it might trigger navigation
        if (action.key === 'Enter') {
          await new Promise(resolve => setTimeout(resolve, 1500));
        } else {
          // Wait a bit for the injected script to process and emit output
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Check if we navigated to a new page after the action
        const navigated = await this.checkForNavigation();
        if (navigated) {
          console.log("[ScreenReaderDriver] Post-action navigation detected, screen reader re-initialized");
        }
      }
    } else if (action.type === 'TYPE') {
      if (action.text) {
        // Type text into the currently focused element
        await this.client.typeText(action.text);

        // Wait for the text to be typed
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return {
      success: true,
      snapshot: await this.getPerceptualOutput()
    };
  }

  async getPerceptualOutput(): Promise<PerceptualSnapshot> {
    if (!this.enabled) {
      return { text: "Screen Reader Off", cursorBox: null };
    }

    // Return the last text we heard from the injected script
    return {
      text: this.lastSpokenText || "No output",
      cursorBox: null // Box is drawn by injected script, we don't track it here anymore
    };
  }
}
