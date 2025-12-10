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
    // Message display handled by UI components
}

/**
 * Initialize socket connection
 */
export function initSocket() {
    socket = io();
    
    // Make socket available globally for sidebar
    window.socketInstance = socket;
    
    socket.on('connect', () => {
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
        isConnected = false;
        if (onDisconnectCallback) {
            onDisconnectCallback();
        }
    });
    
    // Lobby events
    socket.on('lobby_list', (lobbies) => {
        if (onLobbyListCallback) {
            onLobbyListCallback(lobbies);
        }
    });
    
    socket.on('lobby_joined', (lobby) => {
        if (onLobbyJoinedCallback) {
            onLobbyJoinedCallback(lobby);
        }
    });
    
    socket.on('player_joined', (lobby) => {
        if (onPlayerJoinedCallback) {
            onPlayerJoinedCallback(lobby);
        }
    });
    
    socket.on('player_left', (lobby) => {
        if (onPlayerLeftCallback) {
            onPlayerLeftCallback(lobby);
        }
    });
    
    socket.on('lobby_error', (error) => {
        if (onLobbyErrorCallback) {
            onLobbyErrorCallback(error);
        }
    });
    
    // Game events
    socket.on('game_start', (data) => {
        currentGameId = data.gameId;
        currentPlayerIndex = data.playerIndex;
        if (onGameStartCallback) {
            onGameStartCallback(data);
        }
    });
    
    socket.on('game_state_update', (gameState) => {
        if (onGameStateUpdateCallback) {
            onGameStateUpdateCallback(gameState);
        }
    });
    
    
    socket.on('game_error', (error) => {
        if (onGameErrorCallback) {
            onGameErrorCallback(error);
        }
    });
    
    socket.on('turn_start', (data) => {
        if (onTurnStartCallback) {
            onTurnStartCallback(data);
        }
    });
    
    socket.on('turn_timeout', (data) => {
        if (onTurnTimeoutCallback) {
            onTurnTimeoutCallback(data);
        }
    });
    
    socket.on('player_disconnected', (data) => {
        if (onPlayerDisconnectedCallback) {
            onPlayerDisconnectedCallback(data);
        }
    });
    
    socket.on('player_reconnected', (data) => {
        showMessage(`${data.playerName} reconnected`, 'info');
    });
    
    socket.on('reconnection_result', (data) => {
        if (data.reconnected) {
            // Reconnected to active game
        }
    });
    
    // Chat events
    socket.on('chat_message', (data) => {
        if (onChatMessageCallback) {
            onChatMessageCallback(data);
        }
    });
    
    // Chat history event
    socket.on('chat_history', (data) => {
        if (onChatHistoryCallback) {
            onChatHistoryCallback(data);
        }
    });
    
    // Chat error event
    socket.on('chat_error', (error) => {
        if (onChatErrorCallback) {
            onChatErrorCallback(error);
        }
    });
    
    // Game countdown event
    socket.on('game_countdown', (data) => {
        if (onGameCountdownCallback) {
            onGameCountdownCallback(data);
        }
    });
    
    // Payment refund events
    socket.on('payment_refunded', (data) => {
        if (onPaymentRefundedCallback) {
            onPaymentRefundedCallback(data);
        }
    });
    
    socket.on('refund_error', (data) => {
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
        return;
    }
    socket.emit('play_card', { cardIndex, chosenColor });
}

/**
 * Draw a card
 */
export function drawCard() {
    if (!socket || !isConnected) {
        return;
    }
    socket.emit('draw_card');
}

/**
 * End turn (for when player draws a playable card but chooses not to play it)
 */
export function endTurn() {
    if (!socket || !isConnected) {
        return;
    }
    socket.emit('end_turn');
}

/**
 * Call UNO
 */
export function callUno() {
    if (!socket || !isConnected) {
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


