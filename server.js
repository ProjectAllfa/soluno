import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import multer from 'multer';
import sharp from 'sharp';
import { existsSync, mkdirSync, statSync } from 'fs';
import { stat } from 'fs/promises';
import { Game } from './server/gameLogic.js';
import { LobbyManager } from './server/lobbyManager.js';
import { testConnection, getDatabase } from './server/db.js';
import { initializeIndexes } from './server/models/initIndexes.js';
import { createOrUpdateUser, updateUsername as updateUserUsername, getUserByWallet, getUserByUsername, updatePfp } from './server/models/User.js';
import { getEscrowWallet, verifyPayment, refundPayment, distributeWinnings } from './server/paymentService.js';
import { createGame, getGameByGameId, updateGameOnEnd, updateGameTransactions } from './server/models/Game.js';
import { createMatchHistory, getRecentWins, updateMatchHistoryTxHash } from './server/models/MatchHistory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Middleware for parsing JSON
app.use(express.json());

// Serve static files from public directory
app.use(express.static(join(__dirname, 'public')));

// Serve profile pictures with caching
app.use('/pfp', express.static(join(__dirname, 'public', 'pfp'), {
    maxAge: '30d',
    immutable: true
}));

// Ensure pfp directory exists
const pfpDir = join(__dirname, 'public', 'pfp');
if (!existsSync(pfpDir)) {
    mkdirSync(pfpDir, { recursive: true });
}

// Configure multer for memory storage (we'll process with sharp)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 2 * 1024 * 1024 // 2 MB max
    },
    fileFilter: (req, file, cb) => {
        // Only accept image MIME types
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// API Routes
// Connect wallet and get/create user
app.post('/api/user/connect', async (req, res) => {
    try {
        const { wallet } = req.body;
        
        if (!wallet || typeof wallet !== 'string') {
            return res.status(400).json({ error: 'Wallet address is required' });
        }
        
        // Check if user exists
        let user = await getUserByWallet(wallet);
        
        // If user doesn't exist, create with guest username
        if (!user) {
            const randomNum = Math.floor(Math.random() * 10000);
            const username = `guest${randomNum}`;
            user = await createOrUpdateUser(username, wallet);
        }
        
        res.json({
            wallet: user.wallet,
            username: user.username,
            pfpUrl: user.pfpUrl || '/pfp/default.jpg',
            createdAt: user.createdAt
        });
    } catch (error) {
        console.error('Error in /api/user/connect:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Upload profile picture
app.post('/api/user/upload-pfp', upload.single('pfp'), async (req, res) => {
    try {
        const { wallet } = req.body;
        
        if (!wallet || typeof wallet !== 'string') {
            return res.status(400).json({ error: 'Wallet address is required' });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        // Verify user exists
        const user = await getUserByWallet(wallet);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Get user ID (use _id from MongoDB)
        const userId = user._id.toString();
        
        // Process image with sharp: resize, convert to webp, strip EXIF, optimize
        const outputPath = join(pfpDir, `${userId}.webp`);
        
        try {
            await sharp(req.file.buffer)
                .resize(128, 128, {
                    fit: 'cover',
                    position: 'center'
                })
                .webp({
                    quality: 85,
                    effort: 6
                })
                .toFile(outputPath);
            
            // Check final file size
            const stats = await stat(outputPath);
            const fileSizeKB = stats.size / 1024;
            
            // If still too large, try more aggressive compression
            if (fileSizeKB > 30) {
                await sharp(req.file.buffer)
                    .resize(128, 128, {
                        fit: 'cover',
                        position: 'center'
                    })
                    .webp({
                        quality: 70,
                        effort: 6
                    })
                    .toFile(outputPath);
            }
            
            // Update user's pfpUrl in database
            const pfpUrl = `/pfp/${userId}.webp`;
            const updatedUser = await updatePfp(wallet, pfpUrl);
            
            if (!updatedUser) {
                return res.status(500).json({ error: 'Failed to update profile picture' });
            }
            
            res.json({
                success: true,
                pfpUrl: pfpUrl,
                message: 'Profile picture uploaded successfully'
            });
        } catch (imageError) {
            console.error('Error processing image:', imageError);
            return res.status(500).json({ error: 'Failed to process image' });
        }
    } catch (error) {
        console.error('Error in /api/user/upload-pfp:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Update username
app.post('/api/user/update-username', async (req, res) => {
    try {
        const { wallet, username } = req.body;
        
        if (!wallet || typeof wallet !== 'string') {
            return res.status(400).json({ error: 'Wallet address is required' });
        }
        
        if (!username || typeof username !== 'string') {
            return res.status(400).json({ error: 'Username is required' });
        }
        
        if (username.length < 3) {
            return res.status(400).json({ error: 'Username must be at least 3 characters' });
        }
        
        if (username.length > 20) {
            return res.status(400).json({ error: 'Username must be less than 20 characters' });
        }
        
        // Check if username is already taken by another user
        const existingUserWithUsername = await getUserByUsername(username);
        if (existingUserWithUsername && existingUserWithUsername.wallet !== wallet) {
            return res.status(400).json({ error: 'Username is already taken' });
        }
        
        // Update username
        const updatedUser = await updateUserUsername(wallet, username);
        
        if (!updatedUser) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({
            wallet: updatedUser.wallet,
            username: updatedUser.username,
            pfpUrl: updatedUser.pfpUrl || '/pfp/default.jpg',
            updatedAt: updatedUser.updatedAt
        });
    } catch (error) {
        console.error('Error in /api/user/update-username:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

// Get Solana RPC URL for client (returns RPC URL from environment)
app.get('/api/config/rpc-url', (req, res) => {
    // Return the RPC URL from environment variable
    // This allows client to use the same Helius RPC endpoint without hardcoding
    const rpcUrl = process.env.SOLANA_RPC_URL;
    
    if (!rpcUrl) {
        return res.status(500).json({ error: 'RPC URL not configured' });
    }
    
    res.json({ rpcUrl: rpcUrl });
});

// Recent Wins API endpoint (simple GET, cached)
app.get('/api/recent-wins', async (req, res) => {
    try {
        const now = Date.now();
        
        // Check if cache is valid
        if (recentWinsCache && recentWinsCacheTime && (now - recentWinsCacheTime) < RECENT_WINS_CACHE_TTL) {
            return res.json(recentWinsCache);
        }
        
        // Fetch fresh data
        const recentWins = await getRecentWins(10);
        
        // Format data for frontend and fetch pfpUrl for winners
        const formattedWins = await Promise.all(recentWins.map(async (win) => {
            // Format gameId for display (truncate to show first part)
            let gameIdDisplay = win.gameId || 'unknown';
            if (gameIdDisplay.length > 20) {
                gameIdDisplay = gameIdDisplay.substring(0, 16) + '...';
            }
            
            // Get winner's pfpUrl from database
            let pfpUrl = '/pfp/default.jpg';
            if (win.winner?.wallet) {
                try {
                    const dbUser = await getUserByWallet(win.winner.wallet);
                    if (dbUser && dbUser.pfpUrl) {
                        pfpUrl = dbUser.pfpUrl;
                    }
                } catch (error) {
                    console.error('Error fetching pfpUrl for recent win:', error);
                }
            }
            
            return {
                username: win.winner?.username || 'Unknown',
                wallet: win.winner?.wallet || null,
                pfpUrl: pfpUrl,
                time: win.createdAt,
                gameMode: win.gameMode || '2p',
                stake: win.stake || 0,
                winAmount: win.winAmount || 0,
                txHash: win.txHash || null,
                gameId: win.gameId || null,
                gameIdDisplay: `game_id:${gameIdDisplay}`
            };
        }));
        
        // Update cache
        recentWinsCache = formattedWins;
        recentWinsCacheTime = now;
        
        res.json(formattedWins);
    } catch (error) {
        console.error('Error fetching recent wins:', error);
        res.status(500).json({ error: 'Failed to fetch recent wins' });
    }
});

// Payment API endpoints
app.post('/api/payment/request', async (req, res) => {
    try {
        const { wallet, lobbyId } = req.body;
        
        if (!wallet || !lobbyId) {
            return res.status(400).json({ error: 'Wallet and lobby ID are required' });
        }
        
        // Get lobby to get SOL stake amount
        const lobby = lobbyManager.getLobbyById(lobbyId);
        if (!lobby) {
            return res.status(404).json({ error: 'Lobby not found' });
        }
        
        // Check if lobby is available
        if (lobby.status !== 'waiting') {
            return res.status(400).json({ error: 'Lobby is not available' });
        }
        
        // Get escrow wallet address
        const result = await getEscrowWallet();
        
        if (!result.success) {
            return res.status(500).json({ error: result.error || 'Failed to get escrow wallet' });
        }
        
        res.json({
            escrowWallet: result.escrowWallet,
            solAmount: lobby.solStake
        });
    } catch (error) {
        console.error('Error creating payment request:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/payment/verify', async (req, res) => {
    try {
        const { signature, wallet, lobbyId } = req.body;
        
        if (!signature || !wallet || !lobbyId) {
            return res.status(400).json({ error: 'Signature, wallet, and lobby ID are required' });
        }
        
        // Get lobby to verify amount
        const lobby = lobbyManager.getLobbyById(lobbyId);
        if (!lobby) {
            return res.status(404).json({ error: 'Lobby not found' });
        }
        
        // Verify payment
        const verification = await verifyPayment(signature, wallet, lobby.solStake);
        
        if (!verification.success) {
            return res.status(400).json({ error: verification.error || 'Payment verification failed' });
        }
        
        // Store payment record
        playerPayments.set(wallet, {
            lobbyId: lobbyId,
            solAmount: lobby.solStake,
            signature: signature,
            timestamp: Date.now()
        });
        
        res.json({
            success: true,
            signature: verification.signature,
            amount: verification.amount
        });
    } catch (error) {
        console.error('Error verifying payment:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Chat history storage (in-memory, cleaned up after 24h)
const chatHistory = {
    all: [], // All chat messages
    lobbies: new Map() // lobbyId -> Array of messages
};
const CHAT_HISTORY_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
const MAX_MESSAGES_PER_CHAT = 200; // Limit to prevent memory issues

// Chat restrictions
const MAX_MESSAGE_LENGTH = 300; // Maximum characters per message
const MAX_MESSAGES_PER_WINDOW = 3; // Maximum messages per time window
const RATE_LIMIT_WINDOW = 10000; // Time window in milliseconds (10 seconds)

// Rate limiting: track messages per socket/wallet
const rateLimitMap = new Map(); // socketId or wallet -> Array of timestamps

/**
 * Add message to chat history
 */
function addToChatHistory(mode, lobbyId, messageData) {
    const now = Date.now();
    messageData.timestamp = messageData.timestamp || now;
    
    let historyArray;
    if (mode === 'lobby' && lobbyId) {
        if (!chatHistory.lobbies.has(lobbyId)) {
            chatHistory.lobbies.set(lobbyId, []);
        }
        historyArray = chatHistory.lobbies.get(lobbyId);
    } else {
        historyArray = chatHistory.all;
    }
    
    // Add message
    historyArray.push(messageData);
    
    // Keep only last MAX_MESSAGES_PER_CHAT messages
    if (historyArray.length > MAX_MESSAGES_PER_CHAT) {
        historyArray.shift();
    }
}

/**
 * Get chat history
 */
function getChatHistory(mode, lobbyId) {
    const now = Date.now();
    let historyArray;
    
    if (mode === 'lobby' && lobbyId) {
        historyArray = chatHistory.lobbies.get(lobbyId) || [];
    } else {
        historyArray = chatHistory.all;
    }
    
    // Filter out messages older than 24 hours
    return historyArray.filter(msg => {
        const msgTime = msg.timestamp || 0;
        return (now - msgTime) < CHAT_HISTORY_EXPIRY;
    });
}

/**
 * Clean up old chat history
 */
function cleanupChatHistory() {
    const now = Date.now();
    
    // Clean all chat
    chatHistory.all = chatHistory.all.filter(msg => {
        const msgTime = msg.timestamp || 0;
        return (now - msgTime) < CHAT_HISTORY_EXPIRY;
    });
    
    // Clean lobby chats
    for (const [lobbyId, messages] of chatHistory.lobbies.entries()) {
        const validMessages = messages.filter(msg => {
            const msgTime = msg.timestamp || 0;
            return (now - msgTime) < CHAT_HISTORY_EXPIRY;
        });
        
        if (validMessages.length === 0) {
            chatHistory.lobbies.delete(lobbyId);
        } else {
            chatHistory.lobbies.set(lobbyId, validMessages);
        }
    }
}

/**
 * Clean up old rate limit entries
 */
function cleanupRateLimits() {
    const now = Date.now();
    
    for (const [key, timestamps] of rateLimitMap.entries()) {
        // Remove timestamps older than the rate limit window
        const validTimestamps = timestamps.filter(timestamp => {
            return (now - timestamp) < RATE_LIMIT_WINDOW;
        });
        
        if (validTimestamps.length === 0) {
            rateLimitMap.delete(key);
        } else {
            rateLimitMap.set(key, validTimestamps);
        }
    }
}

// Clean up chat history every hour
setInterval(() => {
    cleanupChatHistory();
    cleanupRateLimits();
}, 60 * 60 * 1000);

// Game and lobby management
const lobbyManager = new LobbyManager();
const activeGames = new Map(); // gameId -> Game instance
const playerToGame = new Map(); // playerId -> gameId
const playerToLobby = new Map(); // playerId -> lobbyId
const playerNameToGame = new Map(); // playerName -> gameId (for reconnection)
const gameToLobby = new Map(); // gameId -> lobbyId (for chat routing)

// Payment tracking: track payments by player wallet and lobby
const playerPayments = new Map(); // wallet -> { lobbyId, solAmount, signature, timestamp }
const lobbyToGame = new Map(); // lobbyId -> gameId (to check if game has started)
let recentWinsCache = null; // Cached recent wins data
let recentWinsCacheTime = null; // Timestamp when cache was created
const RECENT_WINS_CACHE_TTL = 30000; // 30 seconds cache TTL

    // Socket.io connection handling
    io.on('connection', (socket) => {
        console.log(`Player connected: ${socket.id}`);
        
        // Send lobby list to newly connected client
        socket.emit('lobby_list', lobbyManager.getAllLobbies());
        
        // Send online users count to newly connected client
        socket.emit('online_users_count', { count: io.sockets.sockets.size });
        
        // Broadcast updated online users count to all clients
        io.emit('online_users_count', { count: io.sockets.sockets.size });
        
        // Send chat history for 'all' chat (everyone can view)
        const allChatHistory = getChatHistory('all', null);
        socket.emit('chat_history', {
            mode: 'all',
            messages: allChatHistory
        });
    
    // Request lobby list
    socket.on('request_lobby_list', () => {
        socket.emit('lobby_list', lobbyManager.getAllLobbies());
    });
    
    // Request online users count
        socket.on('get_online_users', () => {
            socket.emit('online_users_count', { count: io.sockets.sockets.size });
        });
        
    
    // Check for reconnection to active game
    socket.on('check_reconnection', (data) => {
        const { playerName, wallet } = data || {};
        if (!playerName && !wallet) {
            socket.emit('reconnection_result', { reconnected: false });
            return;
        }
        
        // Try to find game by wallet first (more reliable), then by playerName
        let gameId = null;
        if (wallet) {
            // Find game by wallet - we'll need to check game states
            for (const [gId, game] of activeGames.entries()) {
                const fullState = game.getFullState();
                const player = fullState.players.find(p => p.wallet === wallet);
                if (player) {
                    gameId = gId;
                    break;
                }
            }
        }
        
        // Fallback to playerName if wallet not found
        if (!gameId && playerName) {
            gameId = playerNameToGame.get(playerName);
        }
        if (gameId && activeGames.has(gameId)) {
            const game = activeGames.get(gameId);
            const fullState = game.getFullState();
            
            // Don't allow reconnection to finished games
            if (fullState.status === 'finished') {
                // Remove from mapping since game is finished
                playerNameToGame.delete(playerName);
                socket.emit('reconnection_result', { reconnected: false, reason: 'Game has ended' });
                return;
            }
            
            const playerIndex = fullState.players.findIndex(p => 
                (p.originalName || p.name.replace(' (Disconnected)', '')) === playerName
            );
            
            if (playerIndex !== -1) {
                const player = fullState.players[playerIndex];
                // Reconnect player
                const reconnectResult = game.handlePlayerReconnect(player.id, socket.id, playerName);
                
                if (reconnectResult.success) {
                    // Update mappings
                    playerToGame.set(socket.id, gameId);
                    // Update player ID in game
                    player.id = socket.id;
                    player.socketId = socket.id;
                    
                    // Send game state to reconnected player
                    const publicState = game.getPublicState(socket.id);
                    socket.emit('game_start', {
                        gameId: gameId,
                        playerIndex: playerIndex,
                        gameState: publicState,
                        reconnected: true
                    });
                    
                    // Notify other players
                    fullState.players.forEach((p) => {
                        if (p.id !== socket.id) {
                            io.to(p.id).emit('player_reconnected', {
                                playerIndex: playerIndex,
                                playerName: playerName
                            });
                        }
                    });
                    
                    // Broadcast updated state
                    broadcastGameState(gameId, game);
                    
                    console.log(`Player ${playerName} reconnected to game ${gameId}`);
                    return;
                }
            }
        }
        
        socket.emit('reconnection_result', { reconnected: false });
    });
    
    // Player joins lobby
    socket.on('join_lobby', async (data) => {
        const { playerName, wallet, lobbyId, paymentSignature } = data || {};
        
        if (!lobbyId) {
            socket.emit('lobby_error', { message: 'Lobby ID required' });
            return;
        }
        
        if (!wallet) {
            socket.emit('lobby_error', { message: 'Wallet connection required' });
            return;
        }
        
        // Get lobby to check payment
        const lobby = lobbyManager.getLobbyById(lobbyId);
        if (!lobby) {
            socket.emit('lobby_error', { message: 'Lobby not found' });
            return;
        }
        
        // Verify payment was made
        const payment = playerPayments.get(wallet);
        if (!payment || payment.lobbyId !== lobbyId || !paymentSignature || payment.signature !== paymentSignature) {
            socket.emit('lobby_error', { message: 'Payment required. Please complete payment first.' });
            return;
        }
        
        // Verify payment amount matches
        if (payment.solAmount !== lobby.solStake) {
            socket.emit('lobby_error', { message: 'Payment amount mismatch' });
            return;
        }
        
        // Get username from database based on wallet (source of truth)
        // If user doesn't exist, create one with the provided username or generate one
        let dbUser = await getUserByWallet(wallet);
        let username;
        
        if (!dbUser) {
            // User doesn't exist, create with provided username or generate one
            username = playerName || `guest${Math.floor(Math.random() * 10000)}`;
            dbUser = await createOrUpdateUser(username, wallet);
            console.log(`Created new user: ${username} (${wallet})`);
        } else {
            // Use username from database (source of truth)
            username = dbUser.username;
            console.log(`Found existing user: ${username} (${wallet})`);
        }
        
        // Add player to lobby using wallet as identifier and username from DB for display
        // Include pfpUrl from database
        const pfpUrl = dbUser.pfpUrl || '/pfp/default.jpg';
        const result = lobbyManager.addPlayerToLobby(socket.id, username, lobbyId, wallet, pfpUrl);
        
        if (!result.success) {
            socket.emit('lobby_error', { message: result.message });
            return;
        }
        
        playerToLobby.set(socket.id, result.lobby.id);
        
        // Send lobby chat history to the player (everyone can view)
        const lobbyChatHistory = getChatHistory('lobby', result.lobby.id);
        socket.emit('chat_history', {
            mode: 'lobby',
            lobbyId: result.lobby.id,
            messages: lobbyChatHistory
        });
        
        // Notify player of lobby status
        socket.emit('lobby_joined', result.lobby);
        
        // Broadcast updated lobby list to all clients
        io.emit('lobby_list', lobbyManager.getAllLobbies());
        
        // If lobby is full, start countdown then game
        if (result.isFull) {
            // Get the full lobby object from manager (includes wallet addresses)
            const fullLobby = lobbyManager.getLobbyById(lobbyId);
            if (fullLobby) {
                // Emit countdown to all players in lobby
                fullLobby.players.forEach(player => {
                    io.to(player.id).emit('game_countdown', { lobbyId: lobbyId });
                });
                
                // Start countdown (3 seconds)
                let countdown = 3;
                const countdownInterval = setInterval(() => {
                    countdown--;
                    fullLobby.players.forEach(player => {
                        io.to(player.id).emit('game_countdown', { 
                            lobbyId: lobbyId, 
                            countdown: countdown 
                        });
                    });
                    
                    if (countdown <= 0) {
                        clearInterval(countdownInterval);
                        // Start game after countdown
                        startGame(fullLobby).catch(error => {
                            console.error('Error starting game after countdown:', error);
                            fullLobby.players.forEach(player => {
                                io.to(player.id).emit('lobby_error', { 
                                    message: 'Failed to start game. Please try again.' 
                                });
                            });
                        });
                    }
                }, 1000);
            } else {
                console.error(`[join_lobby] ERROR: Lobby ${lobbyId} not found when trying to start game`);
                socket.emit('lobby_error', { message: 'Failed to start game: Lobby not found' });
            }
        } else {
            // Notify other players in lobby
            const lobbyObj = lobbyManager.getLobbyByPlayerId(socket.id);
            if (lobbyObj) {
                lobbyObj.players.forEach(player => {
                    if (player.id !== socket.id) {
                        io.to(player.id).emit('player_joined', result.lobby);
                    }
                });
            }
        }
    });
    
    // Request chat history (everyone can request, not just wallet-connected users)
    socket.on('request_chat_history', (data) => {
        const { mode, lobbyId } = data || {};
        const history = getChatHistory(mode || 'all', lobbyId);
        // Always send history (even if empty) so client knows to display welcome message
        socket.emit('chat_history', {
            mode: mode || 'all',
            lobbyId: lobbyId || null,
            messages: history
        });
    });
    
    // Chat message handler
    socket.on('chat_message', async (data) => {
        const { message, mode, playerName, wallet } = data || {};
        
        if (!message || !playerName) {
            return;
        }
        
        // Validate message length
        if (message.length > MAX_MESSAGE_LENGTH) {
            socket.emit('chat_error', { 
                message: `Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters allowed.` 
            });
            return;
        }
        
        // Rate limiting: use wallet if available, otherwise socket ID
        const rateLimitKey = wallet || socket.id;
        const now = Date.now();
        
        // Get or create rate limit tracking for this user
        if (!rateLimitMap.has(rateLimitKey)) {
            rateLimitMap.set(rateLimitKey, []);
        }
        const timestamps = rateLimitMap.get(rateLimitKey);
        
        // Remove timestamps older than the rate limit window
        while (timestamps.length > 0 && now - timestamps[0] > RATE_LIMIT_WINDOW) {
            timestamps.shift();
        }
        
        // Check if user has exceeded rate limit
        if (timestamps.length >= MAX_MESSAGES_PER_WINDOW) {
            const timeUntilNext = Math.ceil((RATE_LIMIT_WINDOW - (now - timestamps[0])) / 1000);
            socket.emit('chat_error', { 
                message: `Rate limit exceeded. Please wait ${timeUntilNext} second${timeUntilNext !== 1 ? 's' : ''} before sending another message.` 
            });
            return;
        }
        
        // Record message timestamp
        timestamps.push(now);
        
        // Get user's pfpUrl from database
        let pfpUrl = '/pfp/default.jpg';
        if (wallet) {
            try {
                const dbUser = await getUserByWallet(wallet);
                if (dbUser && dbUser.pfpUrl) {
                    pfpUrl = dbUser.pfpUrl;
                }
            } catch (error) {
                console.error('Error fetching user pfpUrl for chat:', error);
            }
        }
        
        const chatData = {
            playerName: playerName,
            message: message,
            wallet: wallet || null,
            pfpUrl: pfpUrl,
            timestamp: Date.now()
        };
        
        if (mode === 'lobby') {
            // Send to lobby/game players only
            const gameId = playerToGame.get(socket.id);
            const lobbyId = playerToLobby.get(socket.id) || (gameId ? gameToLobby.get(gameId) : null);
            
            if (lobbyId) {
                // Save to lobby chat history
                addToChatHistory('lobby', lobbyId, chatData);
                
                if (gameId) {
                    // Player is in a game - send to all players in that game
                    const game = activeGames.get(gameId);
                    if (game) {
                        const fullState = game.getFullState();
                        fullState.players.forEach(player => {
                            io.to(player.id).emit('chat_message', chatData);
                        });
                    }
                } else {
                    // Player is in a lobby - send to all players in that lobby
                    const lobby = lobbyManager.getLobbyById(lobbyId);
                    if (lobby) {
                        lobby.players.forEach(player => {
                            io.to(player.id).emit('chat_message', chatData);
                        });
                    }
                }
            }
        } else {
            // Save to all chat history
            addToChatHistory('all', null, chatData);
            
            // Send to all connected clients (ALL CHAT)
            io.emit('chat_message', chatData);
        }
    });
    
    // Player leaves lobby
    socket.on('leave_lobby', async () => {
        const lobbyId = playerToLobby.get(socket.id);
        if (lobbyId) {
            const lobby = lobbyManager.getLobbyByPlayerId(socket.id);
            const player = lobby?.players.find(p => p.id === socket.id);
            
            // Check if game has started
            const gameId = lobbyToGame.get(lobbyId);
            const gameStarted = !!gameId;
            
            // If game hasn't started, refund payment
            if (!gameStarted && player && player.wallet) {
                const payment = playerPayments.get(player.wallet);
                if (payment && payment.lobbyId === lobbyId) {
                    try {
                        const refundResult = await refundPayment(player.wallet, payment.solAmount);
                        if (refundResult.success) {
                            console.log(`Refunded ${payment.solAmount} SOL to ${player.wallet} (signature: ${refundResult.signature})`);
                            socket.emit('payment_refunded', {
                                amount: refundResult.amount,
                                signature: refundResult.signature
                            });
                        } else {
                            console.error(`Failed to refund payment to ${player.wallet}:`, refundResult.error);
                            socket.emit('refund_error', { error: refundResult.error });
                        }
                        // Remove payment record
                        playerPayments.delete(player.wallet);
                    } catch (error) {
                        console.error('Error processing refund:', error);
                        socket.emit('refund_error', { error: 'Failed to process refund' });
                    }
                }
            }
            
            lobbyManager.removePlayerFromLobby(socket.id);
            playerToLobby.delete(socket.id);
            
            // Broadcast updated lobby list to all clients
            io.emit('lobby_list', lobbyManager.getAllLobbies());
            
            // Notify other players
            if (lobby) {
                lobby.players.forEach(playerObj => {
                    if (playerObj.id !== socket.id) {
                        io.to(playerObj.id).emit('player_left', {
                            id: lobby.id,
                            name: lobby.name,
                            players: lobby.players.map(p => ({ id: p.id, name: p.name })),
                            playerCount: lobby.players.length,
                            maxPlayers: lobby.gameMode || 2,
                            solStake: lobby.solStake
                        });
                    }
                });
            }
        }
    });
    
    // Game actions
    socket.on('play_card', (data) => {
        const { cardIndex, chosenColor } = data;
        const gameId = playerToGame.get(socket.id);
        
        if (!gameId) {
            socket.emit('game_error', { message: 'Not in a game' });
            return;
        }
        
        const game = activeGames.get(gameId);
        if (!game) {
            socket.emit('game_error', { message: 'Game not found' });
            return;
        }
        
        const result = game.playCard(socket.id, cardIndex, chosenColor);
        
        if (result.success) {
            // Broadcast immediately so all clients see the card played and start animations
            // State will be broadcast again after turn transition completes
            broadcastGameState(gameId, game);
            
            // Check if game ended (player won)
            if (result.gameState && result.gameState.status === 'finished') {
                handleGameEnd(gameId, game);
            }
        } else {
            socket.emit('game_error', { message: result.message });
        }
    });
    
    socket.on('draw_card', () => {
        const gameId = playerToGame.get(socket.id);
        
        if (!gameId) {
            socket.emit('game_error', { message: 'Not in a game' });
            return;
        }
        
        const game = activeGames.get(gameId);
        if (!game) {
            socket.emit('game_error', { message: 'Game not found' });
            return;
        }
        
        const result = game.drawCard(socket.id);
        
        if (result.success) {
            // Broadcast immediately so all clients see the card drawn
            // If turn ends, state will be broadcast again after turn transition completes
            broadcastGameState(gameId, game);
        } else {
            socket.emit('game_error', { message: result.message });
        }
    });
    
    socket.on('end_turn', () => {
        const gameId = playerToGame.get(socket.id);
        
        if (!gameId) {
            socket.emit('game_error', { message: 'Not in a game' });
            return;
        }
        
        const game = activeGames.get(gameId);
        if (!game) {
            socket.emit('game_error', { message: 'Game not found' });
            return;
        }
        
        const result = game.endTurn(socket.id);
        
        if (result.success) {
            // Broadcast immediately so all clients see turn ended
            // State will be broadcast again after turn transition completes
            broadcastGameState(gameId, game);
        } else {
            socket.emit('game_error', { message: result.message });
        }
    });
    
    socket.on('call_uno', () => {
        const gameId = playerToGame.get(socket.id);
        
        if (!gameId) {
            socket.emit('game_error', { message: 'Not in a game' });
            return;
        }
        
        const game = activeGames.get(gameId);
        if (!game) {
            socket.emit('game_error', { message: 'Game not found' });
            return;
        }
        
        const result = game.callUno(socket.id);
        
        if (result.success) {
            // Broadcast immediately for UNO call (no turn transition)
            broadcastGameState(gameId, game);
        } else {
            socket.emit('game_error', { message: result.message });
        }
    });
    
    
    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        
        // Broadcast updated online users count to all clients
        io.emit('online_users_count', { count: io.sockets.sockets.size });
        
        // Remove from lobby
        const lobbyId = playerToLobby.get(socket.id);
        if (lobbyId) {
            lobbyManager.removePlayerFromLobby(socket.id);
            playerToLobby.delete(socket.id);
            
            // Broadcast updated lobby list to all clients
            io.emit('lobby_list', lobbyManager.getAllLobbies());
            
            // Notify other players in lobby
            const lobby = lobbyManager.getLobbyByPlayerId(socket.id);
            if (lobby) {
                lobby.players.forEach(player => {
                    if (player.id !== socket.id) {
                        io.to(player.id).emit('player_left', {
                            id: lobby.id,
                            name: lobby.name,
                            players: lobby.players.map(p => ({ id: p.id, name: p.name })),
                            playerCount: lobby.players.length,
                            maxPlayers: lobby.gameMode || 2,
                            solStake: lobby.solStake
                        });
                    }
                });
            }
        }
        
        // Handle game disconnection
        const gameId = playerToGame.get(socket.id);
        if (gameId) {
            const game = activeGames.get(gameId);
            if (game) {
                // Handle disconnect in game logic
                const result = game.handlePlayerDisconnect(socket.id);
                
                if (result.success) {
                    // Notify all players in the game about the disconnect
                    const fullState = game.getFullState();
                    fullState.players.forEach((player) => {
                        if (player.id !== socket.id) {
                            io.to(player.id).emit('player_disconnected', {
                                disconnectedPlayerIndex: result.disconnectedPlayerIndex,
                                disconnectedPlayerName: result.disconnectedPlayerName,
                                gameEnded: result.gameEnded || false,
                                winnerIndex: result.winnerIndex || null,
                                winnerName: result.winnerName || null
                            });
                        }
                    });
                    
                    // Game continues (never ends due to disconnect), broadcast updated state
                    broadcastGameState(gameId, game);
                }
            }
            
            // Don't remove from player-to-game mapping (player can reconnect)
            // Keep the mapping so we can check for reconnection
        }
    });
});

/**
 * Start a new game when lobby is full
 */
async function startGame(lobby) {
    try {
        const gameId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`[startGame] Attempting to start game ${gameId} for lobby ${lobby.id}`);
        
        // Debug: Log lobby players with their wallets
        console.log(`[startGame] Lobby players:`, lobby.players.map(p => ({
            id: p.id,
            name: p.name,
            wallet: p.wallet || 'MISSING WALLET'
        })));
        
        // Ensure all players have wallets and get usernames from database
        const playerData = await Promise.all(
            lobby.players.map(async (p) => {
                if (!p.wallet) {
                    console.error(`[startGame] Player ${p.name} (${p.id}) has no wallet address!`);
                    return null;
                }
            
            try {
                // Get username from database based on wallet (source of truth)
                const dbUser = await getUserByWallet(p.wallet);
                const username = dbUser ? dbUser.username : p.name; // Fallback to stored name if DB lookup fails
                
                return {
                    id: p.id,
                    name: username,
                    wallet: p.wallet
                };
            } catch (error) {
                console.error(`[startGame] Error getting user for wallet ${p.wallet}:`, error);
                // Fallback to stored name if DB lookup fails
                return {
                    id: p.id,
                    name: p.name,
                    wallet: p.wallet
                };
            }
        })
    );
    
    // Filter out any null entries (players without wallets)
    const validPlayers = playerData.filter(p => p !== null);
    
    if (validPlayers.length !== lobby.players.length) {
        console.error(`[startGame] ERROR: Some players missing wallets. Expected ${lobby.players.length}, got ${validPlayers.length}. Cannot start game.`);
        // Emit error to all players in lobby
        lobby.players.forEach(player => {
            const socket = io.sockets.sockets.get(player.id);
            if (socket) {
                socket.emit('lobby_error', { message: 'Cannot start game: Some players are missing wallet addresses' });
            }
        });
        return; // Don't start the game
    }
    
    const playerIds = validPlayers.map(p => p.id);
    const playerNames = validPlayers.map(p => p.name);
    const playerWallets = validPlayers.map(p => p.wallet);
    
    console.log(`[startGame] Starting game ${gameId} with ${validPlayers.length} players`);
    console.log(`[startGame] Players:`, validPlayers.map(p => `${p.name} (${p.wallet})`).join(', '));
    
    // Final validation before creating game
    if (playerIds.length === 0 || playerNames.length === 0 || playerWallets.length === 0) {
        console.error(`[startGame] ERROR: Cannot create game with empty player arrays!`);
        console.error(`[startGame] playerIds: ${playerIds.length}, playerNames: ${playerNames.length}, playerWallets: ${playerWallets.length}`);
        lobby.players.forEach(player => {
            const socket = io.sockets.sockets.get(player.id);
            if (socket) {
                socket.emit('lobby_error', { message: 'Failed to start game: Invalid player data' });
            }
        });
        return;
    }
    
    if (playerIds.length !== playerNames.length || playerIds.length !== playerWallets.length) {
        console.error(`[startGame] ERROR: Player arrays length mismatch!`);
        console.error(`[startGame] playerIds: ${playerIds.length}, playerNames: ${playerNames.length}, playerWallets: ${playerWallets.length}`);
        lobby.players.forEach(player => {
            const socket = io.sockets.sockets.get(player.id);
            if (socket) {
                socket.emit('lobby_error', { message: 'Failed to start game: Player data mismatch' });
            }
        });
        return;
    }
    
    // Create new game
    const game = new Game(playerIds, playerNames, playerWallets);
    
    // Validate game was created correctly
    const gameState = game.getFullState();
    if (!gameState.players || gameState.players.length === 0) {
        console.error(`[startGame] ERROR: Game created with no players!`);
        lobby.players.forEach(player => {
            const socket = io.sockets.sockets.get(player.id);
            if (socket) {
                socket.emit('lobby_error', { message: 'Failed to start game: Game initialization failed' });
            }
        });
        return;
    }
    
    console.log(`[startGame] Game created successfully with ${gameState.players.length} players`);
    
    // Save game to database
    try {
        const totalStake = lobby.solStake * lobby.gameMode;
        await createGame({
            gameId: gameId,
            lobbyId: lobby.id,
            lobbyNumber: lobby.name,
            players: lobby.players.map((p, index) => ({
                username: p.name,
                wallet: p.wallet || null,
                playerIndex: index
            })),
            gameMode: lobby.gameMode,
            solStake: lobby.solStake,
            totalStake: totalStake
        });
        console.log(`Game ${gameId} saved to database`);
    } catch (error) {
        console.error('Error saving game to database:', error);
        // Continue even if database save fails
    }
    
    // Set callback for state changes (e.g., timer expiration)
    game.setStateChangeCallback(() => {
        broadcastGameState(gameId, game);
    });
    
    // Set callback for turn start events
    game.setTurnStartCallback((data) => {
        // Send turn_start event to all players in the game
        const fullState = game.getFullState();
        fullState.players.forEach((player) => {
            io.to(player.id).emit('turn_start', data);
        });
    });
    
    // Set callback for turn timeout events
    game.setTurnTimeoutCallback((data) => {
        // Send turn_timeout event to all players in the game
        const fullState = game.getFullState();
        fullState.players.forEach((player) => {
            io.to(player.id).emit('turn_timeout', data);
        });
    });
    
    // Draw first card immediately (client will hide it during deal animation)
    game.drawFirstCard();
    
    activeGames.set(gameId, game);
    
    // Map game to lobby for chat routing
    gameToLobby.set(gameId, lobby.id);
    
    // Map players to game
    playerIds.forEach((playerId, index) => {
        playerToGame.set(playerId, gameId);
        // Also map player name to game for reconnection
        playerNameToGame.set(playerNames[index], gameId);
    });
    
    // Mark lobby as in-game (keep it visible as "game in progress")
    lobbyManager.setLobbyInGame(lobby.id, gameId);
    
    // Track that game has started for this lobby (for refund logic)
    lobbyToGame.set(lobby.id, gameId);
    
    // Get the actual lobby object from manager (has gameMode property, not maxPlayers)
    const actualLobby = lobbyManager.getLobbyById(lobby.id);
    
    // Create a new replacement lobby with the same settings (original stays as "in-game")
    if (actualLobby) {
        const newLobby = lobbyManager.createReplacementLobby(lobby.id);
        if (newLobby) {
            console.log(`Created replacement lobby ${newLobby.id} (original ${lobby.id} is now in-game) with settings: ${actualLobby.gameMode}P, ${actualLobby.solStake} SOL`);
        } else {
            console.error(`Could not create replacement lobby for ${lobby.id}`);
        }
    } else {
        console.error(`Could not find lobby ${lobby.id} to create replacement`);
    }
    
    // Broadcast updated lobby list to all clients (original lobby shows as in-game, new replacement lobby available)
    io.emit('lobby_list', lobbyManager.getAllLobbies());
    
    // Remove players from lobby tracking
    playerIds.forEach(playerId => {
        playerToLobby.delete(playerId);
    });
    
    // Send game start event to all players
    playerIds.forEach(playerId => {
        const publicState = game.getPublicState(playerId);
        io.to(playerId).emit('game_start', {
            gameId: gameId,
            playerIndex: playerIds.indexOf(playerId),
            gameState: publicState
        });
    });
    
        console.log(`[startGame] Game started: ${gameId} with players: ${playerNames.join(', ')}`);
    } catch (error) {
        console.error(`[startGame] ERROR starting game:`, error);
        console.error(`[startGame] Error stack:`, error.stack);
        
        // Notify all players in lobby about the error
        if (lobby && lobby.players) {
            lobby.players.forEach(player => {
                const socket = io.sockets.sockets.get(player.id);
                if (socket) {
                    socket.emit('lobby_error', { 
                        message: 'Failed to start game. Please try again.' 
                    });
                }
            });
        }
    }
}

/**
 * Broadcast game state to all players in a game
 */
function broadcastGameState(gameId, game) {
    const fullState = game.getFullState();
    
    // Send personalized state to each player
    fullState.players.forEach((player, index) => {
        const publicState = game.getPublicState(player.id);
        io.to(player.id).emit('game_state_update', publicState);
    });
}

/**
 * Handle game end - cleanup and notify players
 */
async function handleGameEnd(gameId, game) {
    const fullState = game.getFullState();
    const winnerIndex = fullState.winner;
    const winnerPlayer = fullState.players[winnerIndex];
    
    console.log(`Game ${gameId} ended. Winner: ${winnerPlayer ? winnerPlayer.name : 'Unknown'}`);
    
    // Get game data from database (source of truth for lobby configuration)
    let gameData = null;
    try {
        gameData = await getGameByGameId(gameId);
        if (!gameData) {
            console.error(`[handleGameEnd] Game ${gameId} not found in database`);
        } else {
            console.log(`[handleGameEnd] Retrieved game data from database: solStake=${gameData.solStake}, gameMode=${gameData.gameMode}`);
        }
    } catch (error) {
        console.error(`[handleGameEnd] Error fetching game from database:`, error);
    }
    
    // Get winner's wallet and username from database
    let winnerWallet = null;
    let winnerUsername = null;
    
    if (winnerPlayer) {
        winnerWallet = winnerPlayer.wallet;
        
        // If wallet exists, get username from database
        if (winnerWallet) {
            try {
                const dbUser = await getUserByWallet(winnerWallet);
                winnerUsername = dbUser ? dbUser.username : winnerPlayer.name; // Fallback to game name
            } catch (error) {
                console.error(`[handleGameEnd] Error getting username for wallet ${winnerWallet}:`, error);
                winnerUsername = winnerPlayer.name; // Fallback to game name
            }
        }
    }
    
    // Update game in database with winner
    try {
        await updateGameOnEnd(gameId, {
            winner: {
                username: winnerUsername || winnerPlayer?.name || 'Unknown',
                wallet: winnerWallet,
                playerIndex: winnerIndex
            }
        });
        console.log(`Game ${gameId} updated in database with winner: ${winnerUsername} (${winnerWallet})`);
    } catch (error) {
        console.error('Error updating game in database:', error);
    }
    
    // Create match history record (before winnings distribution, so we have record even if distribution fails)
    try {
        if (gameData && winnerUsername && winnerWallet) {
            const players = fullState.players.map(p => ({
                username: p.name,
                wallet: p.wallet || null
            }));
            
            const gameModeStr = `${gameData.gameMode}p`;
            const totalStake = gameData.totalStake || (gameData.solStake * gameData.gameMode);
            const estimatedWinAmount = totalStake * 0.98; // 98% after 2% fee (will be updated if distribution succeeds)
            
            await createMatchHistory({
                gameId: gameId, // Use gameId as unique identifier
                players: players,
                gameMode: gameModeStr,
                winner: {
                    username: winnerUsername,
                    wallet: winnerWallet
                },
                stake: gameData.solStake || 0,
                winAmount: estimatedWinAmount,
                txHash: null // Will be updated after distribution
            });
            console.log(`✅ [handleGameEnd] Match history created for game ${gameId}`);
            
            // Invalidate recent wins cache
            recentWinsCache = null;
        }
    } catch (error) {
        console.error('❌ [handleGameEnd] Error creating match history:', error);
    }
    
    // Distribute winnings if winner exists and has wallet
    // Use game data from database (source of truth) instead of lobby
    if (winnerWallet && gameData) {
        const totalStake = gameData.totalStake || (gameData.solStake * gameData.gameMode);
        
        console.log(`[handleGameEnd] Starting winnings distribution for game ${gameId}`);
        console.log(`[handleGameEnd] Winner: ${winnerUsername} (${winnerWallet})`);
        console.log(`[handleGameEnd] Total stake: ${totalStake} SOL (${gameData.solStake} SOL per player × ${gameData.gameMode} players)`);
        
        try {
            const distributionResult = await distributeWinnings(winnerWallet, totalStake);
            
            if (distributionResult.success) {
                console.log(`✅ [handleGameEnd] Successfully distributed winnings to ${winnerWallet}:`);
                console.log(`  Total stake: ${distributionResult.totalStake} SOL`);
                console.log(`  Fee (2%): ${distributionResult.feeAmount} SOL`);
                console.log(`  Winner amount: ${distributionResult.winnerAmount} SOL`);
                console.log(`  Transactions:`, distributionResult.transactions);
                
                // Extract transaction hashes
                const winningsTx = distributionResult.transactions.find(t => t.type === 'winnings');
                const feeTx = distributionResult.transactions.find(t => t.type === 'fee');
                
                // Update game with transaction hashes
                let winningsTxHash = null;
                try {
                    winningsTxHash = winningsTx ? winningsTx.signature : null;
                    await updateGameTransactions(
                        gameId,
                        winningsTxHash,
                        feeTx ? feeTx.signature : null
                    );
                    console.log(`✅ [handleGameEnd] Game ${gameId} updated with transaction hashes`);
                } catch (error) {
                    console.error('❌ [handleGameEnd] Error updating game transactions:', error);
                }
                
                // Update match history with actual win amount and transaction hash
                try {
                    if (gameData && winnerUsername && winnerWallet) {
                        const gameModeStr = `${gameData.gameMode}p`;
                        const winAmount = distributionResult.winnerAmount || (totalStake * 0.98);
                        
                        // Update match history using gameId (unique identifier)
                        await updateMatchHistoryTxHash(gameId, winningsTxHash, winAmount);
                        console.log(`✅ [handleGameEnd] Match history updated with win amount and tx hash`);
                        
                        // Invalidate recent wins cache
                        recentWinsCache = null;
                    }
                } catch (error) {
                    console.error('❌ [handleGameEnd] Error updating match history:', error);
                }
                
                // Notify winner
                const winnerSocket = io.sockets.sockets.get(winnerPlayer.id);
                if (winnerSocket) {
                    winnerSocket.emit('winnings_distributed', {
                        totalStake: distributionResult.totalStake,
                        feeAmount: distributionResult.feeAmount,
                        winnerAmount: distributionResult.winnerAmount,
                        transactions: distributionResult.transactions
                    });
                    console.log(`✅ [handleGameEnd] Notified winner via socket`);
                } else {
                    console.warn(`⚠️ [handleGameEnd] Winner socket not found (player may have disconnected)`);
                }
            } else {
                console.error(`❌ [handleGameEnd] Failed to distribute winnings:`, distributionResult.error);
                // Notify winner of error
                const winnerSocket = io.sockets.sockets.get(winnerPlayer.id);
                if (winnerSocket) {
                    winnerSocket.emit('winnings_error', {
                        error: distributionResult.error || 'Failed to distribute winnings'
                    });
                }
            }
        } catch (error) {
            console.error('❌ [handleGameEnd] Exception while distributing winnings:', error);
            console.error('❌ [handleGameEnd] Error stack:', error.stack);
            // Notify winner of error
            const winnerSocket = io.sockets.sockets.get(winnerPlayer.id);
            if (winnerSocket) {
                winnerSocket.emit('winnings_error', {
                    error: error.message || 'Failed to distribute winnings'
                });
            }
        }
        
        // Clean up payment records for all players in this game
        fullState.players.forEach(player => {
            if (player.wallet) {
                playerPayments.delete(player.wallet);
            }
        });
    } else {
        if (!winnerPlayer) {
            console.warn(`⚠️ [handleGameEnd] No winner player found for game ${gameId}`);
        } else if (!winnerWallet) {
            console.warn(`⚠️ [handleGameEnd] Winner ${winnerPlayer.name} has no wallet address`);
        } else if (!gameData) {
            console.warn(`⚠️ [handleGameEnd] Game data not found in database for game ${gameId}`);
        }
    }
    
    // Get lobby for cleanup (may not exist if it was replaced, but we try)
    const lobby = lobbyManager.getLobbyByGameId(gameId);
    
    // Remove player names from reconnection mapping (game is finished, no reconnection allowed)
    fullState.players.forEach(player => {
        const playerName = player.originalName || player.name.replace(' (Disconnected)', '');
        playerNameToGame.delete(playerName);
    });
    
    // Clean up game after a delay (allow clients to see final state and win message)
    // Players can return to lobby using the button, so we give them time
    setTimeout(() => {
        // Only clean up if game still exists (players might have already left)
        if (activeGames.has(gameId)) {
            const gameToCleanup = activeGames.get(gameId);
            const stateToCleanup = gameToCleanup.getFullState();
            
            // Remove game from active games
            activeGames.delete(gameId);
            
            // Clean up game to lobby mapping
            gameToLobby.delete(gameId);
            
            // Clean up lobby to game mapping
            if (lobby) {
                lobbyToGame.delete(lobby.id);
            }
            
            // Clean up player mappings
            stateToCleanup.players.forEach(player => {
                playerToGame.delete(player.id);
            });
            
            // Remove the "in-game" lobby (replacement lobby was already created when game started)
            if (lobby) {
                lobbyManager.removeLobby(lobby.id);
                console.log(`Removed in-game lobby ${lobby.id} after game ended (replacement lobby already exists)`);
                
                // Broadcast updated lobby list (in-game lobby removed, replacement already exists)
                io.emit('lobby_list', lobbyManager.getAllLobbies());
            }
            
            console.log(`Game ${gameId} cleaned up after normal completion`);
        }
    }, 30000); // 30 seconds - enough time for players to see win message and return to lobby
}

// Start server with MongoDB connection
async function startServer() {
    try {
        // Test MongoDB connection
        const connected = await testConnection();
        if (!connected) {
            console.error('Failed to connect to MongoDB. Server will still start but database features may not work.');
        } else {
            // Initialize database indexes
            await initializeIndexes();
        }
        
        // Start HTTP server
        server.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
            console.log(`Open your browser and navigate to http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Error starting server:', error);
        process.exit(1);
    }
}

startServer();
