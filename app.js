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

// Global State
const state = {
  peerId: null,
  displayName: null,
  peers: new Map(),
  posts: [],
  mediaQueue: [],
  likes: new Set() // Track liked posts
};

// WebRTC Configuration with TURN servers
const rtcConfig = {const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:108.161.143.143:3478',
      username: 'p2psocial',
      credential: 'ChangeThisPassword123'
    },
    {
      urls: 'turn:108.161.143.143:3478?transport=tcp',
      username: 'p2psocial',
      credential: 'ChangeThisPassword123'
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  let html = div.innerHTML;
  
  // Convert URLs to clickable links
  const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
  html = html.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  
  html = html.replace(/\n/g, '<br>');
  return html;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  
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

// Helper to safely add event listeners
function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener(event, handler);
  } else {
    console.warn(`Element not found: ${id}`);
  }
}

// ============================================
// URL Sharing
// ============================================

function getPostUrl(postId) {
  const url = new URL(window.location.href);
  url.hash = `post-${postId}`;
  return url.toString();
}

function checkUrlForPost() {
  const hash = window.location.hash;
  if (hash && hash.startsWith('#post-')) {
    const postId = hash.replace('#post-', '');
    setTimeout(() => scrollToPost(postId), 500);
  }
}

function scrollToPost(postId) {
  const postEl = document.getElementById(`post-${postId}`);
  if (postEl) {
    postEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    postEl.classList.add('highlighted');
    setTimeout(() => postEl.classList.remove('highlighted'), 3000);
  }
}

// ============================================
// Firebase Signaling
// ============================================

const signaling = {
  async announce() {
    console.log('Announcing peer:', state.peerId);
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
    console.log(`Sending ${type} to ${targetPeerId}`);
    const signalRef = database.ref(`signals/${targetPeerId}`).push();
    await signalRef.set({
      type,
      data,
      from: state.peerId,
      fromName: state.displayName,
      timestamp: Date.now()
    });
    
    setTimeout(() => signalRef.remove().catch(() => {}), 30000);
  },
  
  listenForSignals() {
    console.log('Listening for signals...');
    
    database.ref(`signals/${state.peerId}`).on('child_added', async (snapshot) => {
      const signal = snapshot.val();
      if (signal) {
        console.log('Received signal:', signal.type, 'from:', signal.from);
        await this.handleSignal(signal);
      }
      snapshot.ref.remove().catch(() => {});
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
    console.log('Listening for peers...');
    
    database.ref('peers').on('value', (snapshot) => {
      const peers = snapshot.val() || {};
      let onlineCount = 0;
      
      Object.entries(peers).forEach(([peerId, info]) => {
        if (peerId === state.peerId) return;
        if (Date.now() - info.lastSeen > 30000) return;
        
        onlineCount++;
        console.log('Found peer:', peerId, info.displayName);
        
        if (!state.peers.has(peerId)) {
          p2p.connectToPeer(peerId, info.displayName);
        }
      });
      
      const peerCountEl = document.getElementById('peerCount');
      if (peerCountEl) peerCountEl.textContent = onlineCount;
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
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signaling.sendSignal(peerId, 'ice-candidate', event.candidate.toJSON());
      }
    };
    
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      await signaling.sendSignal(peerId, 'offer', {
        sdp: pc.localDescription.sdp,
        type: pc.localDescription.type
      });
    } catch (err) {
      console.error('Error creating offer:', err);
      state.peers.delete(peerId);
    }
  },
  
  async handleOffer(peerId, displayName, offer) {
    console.log('Handling offer from:', peerId);
    
    if (state.peers.has(peerId)) {
      const existing = state.peers.get(peerId);
      if (existing.connection.connectionState === 'connected') return;
      if (existing.connection.connectionState !== 'failed' && state.peerId < peerId) return;
      existing.connection.close();
      state.peers.delete(peerId);
    }
    
    const pc = new RTCPeerConnection(rtcConfig);
    state.peers.set(peerId, { 
      connection: pc, 
      dataChannel: null, 
      info: { displayName },
      connected: false
    });
    
    pc.ondatachannel = (event) => {
      console.log('Received data channel from:', peerId);
      const peer = state.peers.get(peerId);
      if (peer) {
        peer.dataChannel = event.channel;
        this.setupDataChannel(event.channel, peerId);
      }
    };
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signaling.sendSignal(peerId, 'ice-candidate', event.candidate.toJSON());
      }
    };
    
    this.setupConnectionHandlers(pc, peerId);
    
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      await signaling.sendSignal(peerId, 'answer', {
        sdp: pc.localDescription.sdp,
        type: pc.localDescription.type
      });
    } catch (err) {
      console.error('Error handling offer:', err);
      state.peers.delete(peerId);
    }
  },
  
  async handleAnswer(peerId, answer) {
    console.log('Handling answer from:', peerId);
    const peer = state.peers.get(peerId);
    if (peer && peer.connection.signalingState === 'have-local-offer') {
      try {
        await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (err) {
        console.error('Error setting remote description:', err);
      }
    }
  },
  
  async handleIceCandidate(peerId, candidate) {
    const peer = state.peers.get(peerId);
    if (peer && candidate && peer.connection.remoteDescription) {
      try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        // Ignore
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
    
    pc.oniceconnectionstatechange = () => {
      console.log(`ICE state with ${peerId}:`, pc.iceConnectionState);
    };
  },
  
  setupDataChannel(channel, peerId) {
    channel.onopen = () => {
      console.log('✅ Data channel OPEN with:', peerId);
      updateConnectionStatus();
      updatePeerList();
      this.sendToPeer(peerId, { type: 'sync-request' });
    };
    
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(peerId, message);
      } catch (err) {
        console.error('Error parsing message:', err);
      }
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
  
  chunkedMessages: {},
  
  handleMessage(fromPeerId, message) {
    if (message.type === 'chunk') {
      const { messageId, chunkIndex, totalChunks, data } = message;
      
      if (!this.chunkedMessages[messageId]) {
        this.chunkedMessages[messageId] = { chunks: new Array(totalChunks), received: 0 };
      }
      
      const cm = this.chunkedMessages[messageId];
      if (!cm.chunks[chunkIndex]) {
        cm.chunks[chunkIndex] = data;
        cm.received++;
      }
      
      if (cm.received === totalChunks) {
        try {
          const fullMessage = JSON.parse(cm.chunks.join(''));
          delete this.chunkedMessages[messageId];
          this.handleMessage(fromPeerId, fullMessage);
        } catch (e) {
          console.error('Error reassembling message:', e);
        }
      }
      return;
    }
    
    switch (message.type) {
      case 'post':
        addPost(message.data, false);
        break;
      case 'sync-request':
        state.posts.forEach(post => {
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
    }
  },
  
  sendToPeer(peerId, message) {
    const peer = state.peers.get(peerId);
    if (peer?.dataChannel?.readyState === 'open') {
      const str = JSON.stringify(message);
      this.sendChunked(peer.dataChannel, str);
    }
  },
  
  broadcast(message) {
    const str = JSON.stringify(message);
    state.peers.forEach((peer) => {
      if (peer.dataChannel?.readyState === 'open') {
        this.sendChunked(peer.dataChannel, str);
      }
    });
  },
  
  sendChunked(channel, str) {
    const CHUNK_SIZE = 16000;
    if (str.length > CHUNK_SIZE) {
      const messageId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
      const totalChunks = Math.ceil(str.length / CHUNK_SIZE);
      for (let i = 0; i < totalChunks; i++) {
        channel.send(JSON.stringify({
          type: 'chunk',
          messageId,
          chunkIndex: i,
          totalChunks,
          data: str.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
        }));
      }
    } else {
      channel.send(str);
    }
  }
};

// ============================================
// UI Updates
// ============================================

function updateConnectionStatus() {
  const dot = document.getElementById('connectionDot');
  const text = document.getElementById('connectionStatus');
  if (!dot || !text) return;
  
  let connectedCount = 0;
  state.peers.forEach(peer => {
    if (peer.dataChannel?.readyState === 'open') connectedCount++;
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
  if (!peerList) return;
  
  peerList.innerHTML = '';
  let hasConnectedPeers = false;
  
  state.peers.forEach((peer, peerId) => {
    if (peer.dataChannel?.readyState === 'open') {
      hasConnectedPeers = true;
      const el = document.createElement('div');
      el.className = 'peer-item';
      el.innerHTML = `
        <div class="peer-avatar" style="background: ${getAvatarColor(peerId)}">${getInitials(peer.info?.displayName)}</div>
        <div class="peer-info">
          <div class="peer-name">${peer.info?.displayName || 'Unknown'}</div>
          <div class="peer-status">Connected</div>
        </div>
      `;
      peerList.appendChild(el);
    }
  });
  
  if (!hasConnectedPeers) {
    peerList.innerHTML = '<div class="no-peers">No peers connected yet</div>';
  }
}

function updateUserUI() {
  const initials = getInitials(state.displayName);
  const avatarColor = getAvatarColor(state.peerId);
  
  const myAvatar = document.getElementById('myAvatar');
  const myName = document.getElementById('myName');
  const composerAvatar = document.getElementById('composerAvatar');
  
  if (myAvatar) {
    myAvatar.textContent = initials;
    myAvatar.style.background = avatarColor;
  }
  if (myName) myName.textContent = state.displayName;
  if (composerAvatar) {
    composerAvatar.textContent = initials;
    composerAvatar.style.background = avatarColor;
  }
}

// ============================================
// Posts
// ============================================

function addPost(post, broadcast = true) {
  if (state.posts.some(p => p.id === post.id)) return;
  
  state.posts.push(post);
  
  const emptyState = document.getElementById('emptyState');
  if (emptyState) emptyState.style.display = 'none';
  
  renderPost(post);
  
  if (broadcast) {
    p2p.broadcast({ type: 'post', data: post });
  }
}

function renderPost(post) {
  const feed = document.getElementById('feed');
  if (!feed || document.getElementById(`post-${post.id}`)) return;
  
  const postEl = document.createElement('article');
  postEl.className = 'post';
  postEl.id = `post-${post.id}`;
  
  let mediaHtml = '';
  if (post.media?.length > 0) {
    post.media.forEach(item => {
      if (item.type?.startsWith('image/')) {
        mediaHtml += `<div class="post-media"><img src="${item.data}" alt="Image"></div>`;
      } else if (item.type?.startsWith('video/')) {
        mediaHtml += `<div class="post-media"><video src="${item.data}" controls playsinline></video></div>`;
      }
    });
  }
  
  const isLiked = state.likes.has(post.id);
  
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
      <button class="post-action ${isLiked ? 'liked' : ''}" onclick="likePost('${post.id}')">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        Like
      </button>
      <button class="post-action" onclick="sharePost('${post.id}')">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>
        Share
      </button>
      <button class="post-action" onclick="replyToPost('${post.id}', '${post.author}')">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/></svg>
        Reply
      </button>
    </div>
  `;
  
  feed.insertBefore(postEl, feed.firstChild);
}

// Post actions (global functions for onclick)
window.likePost = function(postId) {
  const btn = document.querySelector(`#post-${postId} .post-action`);
  if (state.likes.has(postId)) {
    state.likes.delete(postId);
    if (btn) btn.classList.remove('liked');
    showToast('Unliked');
  } else {
    state.likes.add(postId);
    if (btn) btn.classList.add('liked');
    showToast('Liked!', 'success');
  }
};

window.sharePost = function(postId) {
  const url = getPostUrl(postId);
  
  if (navigator.share) {
    navigator.share({
      title: 'P2P Social Post',
      url: url
    }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url).then(() => {
      showToast('Link copied!', 'success');
    }).catch(() => {
      showToast('Could not copy link', 'error');
    });
  }
};

window.replyToPost = function(postId, author) {
  const input = document.getElementById('postInput');
  if (input) {
    input.value = `@${author} `;
    input.focus();
  }
};

async function createPost() {
  const input = document.getElementById('postInput');
  if (!input) return;
  
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
  const preview = document.getElementById('mediaPreview');
  if (preview) preview.innerHTML = '';
  
  showToast('Posted!', 'success');
}

async function handleMediaSelect(event) {
  const files = Array.from(event.target.files);
  const preview = document.getElementById('mediaPreview');
  if (!preview) return;
  
  for (const file of files) {
    if (file.size > 25 * 1024 * 1024) {
      showToast('File too large (max 25MB)', 'error');
      continue;
    }
    
    if (file.size > 5 * 1024 * 1024) {
      showToast('Processing...', 'info');
    }
    
    const data = await fileToBase64(file);
    state.mediaQueue.push({ type: file.type, data, name: file.name });
    
    const previewItem = document.createElement('div');
    previewItem.className = 'preview-item';
    
    if (file.type.startsWith('image/')) {
      previewItem.innerHTML = `<img src="${data}" alt="">`;
    } else if (file.type.startsWith('video/')) {
      previewItem.innerHTML = `<video src="${data}"></video>`;
    }
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'preview-remove';
    removeBtn.textContent = '×';
    removeBtn.onclick = () => {
      const idx = state.mediaQueue.findIndex(m => m.name === file.name);
      if (idx > -1) state.mediaQueue.splice(idx, 1);
      previewItem.remove();
    };
    previewItem.appendChild(removeBtn);
    preview.appendChild(previewItem);
  }
  
  event.target.value = '';
}

// ============================================
// Event Listeners
// ============================================

function setupEventListeners() {
  // Mobile menu
  on('menuBtn', 'click', (e) => {
    e.stopPropagation();
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.classList.toggle('open');
      console.log('Menu toggled');
    }
  });
  
  // Close sidebar on outside click
  document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const menuBtn = document.getElementById('menuBtn');
    if (sidebar?.classList.contains('open') && 
        !sidebar.contains(e.target) && 
        e.target !== menuBtn && 
        !menuBtn?.contains(e.target)) {
      sidebar.classList.remove('open');
    }
  });
  
  // Initial name modal
  on('saveNameBtn', 'click', () => {
    const input = document.getElementById('nameInput');
    const name = input?.value.trim();
    if (name) {
      state.displayName = name;
      localStorage.setItem('p2p-displayName', name);
      const modal = document.getElementById('nameModal');
      if (modal) modal.classList.remove('active');
      initializeNetwork();
    }
  });
  
  on('nameInput', 'keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('saveNameBtn')?.click();
    }
  });
  
  // Change name
  on('myProfile', 'click', () => {
    const input = document.getElementById('newNameInput');
    if (input) input.value = state.displayName;
    document.getElementById('changeNameModal')?.classList.add('active');
    document.getElementById('sidebar')?.classList.remove('open');
  });
  
  on('confirmNameBtn', 'click', () => {
    const input = document.getElementById('newNameInput');
    const newName = input?.value.trim();
    if (newName && newName !== state.displayName) {
      state.displayName = newName;
      localStorage.setItem('p2p-displayName', newName);
      signaling.updateName();
      p2p.broadcast({ type: 'name-change', data: { newName } });
      updateUserUI();
      showToast('Name updated!', 'success');
    }
    document.getElementById('changeNameModal')?.classList.remove('active');
  });
  
  on('cancelNameBtn', 'click', () => {
    document.getElementById('changeNameModal')?.classList.remove('active');
  });
  
  on('newNameInput', 'keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('confirmNameBtn')?.click();
    }
  });
  
  // Post
  on('postBtn', 'click', createPost);
  
  on('postInput', 'keypress', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      createPost();
    }
  });
  
  // Media
  on('addImageBtn', 'click', () => {
    document.getElementById('imageInput')?.click();
  });
  
  on('addVideoBtn', 'click', () => {
    document.getElementById('videoInput')?.click();
  });
  
  on('imageInput', 'change', handleMediaSelect);
  on('videoInput', 'change', handleMediaSelect);
  
  // URL hash change
  window.addEventListener('hashchange', checkUrlForPost);
}

// ============================================
// Initialization
// ============================================

function initializeNetwork() {
  console.log('=== P2P Social Initializing ===');
  console.log('Peer ID:', state.peerId);
  console.log('Display name:', state.displayName);
  
  updateUserUI();
  updateConnectionStatus();
  
  signaling.announce();
  signaling.listenForSignals();
  signaling.listenForPeers();
  
  showToast('Connected to network!', 'success');
  
  // Check URL for post link
  checkUrlForPost();
  
  // Periodic UI update
  setInterval(() => {
    updateConnectionStatus();
    updatePeerList();
  }, 3000);
}

function init() {
  console.log('P2P Social starting...');
  
  state.peerId = localStorage.getItem('p2p-peerId') || generatePeerId();
  localStorage.setItem('p2p-peerId', state.peerId);
  
  state.displayName = localStorage.getItem('p2p-displayName');
  
  // Load saved likes
  try {
    const savedLikes = localStorage.getItem('p2p-likes');
    if (savedLikes) state.likes = new Set(JSON.parse(savedLikes));
  } catch (e) {}
  
  setupEventListeners();
  
  if (state.displayName) {
    document.getElementById('nameModal')?.classList.remove('active');
    initializeNetwork();
  } else {
    document.getElementById('nameModal')?.classList.add('active');
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
