import { useState, useRef } from 'react';

const SIGNAL_SERVER = 'wss:///server-olzm.onrender.com/ws'; // 👈 Replace with your Render WebSocket URL

export default function Home() {
  const [username, setUsername] = useState('');
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const ws = useRef(null);

  const connectWebSocket = () => {
    if (!username) return alert('Enter your name');
    ws.current = new WebSocket(`${SIGNAL_SERVER}/${username}`);
    ws.current.onopen = () => {
      setConnected(true);
    };
    ws.current.onmessage = (event) => {
      setMessages((prev) => [...prev, event.data]);
    };
    ws.current.onclose = () => {
      setConnected(false);
    };
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center px-4">
      <h1 className="text-3xl font-bold mb-6 text-center">🎤 Real-Time VoIP Client</h1>

      {!connected ? (
        <div className="flex gap-2 w-full max-w-md">
          <input
            className="flex-1 p-3 border rounded shadow-sm"
            placeholder="Enter your username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <button
            onClick={connectWebSocket}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Connect
          </button>
        </div>
      ) : (
        <div className="w-full max-w-md mt-6 bg-white rounded shadow p-4">
          <p className="text-green-600 font-medium mb-2">
            Connected as <span className="font-bold">{username}</span>
          </p>
          <div className="h-64 overflow-y-auto border p-2 bg-gray-50">
            {messages.map((msg, i) => (
              <div key={i} className="text-sm text-gray-700">{msg}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
