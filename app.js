// ============================================
// P2P Social - Main Application
// ============================================

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyCqPtXfmUtTq5e1Q0L9uxO084J-MDutRFI",
  authDomain: "p2p-social-f44e0.firebaseapp.com",
  databaseURL: "https://p2p-social-f44e0-default-rtdb.firebaseio.com",
  projectId: "p2p-social-f44e0",
  storageBucket: "p2p-social-f44e0.firebasestorage.app",
  messagingSenderId: "55645673816",
  appId: "1:55645673816:web:b0f187c33ad8beb5caed2d"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// ============================================
// Global State
// ============================================

const state = {
  peerId: null,
  displayName: null,
  peers: new Map(),
  posts: [],
  mediaQueue: [],
  localStream: null,
  inCall: false,
  micEnabled: true,
  camEnabled: true,
  aiMessages: []
};

// WebRTC Configuration
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

// ============================================
// Utility Functions
// ============================================

function generatePeerId() {
  return 'peer_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}

function getAvatarColor(str) {
  const colors = [
    'linear-gradient(135deg, #ff6b6b 0%, #ffa500 100%)',
    'linear-gradient(135deg, #00ff88 0%, #00bfff 100%)',
    'linear-gradient(135deg, #ff00ff 0%, #ff6b6b 100%)',
    'linear-gradient(135deg, #00bfff 0%, #0066ff 100%)',
    'linear-gradient(135deg, #ffff00 0%, #ff6b6b 100%)',
    'linear-gradient(135deg, #00ff88 0%, #00ffff 100%)',
    'linear-gradient(135deg, #ff6b6b 0%, #ff00ff 100%)',
    'linear-gradient(135deg, #00bfff 0%, #00ff88 100%)'
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return date.toLocaleDateString();
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================
// Firebase Signaling
// ============================================

const signaling = {
  async announce() {
    const peerRef = database.ref(`peers/${state.peerId}`);
    await peerRef.set({
      displayName: state.displayName,
      online: true,
      lastSeen: Date.now()
    });
    
    peerRef.onDisconnect().remove();
    
    setInterval(() => {
      peerRef.update({ lastSeen: Date.now() });
    }, 10000);
  },
  
  async sendSignal(targetPeerId, type, data) {
    await database.ref(`signals/${targetPeerId}/${state.peerId}`).push({
      type,
      data,
      from: state.peerId,
      fromName: state.displayName,
      timestamp: Date.now()
    });
  },
  
  listenForSignals() {
    database.ref(`signals/${state.peerId}`).on('child_added', (snapshot) => {
      const signals = snapshot.val();
      if (!signals) return;
      
      Object.values(signals).forEach(signal => {
        this.handleSignal(signal);
      });
      
      snapshot.ref.remove();
    });
  },
  
  async handleSignal(signal) {
    const { type, data, from, fromName } = signal;
    
    if (type === 'offer') {
      await p2p.handleOffer(from, fromName, data);
    } else if (type === 'answer') {
      await p2p.handleAnswer(from, data);
    } else if (type === 'ice-candidate') {
      await p2p.handleIceCandidate(from, data);
    }
  },
  
  listenForPeers() {
    database.ref('peers').on('value', (snapshot) => {
      const peers = snapshot.val() || {};
      const peerList = document.getElementById('peerList');
      peerList.innerHTML = '';
      
      let onlineCount = 0;
      
      Object.entries(peers).forEach(([peerId, info]) => {
        if (peerId === state.peerId) return;
        if (Date.now() - info.lastSeen > 30000) return;
        
        onlineCount++;
        
        if (!state.peers.has(peerId)) {
          p2p.connectToPeer(peerId, info.displayName);
        }
        
        const peerEl = document.createElement('div');
        peerEl.className = 'peer-item';
        peerEl.innerHTML = `
          <div class="peer-avatar" style="background: ${getAvatarColor(peerId)}">${getInitials(info.displayName)}</div>
          <div class="peer-info">
            <div class="peer-name">${info.displayName}</div>
            <div class="peer-status">Connected</div>
          </div>
        `;
        peerEl.onclick = () => startDirectMessage(peerId, info.displayName);
        peerList.appendChild(peerEl);
      });
      
      document.getElementById('peerCount').textContent = onlineCount;
    });
  }
};

// ============================================
// WebRTC P2P Connection
// ============================================

const p2p = {
  async connectToPeer(peerId, displayName) {
    if (state.peers.has(peerId)) return;
    
    console.log('Connecting to peer:', peerId);
    
    const pc = new RTCPeerConnection(rtcConfig);
    const dataChannel = pc.createDataChannel('messages', { ordered: true });
    
    state.peers.set(peerId, { 
      connection: pc, 
      dataChannel, 
      info: { displayName } 
    });
    
    this.setupDataChannel(dataChannel, peerId);
    this.setupConnectionHandlers(pc, peerId);
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await signaling.sendSignal(peerId, 'offer', {
      sdp: offer.sdp,
      type: offer.type
    });
  },
  
  async handleOffer(peerId, displayName, offer) {
    console.log('Received offer from:', peerId);
    
    const pc = new RTCPeerConnection(rtcConfig);
    state.peers.set(peerId, { 
      connection: pc, 
      dataChannel: null, 
      info: { displayName } 
    });
    
    pc.ondatachannel = (event) => {
      const peer = state.peers.get(peerId);
      peer.dataChannel = event.channel;
      this.setupDataChannel(event.channel, peerId);
    };
    
    this.setupConnectionHandlers(pc, peerId);
    
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    await signaling.sendSignal(peerId, 'answer', {
      sdp: answer.sdp,
      type: answer.type
    });
  },
  
  async handleAnswer(peerId, answer) {
    console.log('Received answer from:', peerId);
    const peer = state.peers.get(peerId);
    if (peer) {
      await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
    }
  },
  
  async handleIceCandidate(peerId, candidate) {
    const peer = state.peers.get(peerId);
    if (peer && candidate) {
      try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('Error adding ICE candidate:', e);
      }
    }
  },
  
  setupConnectionHandlers(pc, peerId) {
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signaling.sendSignal(peerId, 'ice-candidate', event.candidate.toJSON());
      }
    };
    
    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${peerId}:`, pc.connectionState);
      if (pc.connectionState === 'connected') {
        showToast(`Connected to peer`, 'success');
        updateConnectionStatus('connected');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        state.peers.delete(peerId);
        updateConnectionStatus(state.peers.size > 0 ? 'connected' : 'connecting');
      }
    };
    
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        addRemoteVideo(peerId, event.streams[0]);
      }
    };
  },
  
  setupDataChannel(channel, peerId) {
    channel.onopen = () => {
      console.log('Data channel opened with:', peerId);
      this.sendToPeer(peerId, { type: 'sync-request' });
    };
    
    channel.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(peerId, message);
    };
    
    channel.onerror = (error) => {
      console.error('Data channel error:', error);
    };
    
    channel.onclose = () => {
      console.log('Data channel closed with:', peerId);
    };
  },
  
  handleMessage(fromPeerId, message) {
    switch (message.type) {
      case 'post':
        addPost(message.data, false);
        break;
      case 'sync-request':
        state.posts.slice(-20).forEach(post => {
          this.sendToPeer(fromPeerId, { type: 'post', data: post });
        });
        break;
      case 'call-offer':
        handleCallOffer(fromPeerId, message.data);
        break;
      case 'call-answer':
        handleCallAnswer(fromPeerId, message.data);
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  },
  
  sendToPeer(peerId, message) {
    const peer = state.peers.get(peerId);
    if (peer && peer.dataChannel && peer.dataChannel.readyState === 'open') {
      peer.dataChannel.send(JSON.stringify(message));
    }
  },
  
  broadcast(message) {
    const messageStr = JSON.stringify(message);
    state.peers.forEach((peer, peerId) => {
      if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
        peer.dataChannel.send(messageStr);
      }
    });
  },
  
  addStreamToPeers(stream) {
    state.peers.forEach((peer) => {
      stream.getTracks().forEach(track => {
        peer.connection.addTrack(track, stream);
      });
    });
  }
};

// ============================================
// UI Updates
// ============================================

function updateConnectionStatus(status) {
  const dot = document.getElementById('connectionDot');
  const text = document.getElementById('connectionStatus');
  
  dot.className = 'status-dot';
  
  switch (status) {
    case 'connected':
      text.textContent = 'Connected';
      break;
    case 'connecting':
      dot.classList.add('connecting');
      text.textContent = 'Connecting...';
      break;
    case 'offline':
      dot.classList.add('offline');
      text.textContent = 'Offline';
      break;
  }
}

function addPost(post, broadcast = true) {
  if (state.posts.some(p => p.id === post.id)) return;
  
  state.posts.push(post);
  
  document.getElementById('emptyState').style.display = 'none';
  
  const feed = document.getElementById('feed');
  const postEl = document.createElement('article');
  postEl.className = 'post';
  postEl.id = `post-${post.id}`;
  
  let mediaHtml = '';
  if (post.media && post.media.length > 0) {
    post.media.forEach(item => {
      if (item.type.startsWith('image/')) {
        mediaHtml += `<div class="post-media"><img src="${item.data}" alt="Post image"></div>`;
      } else if (item.type.startsWith('video/')) {
        mediaHtml += `<div class="post-media"><video src="${item.data}" controls></video></div>`;
      }
    });
  }
  
  postEl.innerHTML = `
    <div class="post-header">
      <div class="post-avatar" style="background: ${getAvatarColor(post.authorId)}">${getInitials(post.author)}</div>
      <div class="post-meta">
        <div class="post-author">${post.author}</div>
        <div class="post-time">${formatTime(post.timestamp)}</div>
      </div>
    </div>
    <div class="post-content">${escapeHtml(post.content)}</div>
    ${mediaHtml}
    <div class="post-actions">
      <button class="post-action" onclick="likePost('${post.id}')">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        Like
      </button>
      <button class="post-action" onclick="replyToPost('${post.id}')">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/></svg>
        Reply
      </button>
      <button class="post-action" onclick="sharePost('${post.id}')">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>
        Share
      </button>
    </div>
  `;
  
  feed.insertBefore(postEl, feed.firstChild);
  
  if (broadcast) {
    p2p.broadcast({ type: 'post', data: post });
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/\n/g, '<br>');
}

function likePost(postId) {
  showToast('Liked!', 'success');
}

function replyToPost(postId) {
  const post = state.posts.find(p => p.id === postId);
  if (post) {
    document.getElementById('postInput').value = `@${post.author} `;
    document.getElementById('postInput').focus();
  }
}

function sharePost(postId) {
  const post = state.posts.find(p => p.id === postId);
  if (post) {
    navigator.clipboard.writeText(post.content).then(() => {
      showToast('Copied to clipboard!', 'success');
    });
  }
}

function startDirectMessage(peerId, displayName) {
  showToast(`Opening chat with ${displayName}...`);
}

// ============================================
// Video Calling
// ============================================

async function startVideoCall() {
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    
    const localVideo = document.getElementById('localVideo');
    localVideo.srcObject = state.localStream;
    
    p2p.addStreamToPeers(state.localStream);
    
    state.inCall = true;
    document.getElementById('startCallBtn').textContent = 'In Call';
    document.getElementById('startCallBtn').disabled = true;
    
    showToast('Video call started', 'success');
  } catch (err) {
    console.error('Error accessing media devices:', err);
    showToast('Could not access camera/microphone', 'error');
  }
}

function addRemoteVideo(peerId, stream) {
  const videoGrid = document.getElementById('videoGrid');
  
  if (document.getElementById(`video-${peerId}`)) return;
  
  const peer = state.peers.get(peerId);
  const displayName = peer?.info?.displayName || 'Peer';
  
  const container = document.createElement('div');
  container.className = 'video-container';
  container.id = `video-${peerId}`;
  container.innerHTML = `
    <video autoplay playsinline></video>
    <span class="video-label">${displayName}</span>
  `;
  
  container.querySelector('video').srcObject = stream;
  videoGrid.appendChild(container);
}

function toggleMic() {
  if (state.localStream) {
    state.micEnabled = !state.micEnabled;
    state.localStream.getAudioTracks().forEach(track => {
      track.enabled = state.micEnabled;
    });
    document.getElementById('toggleMicBtn').classList.toggle('active', !state.micEnabled);
  }
}

function toggleCam() {
  if (state.localStream) {
    state.camEnabled = !state.camEnabled;
    state.localStream.getVideoTracks().forEach(track => {
      track.enabled = state.camEnabled;
    });
    document.getElementById('toggleCamBtn').classList.toggle('active', !state.camEnabled);
  }
}

async function shareScreen() {
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true
    });
    
    const videoTrack = screenStream.getVideoTracks()[0];
    
    state.peers.forEach((peer) => {
      const sender = peer.connection.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        sender.replaceTrack(videoTrack);
      }
    });
    
    const localVideo = document.getElementById('localVideo');
    localVideo.srcObject = screenStream;
    
    videoTrack.onended = () => {
      if (state.localStream) {
        const camTrack = state.localStream.getVideoTracks()[0];
        state.peers.forEach((peer) => {
          const sender = peer.connection.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(camTrack);
          }
        });
        localVideo.srcObject = state.localStream;
      }
    };
    
    showToast('Screen sharing started', 'success');
  } catch (err) {
    console.error('Error sharing screen:', err);
    showToast('Could not share screen', 'error');
  }
}

function endCall() {
  if (state.localStream) {
    state.localStream.getTracks().forEach(track => track.stop());
    state.localStream = null;
  }
  
  state.inCall = false;
  document.getElementById('startCallBtn').textContent = 'Start Video Call';
  document.getElementById('startCallBtn').disabled = false;
  document.getElementById('localVideo').srcObject = null;
  
  const videoGrid = document.getElementById('videoGrid');
  videoGrid.querySelectorAll('.video-container:not(:first-child)').forEach(el => el.remove());
  
  showToast('Call ended');
}

// ============================================
// AI Integration
// ============================================

const ai = {
  async chat(message) {
    this.addMessage(message, 'user');
    
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          messages: [
            ...state.aiMessages,
            { role: 'user', content: message }
          ],
          system: `You are an AI assistant integrated into a peer-to-peer social network called P2P Social. 
                   You can help users compose posts, answer questions about the network, suggest content ideas, 
                   and assist with any other tasks. Keep responses concise and helpful.
                   The network currently has ${state.peers.size} connected peers.`
        })
      });
      
      if (!response.ok) {
        throw new Error('API request failed');
      }
      
      const data = await response.json();
      const reply = data.content[0].text;
      
      state.aiMessages.push({ role: 'user', content: message });
      state.aiMessages.push({ role: 'assistant', content: reply });
      
      if (state.aiMessages.length > 20) {
        state.aiMessages = state.aiMessages.slice(-20);
      }
      
      this.addMessage(reply, 'assistant');
      
      return reply;
    } catch (error) {
      console.error('AI error:', error);
      const fallbackResponse = this.getFallbackResponse(message);
      this.addMessage(fallbackResponse, 'assistant');
      return fallbackResponse;
    }
  },
  
  getFallbackResponse(message) {
    const lowerMsg = message.toLowerCase();
    
    if (lowerMsg.includes('hello') || lowerMsg.includes('hi')) {
      return `Hello! I'm here to help with the P2P Social network. You have ${state.peers.size} peers connected. What would you like to do?`;
    }
    if (lowerMsg.includes('post') || lowerMsg.includes('write')) {
      return 'I can help you write a post! What topic would you like to write about?';
    }
    if (lowerMsg.includes('how') && lowerMsg.includes('work')) {
      return 'P2P Social works by connecting your browser directly to other users via WebRTC. There are no central servers - your posts are shared directly between peers. This makes the network censorship-resistant!';
    }
    if (lowerMsg.includes('peers') || lowerMsg.includes('connected')) {
      return `You currently have ${state.peers.size} peers connected to your node. The more peers, the more resilient the network becomes!`;
    }
    
    return `I'm currently running in offline mode (API not configured). To enable full AI capabilities, add your Claude API key. I can still help with basic questions about the network!`;
  },
  
  addMessage(content, role) {
    const messagesEl = document.getElementById('aiMessages');
    const messageEl = document.createElement('div');
    messageEl.className = `ai-message ${role}`;
    messageEl.innerHTML = `<div class="ai-message-content">${escapeHtml(content)}</div>`;
    messagesEl.appendChild(messageEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
};

// ============================================
// Event Handlers
// ============================================

function setupEventListeners() {
  document.getElementById('saveNameBtn').onclick = () => {
    const name = document.getElementById('nameInput').value.trim();
    if (name) {
      state.displayName = name;
      localStorage.setItem('p2p-displayName', name);
      document.getElementById('nameModal').classList.remove('active');
      initializeNetwork();
    }
  };
  
  document.getElementById('nameInput').onkeypress = (e) => {
    if (e.key === 'Enter') {
      document.getElementById('saveNameBtn').click();
    }
  };
  
  document.getElementById('postBtn').onclick = createPost;
  document.getElementById('postInput').onkeypress = (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      createPost();
    }
  };
  
  document.getElementById('addImageBtn').onclick = () => {
    document.getElementById('imageInput').click();
  };
  
  document.getElementById('addVideoBtn').onclick = () => {
    document.getElementById('videoInput').click();
  };
  
  document.getElementById('imageInput').onchange = handleMediaSelect;
  document.getElementById('videoInput').onchange = handleMediaSelect;
  
  document.getElementById('askAiBtn').onclick = () => {
    const text = document.getElementById('postInput').value.trim();
    if (text) {
      ai.chat(`Help me improve this post: "${text}"`);
    } else {
      ai.chat('Give me an idea for an interesting post');
    }
  };
  
  document.getElementById('aiSendBtn').onclick = sendAiMessage;
  document.getElementById('aiInput').onkeypress = (e) => {
    if (e.key === 'Enter') {
      sendAiMessage();
    }
  };
  
  document.querySelectorAll('.nav-item').forEach(item => {
    item.onclick = () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    };
  });
  
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      const panel = tab.dataset.panel;
      document.getElementById('aiPanel').style.display = panel === 'ai' ? 'flex' : 'none';
      document.getElementById('callPanel').style.display = panel === 'call' ? 'block' : 'none';
    };
  });
  
  document.getElementById('startCallBtn').onclick = startVideoCall;
  document.getElementById('toggleMicBtn').onclick = toggleMic;
  document.getElementById('toggleCamBtn').onclick = toggleCam;
  document.getElementById('shareScreenBtn').onclick = shareScreen;
  document.getElementById('endCallBtn').onclick = endCall;
}

async function createPost() {
  const input = document.getElementById('postInput');
  const content = input.value.trim();
  
  if (!content && state.mediaQueue.length === 0) return;
  
  const post = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    content,
    author: state.displayName,
    authorId: state.peerId,
    timestamp: Date.now(),
    media: state.mediaQueue.map(m => ({ type: m.type, data: m.data }))
  };
  
  addPost(post, true);
  
  input.value = '';
  state.mediaQueue = [];
  document.getElementById('mediaPreview').innerHTML = '';
  
  showToast('Posted to network!', 'success');
}

async function handleMediaSelect(event) {
  const files = Array.from(event.target.files);
  const preview = document.getElementById('mediaPreview');
  
  for (const file of files) {
    if (file.size > 5 * 1024 * 1024) {
      showToast('File too large (max 5MB)', 'error');
      continue;
    }
    
    const data = await fileToBase64(file);
    state.mediaQueue.push({ type: file.type, data, name: file.name });
    
    const previewItem = document.createElement('div');
    previewItem.className = 'preview-item';
    
    if (file.type.startsWith('image/')) {
      previewItem.innerHTML = `<img src="${data}" alt="${file.name}">`;
    } else if (file.type.startsWith('video/')) {
      previewItem.innerHTML = `<video src="${data}"></video>`;
    }
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'preview-remove';
    removeBtn.textContent = '×';
    removeBtn.onclick = () => {
      const index = state.mediaQueue.findIndex(m => m.name === file.name);
      if (index > -1) state.mediaQueue.splice(index, 1);
      previewItem.remove();
    };
    previewItem.appendChild(removeBtn);
    
    preview.appendChild(previewItem);
  }
  
  event.target.value = '';
}

function sendAiMessage() {
  const input = document.getElementById('aiInput');
  const message = input.value.trim();
  if (message) {
    ai.chat(message);
    input.value = '';
  }
}

// ============================================
// Initialization
// ============================================

function initializeNetwork() {
  const initials = getInitials(state.displayName);
  document.getElementById('myAvatar').textContent = initials;
  document.getElementById('myAvatar').style.background = getAvatarColor(state.peerId);
  document.getElementById('myPeerId').textContent = state.displayName;
  document.getElementById('composerAvatar').textContent = initials;
  document.getElementById('composerAvatar').style.background = getAvatarColor(state.peerId);
  
  updateConnectionStatus('connecting');
  signaling.announce();
  signaling.listenForSignals();
  signaling.listenForPeers();
  
  showToast('Connected to network!', 'success');
  updateConnectionStatus('connected');
}

function init() {
  state.peerId = localStorage.getItem('p2p-peerId') || generatePeerId();
  localStorage.setItem('p2p-peerId', state.peerId);
  
  state.displayName = localStorage.getItem('p2p-displayName');
  
  setupEventListeners();
  
  if (state.displayName) {
    document.getElementById('nameModal').classList.remove('active');
    initializeNetwork();
  } else {
    document.getElementById('nameModal').classList.add('active');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
