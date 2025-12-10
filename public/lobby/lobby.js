import { joinLobby, leaveLobby, getSocket } from '../client/socketClient.js';
import { setChatMode } from '../chat/chat.js';
import { getCurrentUser, isWalletConnected } from '../wallet/wallet.js';
import { requestChatHistory } from '../client/socketClient.js';
import { processPayment } from '../payment/paymentService.js';
import { getPfpUrl, loadPfp } from '../utils/pfpLoader.js';

// UI Elements
const lobbyContainer = document.getElementById('lobbyContainer');
const lobbyStatusText = document.getElementById('lobbyStatusText');
const lobbyTableBody = document.getElementById('lobbyTableBody');
const currentLobbyView = document.getElementById('currentLobbyView');
const currentLobbyName = document.getElementById('currentLobbyName');
const currentLobbyStake = document.getElementById('currentLobbyStake');
const currentLobbyCount = document.getElementById('currentLobbyCount');
const currentLobbyStatus = document.getElementById('currentLobbyStatus');
const lobbyPlayers = document.getElementById('lobbyPlayers');
const leaveLobbyBtn = document.getElementById('leaveLobbyBtn');
const lobbyMessage = document.getElementById('lobbyMessage');

let currentLobbyId = null;
let allLobbies = [];

/**
 * Update lobby UI based on wallet connection status
 */
function updateLobbyForWalletConnection() {
    const walletConnected = isWalletConnected();
    
    // Update status text
    if (walletConnected) {
        if (lobbyStatusText && (lobbyStatusText.textContent.includes('Please connect') || lobbyStatusText.textContent.includes('Disconnected'))) {
            lobbyStatusText.textContent = 'Connected! Select a lobby to join.';
        }
    } else {
        if (lobbyStatusText) {
            lobbyStatusText.textContent = 'Please connect your wallet to join lobbies.';
        }
    }
    
    // Re-render lobby list to update button states
    if (allLobbies.length > 0 && !currentLobbyId) {
        renderLobbyList(allLobbies);
    }
}

/**
 * Initialize lobby UI
 */
export function initLobby() {
    // Show lobby initially
    lobbyContainer.style.display = 'flex';
    
    // Set up leave lobby button
    leaveLobbyBtn.addEventListener('click', () => {
        if (currentLobbyId) {
            leaveLobby();
            currentLobbyId = null;
            setChatMode('all');
            showLobbyList();
            showMessage('Left lobby', 'info');
        }
    });
    
    // Initialize lobby table display
    lobbyTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888; padding: 20px;">Loading lobbies...</td></tr>';
    
    // Listen for wallet connection changes
    window.addEventListener('walletConnectionChanged', () => {
        updateLobbyForWalletConnection();
        // Also check for reconnection when wallet connects
        // (in case socket connected before wallet was ready)
        checkForReconnection();
    });
    
    // Initial update based on current wallet state
    setTimeout(() => {
        updateLobbyForWalletConnection();
    }, 100);
}

/**
 * Check for reconnection to active game
 * This can be called when socket connects or when wallet connects
 */
function checkForReconnection() {
    const socket = getSocket();
    if (!socket || !socket.connected) {
        // Socket not ready yet, try again in a bit
        setTimeout(checkForReconnection, 500);
        return;
    }
    
    // Check for reconnection to active game (using wallet if available)
    if (isWalletConnected()) {
        const user = getCurrentUser();
        if (user && user.username) {
            socket.emit('check_reconnection', { 
                playerName: user.username,
                wallet: user.wallet 
            });
            return;
        }
    }
    
    // Fallback to old localStorage method for backward compatibility
    const storedPlayerName = localStorage.getItem('unoPlayerName');
    if (storedPlayerName) {
        socket.emit('check_reconnection', { playerName: storedPlayerName });
    }
}

/**
 * Get lobby callbacks for socket events
 */
export function getLobbyCallbacks() {
    return {
        onConnect: () => {
            // Check for reconnection (will retry if wallet not ready)
            checkForReconnection();
            
            // Request lobby list
            const socket = getSocket();
            if (socket) {
                socket.emit('request_lobby_list');
            }
            
            // Update status based on wallet connection
            if (isWalletConnected()) {
                lobbyStatusText.textContent = 'Connected! Select a lobby to join.';
                showMessage('Connected to server', 'success');
                // Request chat history when connected
                requestChatHistory('all', null);
            } else {
                lobbyStatusText.textContent = 'Please connect your wallet to join lobbies.';
                showMessage('Connect your wallet to play', 'info');
            }
        },
        onDisconnect: () => {
            lobbyStatusText.textContent = 'Disconnected from server';
            showMessage('Disconnected from server', 'error');
        },
        onLobbyList: (lobbies) => {
            allLobbies = lobbies;
            if (!currentLobbyId) {
                renderLobbyList(lobbies);
            } else {
                // Update lobby list but keep current lobby view
                renderLobbyList(lobbies);
            }
        },
        onLobbyJoined: (lobby) => {
            currentLobbyId = lobby.id;
            showCurrentLobby(lobby);
            setChatMode('lobby', lobby.id);
            showMessage(`Joined ${lobby.name}`, 'success');
        },
        onPlayerJoined: (lobby) => {
            if (currentLobbyId === lobby.id) {
                updateCurrentLobby(lobby);
            }
            // Update lobby list
            const lobbyIndex = allLobbies.findIndex(l => l.id === lobby.id);
            if (lobbyIndex !== -1) {
                allLobbies[lobbyIndex] = lobby;
                renderLobbyList(allLobbies);
            }
        },
        onPlayerLeft: (lobby) => {
            if (currentLobbyId === lobby.id) {
                updateCurrentLobby(lobby);
            }
            // Update lobby list
            const lobbyIndex = allLobbies.findIndex(l => l.id === lobby.id);
            if (lobbyIndex !== -1) {
                allLobbies[lobbyIndex] = lobby;
                renderLobbyList(allLobbies);
            }
        },
        onLobbyError: (error) => {
            showMessage(error.message || 'Lobby error', 'error');
        },
        onGameCountdown: (data) => {
            handleGameCountdown(data);
        },
        onGameStart: () => {
            showMessage('Game starting!', 'success');
        },
        onPaymentRefunded: (data) => {
            showMessage(`Refunded ${data.amount.toFixed(2)} SOL. Transaction: ${data.signature.substring(0, 8)}...`, 'success');
        },
        onRefundError: (data) => {
            showMessage(`Refund error: ${data.error}`, 'error');
        }
    };
}

/**
 * Render lobby list as table rows
 */
function renderLobbyList(lobbies) {
    lobbyTableBody.innerHTML = '';
    
    if (lobbies.length === 0) {
        lobbyTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888; padding: 20px;">No lobbies available</td></tr>';
        return;
    }
    
    lobbies.forEach(lobby => {
        const row = createLobbyTableRow(lobby);
        lobbyTableBody.appendChild(row);
    });
}

/**
 * Create a lobby table row element
 */
function createLobbyTableRow(lobby) {
    const row = document.createElement('tr');
    row.className = `lobby-row ${lobby.status === 'full' ? 'full' : lobby.status === 'in-game' ? 'in-game' : ''}`;
    row.dataset.lobbyId = lobby.id; // Store lobby ID for reference
    
    const statusText = lobby.status === 'full' ? 'Full' : 
                      lobby.status === 'in-game' ? 'Match In Progress' : 
                      'Waiting';
    
    const isJoinable = lobby.status === 'waiting' && lobby.playerCount < lobby.maxPlayers;
    const walletConnected = isWalletConnected();
    const canJoin = isJoinable && walletConnected;
    
    row.innerHTML = `
        <td class="lobby-name-cell">
            <span class="lobby-name">${lobby.name}</span>
        </td>
        <td class="lobby-stake-cell">
            <span class="lobby-stake">${lobby.solStake.toFixed(2)} <span class="sol-symbol">SOL</span></span>
        </td>
        <td class="lobby-mode-cell">
            <span class="lobby-mode">
                <img src="assets/site/${lobby.maxPlayers}p.png" alt="${lobby.maxPlayers} players" class="lobby-mode-icon">
                <span class="lobby-mode-text">${lobby.maxPlayers}P</span>
            </span>
        </td>
        <td class="lobby-players-cell">
            <span class="lobby-players-count">${lobby.playerCount}/${lobby.maxPlayers}</span>
        </td>
        <td class="lobby-status-cell">
            <span class="lobby-status-badge ${lobby.status}">${statusText}</span>
        </td>
        <td class="lobby-action-cell">
            <button class="lobby-join-btn" ${!canJoin ? 'disabled' : ''}>
                ${!walletConnected ? 'Connect Wallet' : 
                  isJoinable ? 'Join' : 
                  (lobby.status === 'in-game' ? 'Watching' : statusText)}
            </button>
        </td>
    `;
    
    // Add click handler
    const joinBtn = row.querySelector('.lobby-join-btn');
    if (canJoin) {
        joinBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            joinLobbyById(lobby.id);
        });
    } else if (isJoinable && !walletConnected) {
        // If joinable but wallet not connected, trigger wallet connection
        joinBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showMessage('Please connect your wallet to join a lobby', 'error');
            const walletBtn = document.getElementById('connectWalletBtn');
            if (walletBtn) {
                walletBtn.click();
            }
        });
    }
    
    // Add row click handler for better UX
    if (isJoinable) {
        row.style.cursor = 'pointer';
        row.addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON') {
                joinLobbyById(lobby.id);
            }
        });
    }
    
    return row;
}

/**
 * Join a lobby by ID
 */
async function joinLobbyById(lobbyId) {
    // Check if wallet is connected
    if (!isWalletConnected()) {
        showMessage('Please connect your wallet to join a lobby', 'error');
        // Optionally trigger wallet connection
        const walletBtn = document.getElementById('connectWalletBtn');
        if (walletBtn) {
            walletBtn.click();
        }
        return;
    }
    
    // Get user from wallet
    const user = getCurrentUser();
    if (!user || !user.username) {
        showMessage('Please set your username before joining a lobby', 'error');
        return;
    }
    
    // Find the lobby to get SOL amount for display
    const lobby = allLobbies.find(l => l.id === lobbyId);
    const solAmount = lobby ? lobby.solStake : 0;
    
    // Show loading state
    showMessage(`Processing payment of ${solAmount.toFixed(2)} SOL...`, 'info');
    
    // Disable join buttons during payment
    const joinButtons = document.querySelectorAll('.lobby-join-btn');
    joinButtons.forEach(btn => btn.disabled = true);
    
    try {
        // Get the actual connected wallet address (more reliable than stored value)
        if (!window.solana) {
            throw new Error('Solana wallet not found. Please install Phantom or another Solana wallet.');
        }
        
        if (!window.solana.isConnected) {
            throw new Error('Wallet not connected. Please connect your wallet.');
        }
        
        if (!window.solana.publicKey) {
            throw new Error('Wallet not connected. Please reconnect your wallet.');
        }
        
        const connectedWallet = window.solana.publicKey.toString();
        // Process payment using the connected wallet
        const paymentSignature = await processPayment(connectedWallet, lobbyId);
        
        // Payment successful, now join lobby
        showMessage('Payment successful! Joining lobby...', 'success');
        
        const socket = getSocket();
        if (socket) {
            socket.emit('join_lobby', { 
                playerName: user.username,
                wallet: connectedWallet,
                lobbyId,
                paymentSignature
            });
        }
    } catch (error) {
        showMessage(error.message || 'Payment failed. Please try again.', 'error');
        
        // Re-enable join buttons
        joinButtons.forEach(btn => {
            const row = btn.closest('tr');
            const lobby = allLobbies.find(l => l.id === row?.dataset?.lobbyId);
            if (lobby && lobby.status === 'waiting' && lobby.playerCount < lobby.maxPlayers) {
                btn.disabled = false;
            }
        });
    }
}

/**
 * Show current lobby view
 */
function showCurrentLobby(lobby) {
    currentLobbyView.style.display = 'block';
    document.querySelector('.lobby-table-container').style.display = 'none';
    updateCurrentLobby(lobby);
}

/**
 * Show lobby list (hide current lobby view)
 */
export function showLobbyList() {
    currentLobbyView.style.display = 'none';
    document.querySelector('.lobby-table-container').style.display = 'block';
    currentLobbyId = null;
    setChatMode('all');
    
    // Reset countdown state if active
    if (currentLobbyStatus) {
        currentLobbyStatus.classList.remove('countdown-active');
        currentLobbyStatus.style.fontSize = '';
        currentLobbyStatus.style.fontWeight = '';
        currentLobbyStatus.style.color = '';
        currentLobbyStatus.style.animation = '';
    }
    
    // Request updated lobby list
    const socket = getSocket();
    if (socket) {
        socket.emit('request_lobby_list');
    }
}

/**
 * Update current lobby display
 */
function updateCurrentLobby(lobby) {
    currentLobbyName.textContent = lobby.name;
    currentLobbyStake.textContent = `${lobby.solStake.toFixed(2)} SOL`;
    currentLobbyCount.textContent = `${lobby.playerCount}/${lobby.maxPlayers}`;
    
    // Update player slots
    updatePlayerSlots(lobby.maxPlayers);
    
    // Update player cards with profile pictures
    for (let i = 0; i < lobby.maxPlayers; i++) {
        const cardElement = document.getElementById(`player${i + 1}Card`);
        if (cardElement) {
            const avatarContainer = cardElement.querySelector('.player-card-avatar-container');
            
            if (lobby.players[i]) {
                const player = lobby.players[i];
                const playerName = player.name || `Player ${i + 1}`;
                const pfpUrl = getPfpUrl({ pfpUrl: player.pfpUrl });
                
                // Update card to occupied state
                cardElement.className = 'player-card occupied';
                
                // Replace placeholder with actual avatar image
                if (avatarContainer) {
                    avatarContainer.innerHTML = `
                        <img class="player-card-avatar" src="${pfpUrl}" alt="${playerName}'s avatar" onerror="this.src='/pfp/default.jpg'">
                    `;
                }
                
                // Update name
                const nameElement = cardElement.querySelector('.player-card-name');
                if (nameElement) {
                    nameElement.textContent = playerName;
                }
                
                // Update status
                const statusElement = cardElement.querySelector('.player-card-status');
                if (statusElement) {
                    statusElement.textContent = 'Ready';
                    statusElement.className = 'player-card-status ready';
                }
                
                // Load and cache pfp in background
                const userId = player.wallet || player.id || playerName;
                loadPfp(pfpUrl, userId).catch(() => {
                    // Silently fail
                });
            } else {
                // Empty slot
                cardElement.className = 'player-card empty';
                
                // Replace avatar image with placeholder
                if (avatarContainer) {
                    avatarContainer.innerHTML = `
                        <div class="player-card-avatar-placeholder">
                            <span class="avatar-question-mark">?</span>
                        </div>
                    `;
                }
                
                const nameElement = cardElement.querySelector('.player-card-name');
                if (nameElement) {
                    nameElement.textContent = 'Waiting...';
                }
                
                const statusElement = cardElement.querySelector('.player-card-status');
                if (statusElement) {
                    statusElement.textContent = 'Empty slot';
                    statusElement.className = 'player-card-status empty';
                }
            }
        }
    }
    
    // Update status (only if not showing countdown)
    if (!currentLobbyStatus.classList.contains('countdown-active')) {
        if (lobby.playerCount === lobby.maxPlayers) {
            currentLobbyStatus.textContent = 'Lobby full! Game starting soon...';
        } else if (lobby.playerCount > 0) {
            currentLobbyStatus.textContent = `Waiting for ${lobby.maxPlayers - lobby.playerCount} more player${lobby.maxPlayers - lobby.playerCount > 1 ? 's' : ''}...`;
        } else {
            currentLobbyStatus.textContent = 'Waiting for players...';
        }
    }
}

/**
 * Handle game countdown
 */
function handleGameCountdown(data) {
    if (!currentLobbyStatus || !currentLobbyView || currentLobbyView.style.display === 'none') {
        return; // Not in lobby view
    }
    
    if (data.countdown !== undefined) {
        // Show countdown
        currentLobbyStatus.classList.add('countdown-active');
        currentLobbyStatus.textContent = `Game begins in ${data.countdown}...`;
        currentLobbyStatus.style.fontSize = '1.2em';
        currentLobbyStatus.style.fontWeight = '600';
        currentLobbyStatus.style.color = '#8b9cff';
        
        // Add pulse animation
        currentLobbyStatus.style.animation = 'pulse 0.5s ease-in-out';
        
        if (data.countdown <= 0) {
            // Countdown finished
            currentLobbyStatus.textContent = 'Starting game...';
        }
    } else {
        // Countdown started
        currentLobbyStatus.classList.add('countdown-active');
        currentLobbyStatus.textContent = 'Game begins in 3...';
        currentLobbyStatus.style.fontSize = '1.2em';
        currentLobbyStatus.style.fontWeight = '600';
        currentLobbyStatus.style.color = '#8b9cff';
    }
}

/**
 * Create/update player slots based on game mode
 */
function updatePlayerSlots(maxPlayers) {
    lobbyPlayers.innerHTML = '';
    
    for (let i = 0; i < maxPlayers; i++) {
        const slotDiv = document.createElement('div');
        slotDiv.className = 'player-slot';
        slotDiv.innerHTML = `
            <div class="player-card empty" id="player${i + 1}Card">
                <div class="player-card-avatar-container">
                    <div class="player-card-avatar-placeholder">
                        <span class="avatar-question-mark">?</span>
                    </div>
                </div>
                <div class="player-card-info">
                    <div class="player-card-name">Waiting...</div>
                    <div class="player-card-status">Empty slot</div>
                </div>
            </div>
        `;
        lobbyPlayers.appendChild(slotDiv);
    }
}

/**
 * Hide lobby and show game
 */
export function hideLobby() {
    lobbyContainer.style.display = 'none';
}

/**
 * Show lobby and hide game
 */
export function showLobby() {
    lobbyContainer.style.display = 'flex';
    showLobbyList();
    showMessage('Returned to lobby', 'info');
}

/**
 * Show message in lobby
 */
export function showMessage(text, type = 'info') {
    lobbyMessage.textContent = text;
    lobbyMessage.className = `lobby-message ${type}`;
    setTimeout(() => {
        lobbyMessage.textContent = '';
        lobbyMessage.className = 'lobby-message';
    }, 3000);
}
