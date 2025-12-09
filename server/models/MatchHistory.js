import { getDatabase } from '../db.js';

const COLLECTION_NAME = 'matchHistory';

/**
 * Match History Model
 * 
 * Schema:
 * - _id: ObjectId (auto-generated)
 * - gameId: string (unique game identifier)
 * - players: Array of { username: string, wallet: string }
 * - gameMode: string ('2p', '3p', '4p')
 * - winner: { username: string, wallet: string }
 * - stake: number (SOL stake per player)
 * - winAmount: number (Total SOL won by winner, after fees)
 * - createdAt: Date (match end time)
 * - txHash: string (Solana transaction hash, optional initially)
 */

/**
 * Create a new match history record
 * @param {Object} matchData - Match data
 * @param {string} matchData.gameId - Unique game identifier (required)
 * @param {Array<{username: string, wallet: string}>} matchData.players - Array of players
 * @param {string} matchData.gameMode - Game mode ('2p', '3p', '4p')
 * @param {Object} matchData.winner - Winner object { username: string, wallet: string }
 * @param {number} matchData.stake - SOL stake per player
 * @param {number} matchData.winAmount - Total SOL won by winner (after fees)
 * @param {string} [matchData.txHash] - Optional transaction hash
 * @returns {Promise<Object>} Created match history document
 */
export async function createMatchHistory(matchData) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    if (!matchData.gameId) {
        throw new Error('gameId is required for match history');
    }
    
    const matchHistory = {
        gameId: matchData.gameId,
        players: matchData.players,
        gameMode: matchData.gameMode,
        winner: matchData.winner,
        stake: matchData.stake || 0,
        winAmount: matchData.winAmount || 0,
        createdAt: new Date(),
        txHash: matchData.txHash || null
    };
    
    const result = await collection.insertOne(matchHistory);
    
    // Return the created document
    return await collection.findOne({ _id: result.insertedId });
}

/**
 * Get recent wins for display
 * @param {number} limit - Number of recent wins to return (default: 20)
 * @returns {Promise<Array>} Array of recent win documents
 */
export async function getRecentWins(limit = 10) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    return await collection
        .find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
}

/**
 * Get match history by wallet address
 * @param {string} wallet - User's wallet address
 * @param {number} limit - Number of matches to return
 * @param {number} skip - Number of matches to skip
 * @returns {Promise<Array>} Array of match history documents
 */
export async function getMatchHistoryByWallet(wallet, limit = 50, skip = 0) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    // Find matches where the wallet is either a player or the winner
    return await collection
        .find({
            $or: [
                { 'players.wallet': wallet },
                { 'winner.wallet': wallet }
            ]
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .toArray();
}

/**
 * Get match history by username
 * @param {string} username - User's username
 * @param {number} limit - Number of matches to return
 * @param {number} skip - Number of matches to skip
 * @returns {Promise<Array>} Array of match history documents
 */
export async function getMatchHistoryByUsername(username, limit = 50, skip = 0) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    // Find matches where the username is either a player or the winner
    return await collection
        .find({
            $or: [
                { 'players.username': username },
                { 'winner.username': username }
            ]
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .toArray();
}

/**
 * Get match history by game ID
 * @param {string} gameId - Game identifier
 * @returns {Promise<Object|null>} Match history document or null
 */
export async function getMatchHistoryByGameId(gameId) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    return await collection.findOne({ gameId: gameId });
}


/**
 * Update match history with transaction hash and/or win amount
 * @param {string} gameId - Game identifier
 * @param {string} txHash - Transaction hash
 * @param {number} [winAmount] - Optional win amount to update
 * @returns {Promise<Object|null>} Updated match history document or null
 */
export async function updateMatchHistoryTxHash(gameId, txHash, winAmount = null) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    const updateData = {
        txHash: txHash,
        updatedAt: new Date()
    };
    
    if (winAmount !== null) {
        updateData.winAmount = winAmount;
    }
    
    const result = await collection.findOneAndUpdate(
        { gameId: gameId },
        {
            $set: updateData
        },
        { returnDocument: 'after' }
    );
    
    return result;
}

/**
 * Get all match history (for admin purposes, paginated)
 * @param {number} limit - Number of matches to return
 * @param {number} skip - Number of matches to skip
 * @returns {Promise<Array>} Array of match history documents
 */
export async function getAllMatchHistory(limit = 100, skip = 0) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    return await collection
        .find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .toArray();
}

/**
 * Get match statistics for a user
 * @param {string} wallet - User's wallet address
 * @returns {Promise<Object>} Statistics object
 */
export async function getUserMatchStats(wallet) {
    const db = await getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    const totalMatches = await collection.countDocuments({
        $or: [
            { 'players.wallet': wallet },
            { 'winner.wallet': wallet }
        ]
    });
    
    const wins = await collection.countDocuments({
        'winner.wallet': wallet
    });
    
    const losses = totalMatches - wins;
    
    return {
        totalMatches,
        wins,
        losses,
        winRate: totalMatches > 0 ? (wins / totalMatches * 100).toFixed(2) : 0
    };
}

