/**
 * WebSocket Client
 * Handles connection to server and game events
 */

let socket = null;
let isConnected = false;
let currentGameId = null;
let currentPlayerIndex = null;

// Simple message display function (fallback if not available)
function showMessage(message, type) {
    console.log(`[${type.toUpperCase()}] ${message}`);
}

/**
 * Initialize socket connection
 */
export function initSocket() {
    socket = io();
    
    // Make socket available globally for sidebar
    window.socketInstance = socket;
    
    socket.on('connect', () => {
        console.log('Connected to server');
        isConnected = true;
        if (onConnectCallback) {
            onConnectCallback();
        }
    });
    
    // Online users count
    socket.on('online_users_count', (data) => {
        const countElement = document.getElementById('onlineUsersCount');
        if (countElement) {
            countElement.textContent = data.count || 0;
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        isConnected = false;
        if (onDisconnectCallback) {
            onDisconnectCallback();
        }
    });
    
    // Lobby events
    socket.on('lobby_list', (lobbies) => {
        console.log('Lobby list updated:', lobbies);
        if (onLobbyListCallback) {
            onLobbyListCallback(lobbies);
        }
    });
    
    socket.on('lobby_joined', (lobby) => {
        console.log('Joined lobby:', lobby);
        if (onLobbyJoinedCallback) {
            onLobbyJoinedCallback(lobby);
        }
    });
    
    socket.on('player_joined', (lobby) => {
        console.log('Player joined lobby:', lobby);
        if (onPlayerJoinedCallback) {
            onPlayerJoinedCallback(lobby);
        }
    });
    
    socket.on('player_left', (lobby) => {
        console.log('Player left lobby:', lobby);
        if (onPlayerLeftCallback) {
            onPlayerLeftCallback(lobby);
        }
    });
    
    socket.on('lobby_error', (error) => {
        console.error('Lobby error:', error);
        if (onLobbyErrorCallback) {
            onLobbyErrorCallback(error);
        }
    });
    
    // Game events
    socket.on('game_start', (data) => {
        console.log('Game started:', data);
        currentGameId = data.gameId;
        currentPlayerIndex = data.playerIndex;
        if (onGameStartCallback) {
            onGameStartCallback(data);
        }
    });
    
    socket.on('game_state_update', (gameState) => {
        console.log('Game state updated:', gameState);
        if (onGameStateUpdateCallback) {
            onGameStateUpdateCallback(gameState);
        }
    });
    
    
    socket.on('game_error', (error) => {
        console.error('Game error:', error);
        if (onGameErrorCallback) {
            onGameErrorCallback(error);
        }
    });
    
    socket.on('turn_start', (data) => {
        console.log('Turn started:', data);
        if (onTurnStartCallback) {
            onTurnStartCallback(data);
        }
    });
    
    socket.on('turn_timeout', (data) => {
        console.log('Turn timeout:', data);
        if (onTurnTimeoutCallback) {
            onTurnTimeoutCallback(data);
        }
    });
    
    socket.on('player_disconnected', (data) => {
        console.log('Player disconnected from game:', data);
        if (onPlayerDisconnectedCallback) {
            onPlayerDisconnectedCallback(data);
        }
    });
    
    socket.on('player_reconnected', (data) => {
        console.log('Player reconnected to game:', data);
        showMessage(`${data.playerName} reconnected`, 'info');
    });
    
    socket.on('reconnection_result', (data) => {
        if (data.reconnected) {
            console.log('Reconnected to active game');
        }
    });
    
    // Chat events
    socket.on('chat_message', (data) => {
        console.log('Chat message received:', data);
        if (onChatMessageCallback) {
            onChatMessageCallback(data);
        }
    });
    
    // Chat history event
    socket.on('chat_history', (data) => {
        console.log('Chat history received:', data);
        if (onChatHistoryCallback) {
            onChatHistoryCallback(data);
        }
    });
    
    // Chat error event
    socket.on('chat_error', (error) => {
        console.error('Chat error:', error);
        if (onChatErrorCallback) {
            onChatErrorCallback(error);
        }
    });
    
    // Game countdown event
    socket.on('game_countdown', (data) => {
        console.log('Game countdown:', data);
        if (onGameCountdownCallback) {
            onGameCountdownCallback(data);
        }
    });
    
    // Payment refund events
    socket.on('payment_refunded', (data) => {
        console.log('Payment refunded:', data);
        if (onPaymentRefundedCallback) {
            onPaymentRefundedCallback(data);
        }
    });
    
    socket.on('refund_error', (data) => {
        console.log('Refund error:', data);
        if (onRefundErrorCallback) {
            onRefundErrorCallback(data);
        }
    });
    
    return socket;
}

// Callback storage
let onConnectCallback = null;
let onDisconnectCallback = null;
let onLobbyListCallback = null;
let onLobbyJoinedCallback = null;
let onPlayerJoinedCallback = null;
let onPlayerLeftCallback = null;
let onLobbyErrorCallback = null;
let onGameStartCallback = null;
let onGameStateUpdateCallback = null;
let onGameErrorCallback = null;
let onTurnStartCallback = null;
let onTurnTimeoutCallback = null;
let onPlayerDisconnectedCallback = null;
let onChatMessageCallback = null;
let onChatHistoryCallback = null;
let onChatErrorCallback = null;
let onGameCountdownCallback = null;
let onPaymentRefundedCallback = null;
let onRefundErrorCallback = null;

/**
 * Set callbacks
 */
export function setCallbacks(callbacks) {
    onConnectCallback = callbacks.onConnect;
    onDisconnectCallback = callbacks.onDisconnect;
    onLobbyListCallback = callbacks.onLobbyList;
    onLobbyJoinedCallback = callbacks.onLobbyJoined;
    onPlayerJoinedCallback = callbacks.onPlayerJoined;
    onPlayerLeftCallback = callbacks.onPlayerLeft;
    onLobbyErrorCallback = callbacks.onLobbyError;
    onGameStartCallback = callbacks.onGameStart;
    onGameStateUpdateCallback = callbacks.onGameStateUpdate;
    onGameErrorCallback = callbacks.onGameError;
    onTurnStartCallback = callbacks.onTurnStart;
    onTurnTimeoutCallback = callbacks.onTurnTimeout;
    onPlayerDisconnectedCallback = callbacks.onPlayerDisconnected;
    onChatMessageCallback = callbacks.onChatMessage;
    onChatHistoryCallback = callbacks.onChatHistory;
    onChatErrorCallback = callbacks.onChatError;
    onGameCountdownCallback = callbacks.onGameCountdown;
    onPaymentRefundedCallback = callbacks.onPaymentRefunded;
    onRefundErrorCallback = callbacks.onRefundError;
}

/**
 * Request chat history
 */
export function requestChatHistory(mode, lobbyId = null) {
    if (!socket || !isConnected) {
        return;
    }
    socket.emit('request_chat_history', { mode, lobbyId });
}


/**
 * Join lobby
 */
export function joinLobby(playerName, gameMode = 2) {
    if (!socket || !isConnected) {
        console.error('Socket not connected');
        return;
    }
    socket.emit('join_lobby', { playerName, gameMode });
}

/**
 * Leave lobby
 */
export function leaveLobby() {
    if (!socket || !isConnected) {
        return;
    }
    socket.emit('leave_lobby');
}

/**
 * Play a card
 */
export function playCard(cardIndex, chosenColor = null) {
    if (!socket || !isConnected) {
        console.error('Socket not connected');
        return;
    }
    socket.emit('play_card', { cardIndex, chosenColor });
}

/**
 * Draw a card
 */
export function drawCard() {
    if (!socket || !isConnected) {
        console.error('Socket not connected');
        return;
    }
    socket.emit('draw_card');
}

/**
 * End turn (for when player draws a playable card but chooses not to play it)
 */
export function endTurn() {
    if (!socket || !isConnected) {
        console.error('Socket not connected');
        return;
    }
    socket.emit('end_turn');
}

/**
 * Call UNO
 */
export function callUno() {
    if (!socket || !isConnected) {
        console.error('Socket not connected');
        return;
    }
    socket.emit('call_uno');
}

/**
 * Get current game ID
 */
export function getCurrentGameId() {
    return currentGameId;
}

/**
 * Get current player index
 */
export function getCurrentPlayerIndex() {
    return currentPlayerIndex;
}

/**
 * Check if connected
 */
export function isSocketConnected() {
    return isConnected && socket !== null;
}

/**
 * Get socket instance
 */
export function getSocket() {
    return socket;
}


