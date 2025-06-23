import { useEffect, useRef, useState } from 'react';

const SIGNAL = 'wss://server-olzm.onrender.com/ws';

const getAvatar = (user) =>
  `https://api.dicebear.com/5.x/identicon/svg?seed=${encodeURIComponent(user)}`;

export default function Home() {
  const [username, setUsername] = useState('');
  const [peerName, setPeerName] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [connected, setConnected] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [calling, setCalling] = useState(false);
  const [incoming, setIncoming] = useState(null);
  const [muted, setMuted] = useState(false);
  const [subtitle, setSubtitle] = useState('');

  const ws = useRef(null);
  const pc = useRef(null);
  const localStream = useRef(null);
  const remoteAudio = useRef(null);
  const iceQueue = useRef([]);
  const mediaRecorder = useRef(null);
  const subtitleInterval = useRef(null);

  useEffect(() => {
    if (!connected) return;
    ws.current.onmessage = async (e) => {
      const m = JSON.parse(e.data);
      switch (m.type) {
        case 'user_connected':
          setOnlineUsers((u) => [...new Set([...u, m.username])]);
          break;
        case 'user_disconnected':
          setOnlineUsers((u) => u.filter((x) => x !== m.username));
          break;
        case 'offer':
          setIncoming(m.from);
          iceQueue.current.push({ type: 'offer', offer: m.offer });
          playIncomingRingtone();
          break;
        case 'answer':
          stopOutgoingRingtone();
          await pc.current.setRemoteDescription(new RTCSessionDescription(m.answer));
          setInCall(true);
          break;
        case 'ice-candidate':
          if (pc.current?.remoteDescription) {
            await pc.current.addIceCandidate(new RTCIceCandidate(m.candidate));
          } else {
            iceQueue.current.push(m.candidate);
          }
          break;
        case 'end_call':
          endCall();
          break;
      }
    };

    return () => {
      stopTranscription();
      ws.current?.close();
      localStream.current?.getTracks().forEach((t) => t.stop());
      pc.current?.close();
    };
  }, [connected]);

  const connect = () => {
    if (!username.trim()) return alert('Enter a username');
    ws.current = new WebSocket(`${SIGNAL}/${username}`);
    ws.current.onopen = () => setConnected(true);
    ws.current.onclose = () => resetAll();
  };

  const startCall = async () => {
    if (!peerName.trim()) return alert('Enter name for call');
    setCalling(true);
    playOutgoingRingtone();
    await initPC(peerName);
    const offer = await pc.current.createOffer();
    await pc.current.setLocalDescription(offer);
    send({ type: 'offer', offer, to: peerName, from: username });
    startTranscription();
  };

  const answerCall = async (accept) => {
    stopIncomingRingtone();
    const from = incoming;
    setIncoming(null);
    if (!accept) return endCall();

    const offerMsg = iceQueue.current.find((msg) => msg.type === 'offer');
    if (!offerMsg) return alert('No offer found');

    await initPC(from);
    await pc.current.setRemoteDescription(new RTCSessionDescription(offerMsg.offer));
    flushICEQueue();

    const answer = await pc.current.createAnswer();
    await pc.current.setLocalDescription(answer);
    send({ type: 'answer', answer, to: from, from: username });
    setInCall(true);
    startTranscription();
  };

  const initPC = async (peer) => {
    setPeerName(peer);
    pc.current = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    pc.current.onicecandidate = (e) => {
      if (e.candidate) {
        send({ type: 'ice-candidate', candidate: e.candidate, to: peer, from: username });
      }
    };

    pc.current.ontrack = (e) => {
      setTimeout(() => {
        if (remoteAudio.current) {
          remoteAudio.current.srcObject = e.streams[0];
        }
      }, 0);
    };

    try {
      localStream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStream.current.getTracks().forEach((t) =>
        pc.current.addTrack(t, localStream.current)
      );
    } catch (err) {
      alert('Microphone access is required.');
      console.error(err);
    }
  };

  const flushICEQueue = () => {
    iceQueue.current.forEach((c) =>
      pc.current.addIceCandidate(c).catch(console.warn)
    );
    iceQueue.current = [];
  };

  const toggleMute = () => {
    const track = localStream.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setMuted(!track.enabled);
    }
  };

  const startTranscription = () => {
    if (!MediaRecorder.isTypeSupported('audio/webm')) {
      alert('Your browser does not support audio/webm');
      return;
    }

    const chunks = [];
    mediaRecorder.current = new MediaRecorder(localStream.current, {
      mimeType: 'audio/webm',
    });

    mediaRecorder.current.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.current.onstop = async () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      chunks.length = 0;

      const formData = new FormData();
      formData.append('file', blob, 'clip.wav');

      try {
        const res = await fetch('https://server-olzm.onrender.com/transcribe', {
          method: 'POST',
          body: formData,
        });
        const json = await res.json();
        setSubtitle(json.text);
      } catch (e) {
        console.error('Transcription failed:', e);
      }

      if (mediaRecorder.current?.state === 'inactive') {
        mediaRecorder.current.start();
      }
    };

    mediaRecorder.current.start();
    subtitleInterval.current = setInterval(() => {
      if (mediaRecorder.current?.state === 'recording') {
        mediaRecorder.current.stop();
      }
    }, 4000);
  };

  const stopTranscription = () => {
    clearInterval(subtitleInterval.current);
    try {
      mediaRecorder.current?.stop();
    } catch {}
  };

  const endCall = () => {
    stopIncomingRingtone();
    stopOutgoingRingtone();
    stopTranscription();
    setSubtitle('');
    send({ type: 'end_call', to: peerName, from: username });
    localStream.current?.getTracks().forEach((t) => t.stop());
    pc.current?.close();
    setInCall(false);
    setCalling(false);
    setIncoming(null);
    setPeerName('');
  };

  const resetAll = () => {
    stopTranscription();
    setSubtitle('');
    setConnected(false);
    setInCall(false);
    setCalling(false);
    setIncoming(null);
    setPeerName('');
    setMuted(false);
  };

  const send = (m) => ws.current?.send(JSON.stringify(m));

  const playIncomingRingtone = () =>
    document.getElementById('ringtone-incoming')?.play();

  const stopIncomingRingtone = () => {
    const audio = document.getElementById('ringtone-incoming');
    audio.pause();
    audio.currentTime = 0;
  };

  const playOutgoingRingtone = () =>
    document.getElementById('ringtone-outgoing')?.play();

  const stopOutgoingRingtone = () => {
    const audio = document.getElementById('ringtone-outgoing');
    audio.pause();
    audio.currentTime = 0;
  };

  return (
    <div id="app">
      <audio id="ringtone-incoming" src="/ringtone-incoming.mp3" loop />
      <audio id="ringtone-outgoing" src="/ringtone-outgoing.mp3" loop />
      <div className="header">🔊 VoIP Client</div>
      <div className="main">
        <div className="card">
          {!connected ? (
            <>
              <div className="input-group">
                <input
                  placeholder="Your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <button className="btn" onClick={connect}>
                Connect
              </button>
            </>
          ) : incoming && !inCall ? (
            <div className="modal">
              <div className="modal-content">
                <p>
                  📞 Incoming call from <strong>{incoming}</strong>
                </p>
                <div className="modal-buttons">
                  <button className="btn" onClick={() => answerCall(true)}>
                    Accept
                  </button>
                  <button className="btn" onClick={() => answerCall(false)}>
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ) : inCall ? (
            <div className="call-screen">
              <img src={getAvatar(peerName)} alt="Avatar" />
              <p>
                <strong>In Call with {peerName}</strong>
              </p>
              <p className="subtitle">{subtitle}</p>
              <div className="controls">
                <button className="control-btn mute" onClick={toggleMute}>
                  {muted ? '🔇' : '🎙️'}
                </button>
                <button className="control-btn end" onClick={endCall}>
                  📞
                </button>
              </div>
            </div>
          ) : calling ? (
            <div className="call-screen">
              <div className="calling-animation" />
              <p>📞 Calling {peerName}...</p>
              <button className="btn" onClick={endCall}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <div className="input-group">
                <input
                  placeholder="Peer username"
                  value={peerName}
                  onChange={(e) => setPeerName(e.target.value)}
                />
              </div>
              <div className="user-list">
                <strong>Online:</strong>{' '}
                {onlineUsers.filter((u) => u !== username).map((u) => (
                  <span key={u}>{u}</span>
                ))}
              </div>
              <button className="btn" onClick={startCall}>
                Start Call
              </button>
            </>
          )}
          <audio ref={remoteAudio} autoPlay hidden />
        </div>
      </div>
    </div>
  );
}
