/**
 * Lobby Manager
 * Handles matchmaking slots (lobbies)
 * Maintains 15 constant lobbies with different configurations
 * Each game mode (2p, 3p, 4p) has 5 lobbies with SOL prices: 0.01, 0.05, 0.25, 0.5, 1.0
 */

export class LobbyManager {
    constructor() {
        // Fixed number of lobby slots - always maintain 15 lobbies
        this.lobbies = [];
        this.maxLobbies = 15;
        this.lobbyCounter = 0; // For generating unique lobby IDs
        
        // Persistent lobby IDs (will be saved to DB later)
        // For now, use simple structure: lobby_1, lobby_2, etc.
        this.persistentLobbyIds = [];
        
        // SOL stake prices for each lobby
        this.solStakes = [0.01, 0.05, 0.25, 0.5, 1.0];
        
        // Initialize 15 constant lobbies with different configurations
        this.initializeLobbies();
    }
    
    /**
     * Initialize 15 constant lobbies with different configurations
     * Each game mode (2p, 3p, 4p) has 5 lobbies with SOL prices: 0.01, 0.05, 0.25, 0.5, 1.0
     */
    initializeLobbies() {
        const gameModes = [2, 3, 4];
        let lobbyIndex = 0;
        
        // Create 5 lobbies for each game mode
        for (const gameMode of gameModes) {
            // Each mode gets all 5 SOL stake prices
            for (const solStake of this.solStakes) {
                const persistentId = `lobby_${lobbyIndex + 1}`;
                this.persistentLobbyIds.push(persistentId);
                
                this.lobbies.push({
                    id: persistentId,
                    name: `Lobby #${lobbyIndex + 1}`,
                    players: [],
                    status: 'waiting',
                    gameMode: gameMode,
                    solStake: solStake,
                    gameId: null // Track associated game
                });
                
                lobbyIndex++;
            }
        }
    }
    
    /**
     * Get lobby by ID
     * @param {string} lobbyId - Lobby ID
     * @returns {Object|null} Lobby object or null
     */
    getLobbyById(lobbyId) {
        return this.lobbies.find(l => l.id === lobbyId) || null;
    }
    
    /**
     * Get all lobbies (for client display)
     * @returns {Array} Array of lobby objects
     */
    getAllLobbies() {
        return this.lobbies.map(lobby => ({
            id: lobby.id,
            name: lobby.name,
            players: lobby.players.map(p => ({ 
                id: p.id, 
                name: p.name,
                wallet: p.wallet || null,
                pfpUrl: p.pfpUrl || '/pfp/default.jpg'
            })),
            playerCount: lobby.players.length,
            maxPlayers: lobby.gameMode,
            solStake: lobby.solStake,
            status: lobby.status
        }));
    }
    
    /**
     * Create a new replacement lobby when a game starts (keeps original lobby as in-game)
     * @param {string} lobbyId - Lobby ID that started the game
     * @returns {Object} New lobby object with same configuration
     */
    createReplacementLobby(lobbyId) {
        const oldLobby = this.getLobbyById(lobbyId);
        if (!oldLobby) return null;
        
        // Create a new lobby with the same configuration (new ID, new name)
        return this.createLobbyWithSettings(oldLobby.gameMode, oldLobby.solStake);
    }
    
    /**
     * Add player to specific lobby
     * @param {string} playerId - Player socket ID
     * @param {string} playerName - Player name
     * @param {string} lobbyId - Lobby ID to join
     * @param {string} [wallet] - Player wallet address
     * @param {string} [pfpUrl] - Player profile picture URL
     * @returns {Object} { lobby, playerIndex, isFull }
     */
    addPlayerToLobby(playerId, playerName, lobbyId, wallet = null, pfpUrl = null) {
        const lobby = this.getLobbyById(lobbyId);
        
        if (!lobby) {
            return { success: false, message: 'Lobby not found' };
        }
        
        // Check if lobby is available
        if (lobby.status !== 'waiting') {
            return { success: false, message: 'Lobby is not available' };
        }
        
        // Check if player is already in a lobby (by socket ID or wallet)
        if (this.lobbies.some(l => l.players.some(p => p.id === playerId || (wallet && p.wallet === wallet)))) {
            return { success: false, message: 'Player already in a lobby' };
        }
        
        // Check if lobby has space
        if (lobby.players.length >= lobby.gameMode) {
            return { success: false, message: 'Lobby is full' };
        }
        
        // Add player
        lobby.players.push({
            id: playerId,
            name: playerName || `Player ${lobby.players.length + 1}`,
            wallet: wallet || null,
            pfpUrl: pfpUrl || '/pfp/default.jpg',
            joinedAt: Date.now()
        });
        
        const isFull = lobby.players.length >= lobby.gameMode;
        
        if (isFull) {
            lobby.status = 'full';
        }
        
        return {
            success: true,
            lobby: {
                id: lobby.id,
                name: lobby.name,
                players: lobby.players.map(p => ({ 
                    id: p.id, 
                    name: p.name,
                    wallet: p.wallet || null,
                    pfpUrl: p.pfpUrl || '/pfp/default.jpg'
                })),
                playerCount: lobby.players.length,
                maxPlayers: lobby.gameMode,
                solStake: lobby.solStake,
                status: lobby.status
            },
            playerIndex: lobby.players.length - 1,
            isFull: isFull
        };
    }
    
    /**
     * Remove player from lobby
     * @param {string} playerId - Player socket ID
     * @returns {Object} Result
     */
    removePlayerFromLobby(playerId) {
        for (const lobby of this.lobbies) {
            const playerIndex = lobby.players.findIndex(p => p.id === playerId);
            if (playerIndex !== -1) {
                lobby.players.splice(playerIndex, 1);
                
                // Reset lobby status if it was full
                if (lobby.status === 'full') {
                    lobby.status = 'waiting';
                }
                
                return {
                    success: true,
                    lobby: {
                        id: lobby.id,
                        players: lobby.players.map(p => ({ id: p.id, name: p.name })),
                        playerCount: lobby.players.length,
                        maxPlayers: lobby.gameMode || 2
                    }
                };
            }
        }
        
        return { success: false, message: 'Player not found in any lobby' };
    }
    
    /**
     * Get lobby by player ID
     * @param {string} playerId - Player socket ID
     * @returns {Object|null} Lobby object or null
     */
    getLobbyByPlayerId(playerId) {
        return this.lobbies.find(lobby => 
            lobby.players.some(p => p.id === playerId)
        ) || null;
    }
    
    /**
     * Mark lobby as in-game (game started)
     * @param {string} lobbyId - Lobby ID
     * @param {string} gameId - Game ID
     */
    setLobbyInGame(lobbyId, gameId) {
        const lobby = this.getLobbyById(lobbyId);
        if (lobby) {
            lobby.status = 'in-game';
            lobby.gameId = gameId;
        }
    }
    
    /**
     * Remove lobby entirely (when game ends)
     * @param {string} lobbyId - Lobby ID to remove
     * @returns {boolean} True if lobby was found and removed
     */
    removeLobby(lobbyId) {
        const lobbyIndex = this.lobbies.findIndex(l => l.id === lobbyId);
        if (lobbyIndex === -1) {
            return false;
        }
        
        // Remove lobby from array
        this.lobbies.splice(lobbyIndex, 1);
        return true;
    }
    
    /**
     * Remove lobby when game ends and create new one to maintain count
     * @deprecated Use removeLobby() instead - new lobbies are created when games start
     * @param {string} lobbyId - Lobby ID
     */
    removeLobbyAfterGame(lobbyId) {
        const lobbyIndex = this.lobbies.findIndex(l => l.id === lobbyId);
        if (lobbyIndex === -1) return;
        
        const oldLobby = this.lobbies[lobbyIndex];
        
        // Generate random configuration for new lobby
        const gameModes = [2, 3, 4];
        const solStakes = [0.5, 0.75, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0];
        
        // Keep same persistent ID and name
        const newLobby = {
            id: oldLobby.id, // Keep persistent ID
            name: oldLobby.name, // Keep same name
            players: [],
            status: 'waiting',
            gameMode: gameModes[Math.floor(Math.random() * gameModes.length)],
            solStake: solStakes[Math.floor(Math.random() * solStakes.length)],
            gameId: null
        };
        
        this.lobbies[lobbyIndex] = newLobby;
        return newLobby;
    }
    
    /**
     * Get lobby by game ID
     * @param {string} gameId - Game ID
     * @returns {Object|null} Lobby object or null
     */
    getLobbyByGameId(gameId) {
        return this.lobbies.find(l => l.gameId === gameId) || null;
    }
    
    /**
     * Create a new lobby with specific settings
     * @param {number} gameMode - Number of players (2, 3, or 4)
     * @param {number} solStake - SOL stake amount
     * @returns {Object} New lobby object
     */
    createLobbyWithSettings(gameMode, solStake) {
        // Validate parameters
        if (!gameMode || (gameMode !== 2 && gameMode !== 3 && gameMode !== 4)) {
            console.error(`Invalid gameMode: ${gameMode}, defaulting to 2`);
            gameMode = 2;
        }
        if (!solStake || typeof solStake !== 'number' || solStake <= 0) {
            console.error(`Invalid solStake: ${solStake}, defaulting to 1.0`);
            solStake = 1.0;
        }
        
        // Generate unique lobby ID
        const newLobbyId = `lobby_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Find the highest lobby number to create a new name
        let maxLobbyNum = 0;
        this.lobbies.forEach(lobby => {
            const match = lobby.name.match(/Lobby #(\d+)/);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxLobbyNum) {
                    maxLobbyNum = num;
                }
            }
        });
        
        const newLobby = {
            id: newLobbyId,
            name: `Lobby #${maxLobbyNum + 1}`,
            players: [],
            status: 'waiting',
            gameMode: gameMode,
            solStake: solStake,
            gameId: null
        };
        
        // Add to lobbies array
        this.lobbies.push(newLobby);
        
        return newLobby;
    }
}

