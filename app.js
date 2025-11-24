// ============================================
// P2P Social - Working Version
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
  mediaQueue: []
};

// WebRTC Configuration with TURN servers
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    {
      urls: 'turn:global.relay.metered.ca:80',
      username: 'e8dd65b92f6de3267ebb0134',
      credential: 'XKuDNw8m0AsUdZqe'
    },
    {
      urls: 'turn:global.relay.metered.ca:80?transport=tcp',
      username: 'e8dd65b92f6de3267ebb0134',
      credential: 'XKuDNw8m0AsUdZqe'
    },
    {
      urls: 'turn:global.relay.metered.ca:443',
      username: 'e8dd65b92f6de3267ebb0134',
      credential: 'XKuDNw8m0AsUdZqe'
    },
    {
      urls: 'turns:global.relay.metered.ca:443?transport=tcp',
      username: 'e8dd65b92f6de3267ebb0134',
      credential: 'XKuDNw8m0AsUdZqe'
    }
  ],
  iceCandidatePoolSize: 10
};

// ============================================
// Utility Functions
// ============================================

function generatePeerId() {
  return 'peer_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function getInitials(name) {
  return name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?';
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
  for (let i = 0; i < (str || '').length; i++) {
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
  
  updateName() {
    database.ref(`peers/${state.peerId}`).update({
      displayName: state.displayName
    });
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
      
      let onlineCount = 0;
      
      Object.entries(peers).forEach(([peerId, info]) => {
        if (peerId === state.peerId) return;
        if (Date.now() - info.lastSeen > 30000) return;
        
        onlineCount++;
        
        if (!state.peers.has(peerId)) {
          p2p.connectToPeer(peerId, info.displayName);
        }
      });
      
      // Update peer count in header (Firebase-discovered peers)
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
      info: { displayName },
      connected: false
    });
    
    this.setupDataChannel(dataChannel, peerId);
    this.setupConnectionHandlers(pc, peerId);
    
    // Wait for ICE candidates to gather
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signaling.sendSignal(peerId, 'ice-candidate', event.candidate.toJSON());
      }
    };
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    // Wait a bit for ICE gathering
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await signaling.sendSignal(peerId, 'offer', {
      sdp: pc.localDescription.sdp,
      type: pc.localDescription.type
    });
  },
  
  async handleOffer(peerId, displayName, offer) {
    console.log('Received offer from:', peerId);
    
    // Check if we already have a connection attempt
    if (state.peers.has(peerId)) {
      const existing = state.peers.get(peerId);
      if (existing.connection.connectionState === 'failed') {
        existing.connection.close();
        state.peers.delete(peerId);
      } else {
        return;
      }
    }
    
    const pc = new RTCPeerConnection(rtcConfig);
    state.peers.set(peerId, { 
      connection: pc, 
      dataChannel: null, 
      info: { displayName },
      connected: false
    });
    
    pc.ondatachannel = (event) => {
      const peer = state.peers.get(peerId);
      peer.dataChannel = event.channel;
      this.setupDataChannel(event.channel, peerId);
    };
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signaling.sendSignal(peerId, 'ice-candidate', event.candidate.toJSON());
      }
    };
    
    this.setupConnectionHandlers(pc, peerId);
    
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await signaling.sendSignal(peerId, 'answer', {
      sdp: pc.localDescription.sdp,
      type: pc.localDescription.type
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
        // Ignore ICE errors - they're usually timing-related
      }
    }
  },
  
  setupConnectionHandlers(pc, peerId) {
    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${peerId}:`, pc.connectionState);
      
      if (pc.connectionState === 'connected') {
        const peer = state.peers.get(peerId);
        if (peer) peer.connected = true;
        showToast('Peer connected!', 'success');
        updateConnectionStatus();
        updatePeerList();
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        state.peers.delete(peerId);
        updateConnectionStatus();
        updatePeerList();
      }
    };
  },
  
  setupDataChannel(channel, peerId) {
    channel.onopen = () => {
      console.log('Data channel opened with:', peerId);
      updateConnectionStatus();
      updatePeerList();
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
      updateConnectionStatus();
      updatePeerList();
    };
  },
  
  // Chunked message storage
  chunkedMessages: {},
  
  handleMessage(fromPeerId, message) {
    // Handle chunked messages
    if (message.type === 'chunk') {
      const { messageId, chunkIndex, totalChunks, data } = message;
      
      if (!this.chunkedMessages[messageId]) {
        this.chunkedMessages[messageId] = {
          chunks: new Array(totalChunks),
          received: 0,
          totalChunks
        };
      }
      
      const cm = this.chunkedMessages[messageId];
      if (!cm.chunks[chunkIndex]) {
        cm.chunks[chunkIndex] = data;
        cm.received++;
      }
      
      if (cm.received === cm.totalChunks) {
        const fullMessageStr = cm.chunks.join('');
        delete this.chunkedMessages[messageId];
        
        try {
          const fullMessage = JSON.parse(fullMessageStr);
          this.handleMessage(fromPeerId, fullMessage);
        } catch (e) {
          console.error('Error parsing reassembled message:', e);
        }
      }
      return;
    }
    
    switch (message.type) {
      case 'post':
        addPost(message.data, false);
        break;
      case 'sync-request':
        state.posts.slice(-20).forEach(post => {
          this.sendToPeer(fromPeerId, { type: 'post', data: post });
        });
        break;
      case 'name-change':
        const peer = state.peers.get(fromPeerId);
        if (peer) {
          peer.info.displayName = message.data.newName;
          updatePeerList();
        }
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  },
  
  sendToPeer(peerId, message) {
    const peer = state.peers.get(peerId);
    if (peer && peer.dataChannel && peer.dataChannel.readyState === 'open') {
      const messageStr = JSON.stringify(message);
      this.sendChunked(peer.dataChannel, messageStr);
    }
  },
  
  broadcast(message) {
    const messageStr = JSON.stringify(message);
    state.peers.forEach((peer, peerId) => {
      if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
        this.sendChunked(peer.dataChannel, messageStr);
      }
    });
  },
  
  sendChunked(channel, messageStr) {
    const CHUNK_SIZE = 16000;
    
    if (messageStr.length > CHUNK_SIZE) {
      const messageId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
      const totalChunks = Math.ceil(messageStr.length / CHUNK_SIZE);
      
      for (let i = 0; i < totalChunks; i++) {
        const chunk = messageStr.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        channel.send(JSON.stringify({
          type: 'chunk',
          messageId,
          chunkIndex: i,
          totalChunks,
          data: chunk
        }));
      }
    } else {
      channel.send(messageStr);
    }
  }
};

// ============================================
// UI Updates
// ============================================

function updateConnectionStatus() {
  const dot = document.getElementById('connectionDot');
  const text = document.getElementById('connectionStatus');
  
  // Count WebRTC-connected peers
  let connectedCount = 0;
  state.peers.forEach(peer => {
    if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
      connectedCount++;
    }
  });
  
  dot.className = 'status-dot';
  
  if (connectedCount > 0) {
    dot.classList.add('connected');
    text.textContent = 'Connected';
  } else {
    text.textContent = 'Searching...';
  }
}

function updatePeerList() {
  const peerList = document.getElementById('peerList');
  peerList.innerHTML = '';
  
  let hasConnectedPeers = false;
  
  state.peers.forEach((peer, peerId) => {
    if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
      hasConnectedPeers = true;
      
      const peerEl = document.createElement('div');
      peerEl.className = 'peer-item';
      peerEl.innerHTML = `
        <div class="peer-avatar" style="background: ${getAvatarColor(peerId)}">${getInitials(peer.info?.displayName)}</div>
        <div class="peer-info">
          <div class="peer-name">${peer.info?.displayName || 'Unknown'}</div>
          <div class="peer-status">Connected</div>
        </div>
      `;
      peerList.appendChild(peerEl);
    }
  });
  
  if (!hasConnectedPeers) {
    peerList.innerHTML = '<div class="no-peers">No peers connected yet</div>';
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
      if (item.type && item.type.startsWith('image/')) {
        mediaHtml += `<div class="post-media"><img src="${item.data}" alt="Post image"></div>`;
      } else if (item.type && item.type.startsWith('video/')) {
        mediaHtml += `<div class="post-media"><video src="${item.data}" controls playsinline></video></div>`;
      }
    });
  }
  
  // Convert URLs to links
  let content = escapeHtml(post.content);
  
  postEl.innerHTML = `
    <div class="post-header">
      <div class="post-avatar" style="background: ${getAvatarColor(post.authorId)}">${getInitials(post.author)}</div>
      <div class="post-meta">
        <div class="post-author">${post.author}</div>
        <div class="post-time">${formatTime(post.timestamp)}</div>
      </div>
    </div>
    <div class="post-content">${content}</div>
    ${mediaHtml}
  `;
  
  feed.insertBefore(postEl, feed.firstChild);
  
  if (broadcast) {
    p2p.broadcast({ type: 'post', data: post });
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  let html = div.innerHTML;
  
  // Convert URLs to clickable links
  const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
  html = html.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  
  // Convert newlines
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

// ============================================
// Event Handlers
// ============================================

function setupEventListeners() {
  // Mobile menu
  document.getElementById('mobileMenuBtn').onclick = () => {
    document.getElementById('sidebar').classList.toggle('mobile-open');
  };
  
  // Initial name modal
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
  
  // Change name
  document.getElementById('myProfile').onclick = () => {
    document.getElementById('newNameInput').value = state.displayName;
    document.getElementById('changeNameModal').classList.add('active');
    document.getElementById('sidebar').classList.remove('mobile-open');
  };
  
  document.getElementById('confirmNameBtn').onclick = () => {
    const newName = document.getElementById('newNameInput').value.trim();
    if (newName && newName !== state.displayName) {
      state.displayName = newName;
      localStorage.setItem('p2p-displayName', newName);
      signaling.updateName();
      p2p.broadcast({ type: 'name-change', data: { newName } });
      updateUserUI();
      showToast('Name updated!', 'success');
    }
    document.getElementById('changeNameModal').classList.remove('active');
  };
  
  document.getElementById('cancelNameBtn').onclick = () => {
    document.getElementById('changeNameModal').classList.remove('active');
  };
  
  document.getElementById('newNameInput').onkeypress = (e) => {
    if (e.key === 'Enter') {
      document.getElementById('confirmNameBtn').click();
    }
  };
  
  // Post
  document.getElementById('postBtn').onclick = createPost;
  document.getElementById('postInput').onkeypress = (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      createPost();
    }
  };
  
  // Media
  document.getElementById('addImageBtn').onclick = () => {
    document.getElementById('imageInput').click();
  };
  
  document.getElementById('addVideoBtn').onclick = () => {
    document.getElementById('videoInput').click();
  };
  
  document.getElementById('imageInput').onchange = handleMediaSelect;
  document.getElementById('videoInput').onchange = handleMediaSelect;
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
  
  showToast('Posted!', 'success');
}

async function handleMediaSelect(event) {
  const files = Array.from(event.target.files);
  const preview = document.getElementById('mediaPreview');
  
  for (const file of files) {
    if (file.size > 25 * 1024 * 1024) {
      showToast('File too large (max 25MB)', 'error');
      continue;
    }
    
    if (file.size > 5 * 1024 * 1024) {
      showToast('Processing large file...', 'info');
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

function updateUserUI() {
  const initials = getInitials(state.displayName);
  document.getElementById('myAvatar').textContent = initials;
  document.getElementById('myAvatar').style.background = getAvatarColor(state.peerId);
  document.getElementById('myName').textContent = state.displayName;
  document.getElementById('composerAvatar').textContent = initials;
  document.getElementById('composerAvatar').style.background = getAvatarColor(state.peerId);
}

// ============================================
// Initialization
// ============================================

function initializeNetwork() {
  updateUserUI();
  updateConnectionStatus();
  
  signaling.announce();
  signaling.listenForSignals();
  signaling.listenForPeers();
  
  showToast('Connected to network!', 'success');
  
  // Periodically update UI
  setInterval(() => {
    updateConnectionStatus();
    updatePeerList();
  }, 3000);
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
