const transcriptEl = document.getElementById('transcript');
const overlayEl = document.getElementById('overlay');

function addLog(text, type) {
  const div = document.createElement('div');
  div.className = `log-entry ${type}`;
  div.textContent = text;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function updateCursor(box) {
  overlayEl.innerHTML = ''; // Clear previous
  if (box) {
    const div = document.createElement('div');
    div.className = 'cursor-box';
    div.style.left = `${box.x}px`;
    div.style.top = `${box.y}px`;
    div.style.width = `${box.width}px`;
    div.style.height = `${box.height}px`;
    overlayEl.appendChild(div);
  }
}

const ws = new WebSocket(`ws://${window.location.host}`);

ws.onopen = () => {
  addLog("Connected to Driver Server", "action");
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'snapshot') {
    const { text, cursorBox } = data.payload;
    addLog(`[SR] ${text}`, 'sr');
    updateCursor(cursorBox);
  } else if (data.type === 'log') {
    addLog(data.message, 'action');
  }
};

ws.onclose = () => {
  addLog("Disconnected", "action");
};
