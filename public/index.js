import { initCanvas } from './game/canvas.js';
import { loadCardSpritesheet } from './game/cards.js';
import { loadColorImages, loadUnoButton, loadAnimationImages, loadWinMessageBox } from './game/renderer.js';
import { startGameFromServer, handleTurnStart, handleTurnTimeout, handlePlayerDisconnected } from './game/gameManager.js';
import { initSocket, setCallbacks, leaveLobby } from './client/socketClient.js';
import { initLobby, getLobbyCallbacks, hideLobby, showLobby } from './lobby/lobby.js';
import { initRecentWins, hideRecentWins, showRecentWins } from './lobby/recentWins.js';
import { initChat, getChatCallbacks, setChatMode } from './chat/chat.js';
import { initWallet, connectWallet, disconnectWallet, showUsernameModalPublic, getCurrentUser, isWalletConnected } from './wallet/wallet.js';

// UI Elements
const gameContainer = document.getElementById('gameContainer');
const loadingScreen = document.getElementById('loadingScreen');
const loadingBar = document.getElementById('loadingBar');
const loadingText = document.getElementById('loadingText');

let assetsLoaded = false;
let gameStarted = false;

// Initialize when page loads
window.addEventListener('DOMContentLoaded', async () => {
    // Show loading screen first
    loadingScreen.classList.remove('hidden');
    
    // Show game container initially hidden
    gameContainer.style.display = 'none';
    
    // Pre-load all assets with progress tracking
    await preloadAllAssets();
    
    // Hide loading screen and show main content
    loadingScreen.classList.add('hidden');
    const mainContent = document.querySelector('.main-content');
    const sidebar = document.querySelector('.sidebar');
    if (mainContent) {
        mainContent.classList.add('loaded');
    }
    if (sidebar) {
        sidebar.classList.add('loaded');
    }
    
    // Initialize wallet connection
    initWallet();
    initWalletUI();
    
    // Initialize sidebar modals
    initSidebar();
    
    // Initialize chat
    initChat();
    
    // Initialize lobby
    initLobby();
    
    // Initialize recent wins
    initRecentWins();
    
    // Get lobby and chat callbacks BEFORE initializing socket
    const lobbyCallbacks = getLobbyCallbacks();
    const chatCallbacks = getChatCallbacks();
    
    // Set up socket callbacks BEFORE initializing socket
    // This ensures callbacks are ready when socket connects
    setCallbacks({
        onLobbyList: lobbyCallbacks.onLobbyList,
        ...lobbyCallbacks,
        ...chatCallbacks,
        onChatHistory: chatCallbacks.onChatHistory,
        onGameCountdown: lobbyCallbacks.onGameCountdown,
        onPaymentRefunded: lobbyCallbacks.onPaymentRefunded,
        onRefundError: lobbyCallbacks.onRefundError,
        onGameStart: async (data) => {
            console.log('Game starting...', data);
            lobbyCallbacks.onGameStart();
            
            // Wait for assets if not loaded
            if (!assetsLoaded) {
                await loadGameAssets();
            }
            
            // Switch to game view
            hideLobby();
            hideRecentWins();
            gameContainer.style.display = 'flex';
            
            // Initialize canvas if not already done
            if (!gameStarted) {
                initCanvas();
                gameStarted = true;
            }
            
            // Start game with server state
            // Check if this is a reconnection (skip animations if so)
            const isReconnection = data.reconnected === true;
            startGameFromServer(data.gameState, data.playerIndex, isReconnection);
            
            // Store player name for reconnection (if reconnected, data.reconnected will be true)
            if (data.gameState && data.gameState.players && data.gameState.players[data.playerIndex]) {
                const playerName = data.gameState.players[data.playerIndex].name;
                localStorage.setItem('unoPlayerName', playerName);
            }
            
            // Switch to lobby chat when game starts
            const lobbyId = data.gameState?.lobbyId || null;
            setChatMode('lobby', lobbyId);
        },
        onGameStateUpdate: (gameState) => {
            // Update game state from server
            if (window.updateGameStateFromServer) {
                window.updateGameStateFromServer(gameState);
            }
        },
        onGameError: (error) => {
            console.error('Game error:', error);
            // Could show error in UI
        },
        onTurnStart: (data) => {
            handleTurnStart(data);
        },
        onTurnTimeout: (data) => {
            handleTurnTimeout(data);
        },
        onPlayerDisconnected: (data) => {
            handlePlayerDisconnected(data);
        }
    });
    
    // Initialize socket connection AFTER callbacks are set
    // This ensures reconnection check works properly
    initSocket();
    
    // Also check for reconnection after a delay to catch cases where
    // wallet connects after socket (or vice versa)
    setTimeout(() => {
        // Trigger reconnection check via wallet connection event
        // This will run checkForReconnection if wallet is now connected
        if (isWalletConnected()) {
            window.dispatchEvent(new CustomEvent('walletConnectionChanged'));
        }
    }, 2000); // 2 second delay to ensure everything is initialized
    
    // Make returnToLobby function globally accessible for game input handler
    window.returnToLobby = () => {
        // Leave the current game/lobby
        leaveLobby();
        
        // Clear stored player name (no longer in game)
        localStorage.removeItem('unoPlayerName');
        
        // Switch back to all chat
        setChatMode('all');
        
        // Switch back to lobby view
        gameContainer.style.display = 'none';
        showLobby();
        showRecentWins();
    };
});

/**
 * Initialize wallet UI
 */
function initWalletUI() {
    const connectBtn = document.getElementById('connectWalletBtn');
    const closeUsernameModal = document.getElementById('closeUsernameModal');
    const usernameModal = document.getElementById('usernameModal');
    
    // Connect wallet button
    if (connectBtn) {
        connectBtn.addEventListener('click', async () => {
            const user = getCurrentUser();
            if (user) {
                // If already connected, show username modal
                showUsernameModalPublic();
            } else {
                // Connect wallet
                await connectWallet();
            }
        });
    }
    
    // Close username modal
    if (closeUsernameModal) {
        closeUsernameModal.addEventListener('click', () => {
            if (usernameModal) {
                usernameModal.style.display = 'none';
            }
        });
    }
    
    // Close modal when clicking outside
    if (usernameModal) {
        window.addEventListener('click', (event) => {
            if (event.target === usernameModal) {
                usernameModal.style.display = 'none';
            }
        });
    }
}

/**
 * Initialize sidebar functionality
 */
function initSidebar() {
    // Modal handlers
    const howItWorksBtn = document.getElementById('howItWorksBtn');
    const gameRulesBtn = document.getElementById('gameRulesBtn');
    const howItWorksModal = document.getElementById('howItWorksModal');
    const gameRulesModal = document.getElementById('gameRulesModal');
    const closeHowItWorks = document.getElementById('closeHowItWorks');
    const closeGameRules = document.getElementById('closeGameRules');
    
    // Open modals
    if (howItWorksBtn) {
        howItWorksBtn.addEventListener('click', () => {
            howItWorksModal.style.display = 'block';
        });
    }
    
    if (gameRulesBtn) {
        gameRulesBtn.addEventListener('click', () => {
            gameRulesModal.style.display = 'block';
        });
    }
    
    // Close modals
    if (closeHowItWorks) {
        closeHowItWorks.addEventListener('click', () => {
            howItWorksModal.style.display = 'none';
        });
    }
    
    if (closeGameRules) {
        closeGameRules.addEventListener('click', () => {
            gameRulesModal.style.display = 'none';
        });
    }
    
    // Close modals when clicking outside
    window.addEventListener('click', (event) => {
        if (event.target === howItWorksModal) {
            howItWorksModal.style.display = 'none';
        }
        if (event.target === gameRulesModal) {
            gameRulesModal.style.display = 'none';
        }
    });
    
    // Update online users count
    updateOnlineUsersCount();
    setInterval(updateOnlineUsersCount, 5000); // Update every 5 seconds
}

/**
 * Update online users count
 */
function updateOnlineUsersCount() {
    const socket = window.socketInstance;
    if (socket && socket.connected) {
        socket.emit('get_online_users');
    }
}

/**
 * Preload all assets with progress tracking
 */
async function preloadAllAssets() {
    if (assetsLoaded) return;
    
    // List of all assets to load
    const assets = [
        { name: 'card spritesheet', url: '/assets/cards/cards.png' },
        { name: 'red color', url: '/assets/color/red.png' },
        { name: 'green color', url: '/assets/color/green.png' },
        { name: 'blue color', url: '/assets/color/blue.png' },
        { name: 'yellow color', url: '/assets/color/yellow.png' },
        { name: 'UNO button', url: '/assets/uno_button.png' },
        { name: 'reverse animation', url: '/assets/animations/change_clockwise.png' },
        { name: 'skip animation', url: '/assets/animations/stop_turn.png' },
        { name: 'finger animation', url: '/assets/animations/finger.png' },
        { name: 'call UNO', url: '/assets/call_uno.png' },
        { name: 'win message box', url: '/assets/win_message_box.png' },
        { name: 'background', url: '/assets/bg_game.jpg' }
    ];
    
    const totalAssets = assets.length;
    let loadedCount = 0;
    
    const updateProgress = (assetName) => {
        loadedCount++;
        const progress = Math.round((loadedCount / totalAssets) * 100);
        loadingBar.style.width = `${progress}%`;
        loadingText.textContent = `Loading ${assetName}... (${loadedCount}/${totalAssets})`;
    };
    
    // Load all assets in parallel with progress tracking
    const loadPromises = assets.map(asset => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                updateProgress(asset.name);
                resolve();
            };
            img.onerror = () => {
                console.error(`Failed to load ${asset.name}: ${asset.url}`);
                updateProgress(asset.name); // Still count it to avoid getting stuck
                reject(new Error(`Failed to load ${asset.name}`));
            };
            img.src = asset.url;
        });
    });
    
    try {
        // Wait for all assets to load
        await Promise.all(loadPromises);
        
        // Now call the actual load functions to set up the internal state
        await Promise.all([
            loadCardSpritesheet(),
            loadColorImages(),
            loadUnoButton(),
            loadAnimationImages(),
            loadWinMessageBox()
        ]);
        
        assetsLoaded = true;
        loadingText.textContent = 'Complete!';
        // Small delay to show 100% before hiding
        await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
        console.error('Failed to load game assets:', error);
        loadingText.textContent = 'Error loading assets. Please refresh.';
        // Still mark as loaded to allow the app to continue (some assets may have failed)
        assetsLoaded = true;
    }
}


/**
 * Load game assets (for when game starts - assets should already be loaded)
 */
async function loadGameAssets() {
    if (assetsLoaded) return;
    
    try {
        await Promise.all([
            loadCardSpritesheet(),
            loadColorImages(),
            loadUnoButton(),
            loadAnimationImages(),
            loadWinMessageBox()
        ]);
        assetsLoaded = true;
        console.log('All game assets loaded');
    } catch (error) {
        console.error('Failed to load game assets:', error);
    }
}


