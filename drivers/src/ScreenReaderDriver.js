"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScreenReaderDriver = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class ScreenReaderDriver {
    constructor(client) {
        this.client = client;
        this.name = "ScreenReader";
        this.enabled = false;
        this.lastSpokenText = "";
        this.lastCursorBox = null; // Injected driver handles highlighting, but we might want to track it
        this.currentUrl = "";
        this.scriptContent = "";
    }
    async enable() {
        this.enabled = true;
        console.log("Screen Reader Enabled (In-Browser)");
        // Load and cache the driver script
        const scriptPath = path.join(__dirname, '../dist/injected.js');
        if (fs.existsSync(scriptPath)) {
            this.scriptContent = fs.readFileSync(scriptPath, 'utf-8');
            await this.client.injectScript(this.scriptContent);
        }
        else {
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
    async checkForNavigation() {
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
    async disable() {
        this.enabled = false;
        console.log("Screen Reader Disabled");
    }
    async performAction(action) {
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
                const keyTranslations = {
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
                }
                else if (keyTranslations[normalizedKey]) {
                    normalizedKey = keyTranslations[normalizedKey];
                }
                // Pass the normalized key to the browser
                await this.client.pressKey(normalizedKey);
                // If Enter key, wait longer as it might trigger navigation
                if (action.key === 'Enter') {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
                else {
                    // Wait a bit for the injected script to process and emit output
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                // Check if we navigated to a new page after the action
                const navigated = await this.checkForNavigation();
                if (navigated) {
                    console.log("[ScreenReaderDriver] Post-action navigation detected, screen reader re-initialized");
                }
            }
        }
        else if (action.type === 'TYPE') {
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
    async getPerceptualOutput() {
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
exports.ScreenReaderDriver = ScreenReaderDriver;
