"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ScreenReader_1 = require("./ScreenReader");
// Initialize the screen reader attached to the window so we can control it if needed
window.adfScreenReader = new ScreenReader_1.ScreenReader();
