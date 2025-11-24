"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = __importDefault(require("react"));
const client_1 = require("react-dom/client");
const App = () => {
    return (<div>
      <h1>Accessibility Driver Debugger</h1>
      <div id="live-mirror">Live Mirror Placeholder</div>
      <div id="transcript">Transcript Placeholder</div>
    </div>);
};
const container = document.getElementById('root');
if (container) {
    const root = (0, client_1.createRoot)(container);
    root.render(<App />);
}
