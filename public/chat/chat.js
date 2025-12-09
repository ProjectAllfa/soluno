import { getSocket } from '../client/socketClient.js';
import { getCurrentUser, isWalletConnected } from '../wallet/wallet.js';
import { requestChatHistory } from '../client/socketClient.js';
import { loadPfp, getPfpUrl } from '../utils/pfpLoader.js';

// UI Elements
const chatTitle = document.getElementById('chatTitle');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');

let currentChatMode = 'all'; // 'all' or 'lobby'
let currentLobbyId = null; // Current lobby ID for lobby chat

// Chat restrictions
const MAX_MESSAGE_LENGTH = 300; // Maximum characters per message
const MAX_MESSAGES_PER_WINDOW = 3; // Maximum messages per time window
const RATE_LIMIT_WINDOW = 10000; // Time window in milliseconds (10 seconds)
const messageTimestamps = []; // Track message timestamps for rate limiting

/**
 * Initialize chat
 */
export function initChat() {
    // Set up send button
    chatSendBtn.addEventListener('click', sendMessage);
    
    // Set up enter key to send
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Update chat input state based on wallet connection
    updateChatInputState();
    
    // Listen for wallet connection changes
    window.addEventListener('walletConnectionChanged', (event) => {
        // Small delay to ensure wallet state is fully updated
        setTimeout(() => {
            updateChatInputState();
            // Request chat history (everyone can view, not just wallet-connected)
            requestChatHistory(currentChatMode, currentLobbyId);
        }, 50);
    });
    
    // Also check periodically in case event is missed (fallback)
    setInterval(() => {
        const wasEnabled = !chatInput.disabled;
        updateChatInputState();
        const isEnabled = !chatInput.disabled;
        // If state changed, update input state (but still allow viewing)
        // No need to reload history as it's already visible
    }, 1000);
}

/**
 * Set chat mode (all or lobby)
 */
export function setChatMode(mode, lobbyId = null) {
    currentChatMode = mode;
    currentLobbyId = lobbyId;
    
    if (mode === 'lobby') {
        chatTitle.textContent = 'LOBBY CHAT';
    } else {
        chatTitle.textContent = 'ALL CHAT';
    }
    
    // Update input state
    updateChatInputState();
    
    // Request chat history from server for the new mode (everyone can view)
    requestChatHistory(mode, lobbyId);
}

/**
 * Load chat history from server response
 */
async function loadChatHistory(messages) {
    // Clear current display
    chatMessages.innerHTML = '';
    
    // Allow viewing messages even without wallet connection
    if (!messages || messages.length === 0) {
        if (!isWalletConnected()) {
            chatMessages.innerHTML = '<div class="chat-welcome">Connect your wallet to send messages.</div>';
        } else {
            chatMessages.innerHTML = '<div class="chat-welcome">Welcome to chat! Start a conversation.</div>';
        }
        return;
    }
    
    // Sort by timestamp to ensure chronological order
    const sortedMessages = [...messages].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    
    // Display all messages (viewable by everyone) - await each to ensure proper loading
    for (const msg of sortedMessages) {
        await addChatMessageToDOM(msg);
    }
    
    // Scroll to bottom to show most recent messages
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Add message to DOM (without saving to history)
 */
async function addChatMessageToDOM(data) {
    const { playerName: senderName, message, timestamp, pfpUrl, wallet } = data;
    
    // Remove welcome message if present
    const welcome = chatMessages.querySelector('.chat-welcome');
    if (welcome) {
        welcome.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';
    
    const time = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Get pfp URL (use provided pfpUrl or default)
    const userPfpUrl = pfpUrl || getPfpUrl({ pfpUrl: null });
    const userId = wallet || senderName; // Use wallet as ID if available, fallback to name
    
    // Create message structure
    messageDiv.innerHTML = `
        <div class="chat-message-avatar-container">
            <img class="chat-message-avatar" src="${userPfpUrl}" alt="${escapeHtml(senderName)}'s avatar" onerror="this.src='/pfp/default.jpg'">
        </div>
        <div class="chat-message-content">
            <div class="chat-message-header">
                <span class="chat-message-username">${escapeHtml(senderName)}</span>
                <span class="chat-message-time">${time}</span>
            </div>
            <div class="chat-message-text">${escapeHtml(message)}</div>
        </div>
    `;
    
    chatMessages.appendChild(messageDiv);
    
    // Load and cache the pfp in background (for future use, doesn't block rendering)
    loadPfp(userPfpUrl, userId).catch(() => {
        // Silently fail - avatar will still show
    });
}

/**
 * Clear chat messages
 */
function clearChat() {
    chatMessages.innerHTML = '';
    if (!isWalletConnected()) {
        chatMessages.innerHTML = '<div class="chat-welcome">Connect your wallet to send messages.</div>';
    } else {
        chatMessages.innerHTML = '<div class="chat-welcome">Welcome to chat! Start a conversation.</div>';
    }
}

/**
 * Update chat input state based on wallet connection
 */
function updateChatInputState() {
    const walletConnected = isWalletConnected();
    const user = getCurrentUser();
    
    if (!walletConnected || !user || !user.username) {
        // Make chat read-only
        chatInput.disabled = true;
        chatSendBtn.disabled = true;
        chatInput.placeholder = 'Connect your wallet to chat...';
        chatInput.style.opacity = '0.6';
        chatSendBtn.style.opacity = '0.6';
    } else {
        // Enable chat
        chatInput.disabled = false;
        chatSendBtn.disabled = false;
        chatInput.placeholder = 'Type a message...';
        chatInput.style.opacity = '1';
        chatSendBtn.style.opacity = '1';
    }
}

/**
 * Send chat message
 */
function sendMessage() {
    // Check wallet connection
    if (!isWalletConnected()) {
        chatInput.placeholder = 'Connect your wallet to chat...';
        return;
    }
    
    const user = getCurrentUser();
    if (!user || !user.username) {
        chatInput.placeholder = 'Please set your username...';
        return;
    }
    
    const message = chatInput.value.trim();
    if (!message) return;
    
    // Check message length
    if (message.length > MAX_MESSAGE_LENGTH) {
        chatInput.placeholder = `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`;
        setTimeout(() => {
            if (chatInput.placeholder === `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`) {
                chatInput.placeholder = 'Type a message...';
            }
        }, 3000);
        return;
    }
    
    // Check rate limiting
    const now = Date.now();
    // Remove timestamps older than the rate limit window
    while (messageTimestamps.length > 0 && now - messageTimestamps[0] > RATE_LIMIT_WINDOW) {
        messageTimestamps.shift();
    }
    
    // Check if user has exceeded rate limit
    if (messageTimestamps.length >= MAX_MESSAGES_PER_WINDOW) {
        const timeUntilNext = Math.ceil((RATE_LIMIT_WINDOW - (now - messageTimestamps[0])) / 1000);
        chatInput.placeholder = `Please wait ${timeUntilNext} second${timeUntilNext !== 1 ? 's' : ''} before sending another message`;
        setTimeout(() => {
            if (chatInput.placeholder.startsWith('Please wait')) {
                chatInput.placeholder = 'Type a message...';
            }
        }, 3000);
        return;
    }
    
    // Record message timestamp
    messageTimestamps.push(now);
    
    const socket = getSocket();
    if (socket && socket.connected) {
        socket.emit('chat_message', {
            message: message,
            mode: currentChatMode,
            playerName: user.username,
            wallet: user.wallet
        });
        chatInput.value = '';
    }
}

/**
 * Add message to chat (from any user - server handles history)
 */
export async function addChatMessage(data) {
    // Ensure timestamp exists
    if (!data.timestamp) {
        data.timestamp = Date.now();
    }
    
    // Add to DOM (server handles saving to history)
    await addChatMessageToDOM(data);
    
    // Auto-scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Handle chat error from server
 */
function handleChatError(error) {
    const errorMessage = error.message || 'An error occurred while sending your message';
    chatInput.placeholder = errorMessage;
    setTimeout(() => {
        if (chatInput.placeholder === errorMessage) {
            chatInput.placeholder = 'Type a message...';
        }
    }, 3000);
}

/**
 * Get chat callbacks for socket events
 */
export function getChatCallbacks() {
    return {
        onChatMessage: async (data) => {
            await addChatMessage(data);
        },
        onChatHistory: async (data) => {
            // Load chat history from server
            if (data.messages && Array.isArray(data.messages)) {
                await loadChatHistory(data.messages);
            }
        },
        onChatError: (error) => {
            handleChatError(error);
        }
    };
}

