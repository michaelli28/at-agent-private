"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrailleDriver = void 0;
const ScreenReaderDriver_1 = require("./ScreenReaderDriver");
class BrailleDriver extends ScreenReaderDriver_1.ScreenReaderDriver {
    constructor() {
        super(...arguments);
        this.name = "BrailleDisplay";
    }
    async getPerceptualOutput() {
        const srOutput = await super.getPerceptualOutput();
        const brailleText = this.toBraille(srOutput.text);
        return {
            text: `[Braille] ${brailleText}\n[Speech] ${srOutput.text}`,
            cursorBox: srOutput.cursorBox
        };
    }
    toBraille(text) {
        // Simple mapping for a-z and 0-9. 
        // In reality, Braille is much more complex (contractions, etc.)
        const map = {
            'a': '⠁', 'b': '⠃', 'c': '⠉', 'd': '⠙', 'e': '⠑', 'f': '⠋', 'g': '⠛', 'h': '⠓', 'i': '⠊', 'j': '⠚',
            'k': '⠅', 'l': '⠇', 'm': '⠍', 'n': '⠝', 'o': '⠕', 'p': '⠏', 'q': '⠟', 'r': '⠗', 's': '⠎', 't': '⠞',
            'u': '⠥', 'v': '⠧', 'w': '⠺', 'x': '⠭', 'y': '⠽', 'z': '⠵',
            '1': '⠼⠁', '2': '⠼⠃', '3': '⠼⠉', '4': '⠼⠙', '5': '⠼⠑', '6': '⠼⠋', '7': '⠼⠛', '8': '⠼⠓', '9': '⠼⠊', '0': '⠼⠚',
            ' ': ' ', ',': '⠂', '.': '⠲', '!': '⠖', '?': '⠦'
        };
        return text.toLowerCase().split('').map(char => map[char] || char).join('');
    }
}
exports.BrailleDriver = BrailleDriver;
