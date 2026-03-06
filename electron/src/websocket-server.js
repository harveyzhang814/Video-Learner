// electron/src/websocket-server.js
const WebSocket = require('ws');

class WebSocketServer {
    constructor(port = 8765) {
        this.port = port;
        this.wss = null;
        this.clients = new Set();
    }

    start() {
        this.wss = new WebSocket.Server({ port: this.port });
        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            console.log('[WS] Client connected');

            ws.on('message', (message) => {
                this.handleMessage(message);
            });

            ws.on('close', () => {
                this.clients.delete(ws);
                console.log('[WS] Client disconnected');
            });
        });
        console.log(`[WS] Server started on port ${this.port}`);
    }

    handleMessage(message) {
        try {
            const data = JSON.parse(message);
            // Handle commands from frontend
            if (this.onCommand) {
                this.onCommand(data);
            }
        } catch (e) {
            console.error('[WS] Invalid message:', e);
        }
    }

    send(type, payload) {
        const data = JSON.stringify({ type, payload });
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
            }
        });
    }

    broadcast(type, payload) {
        this.send(type, payload);
    }

    stop() {
        if (this.wss) {
            this.wss.close();
            this.wss = null;
            this.clients.clear();
            console.log('[WS] Server stopped');
        }
    }
}

module.exports = WebSocketServer;
