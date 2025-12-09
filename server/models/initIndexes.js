import { getDatabase } from '../db.js';

/**
 * Initialize database indexes for optimal query performance
 * Call this once when the server starts
 */
export async function initializeIndexes() {
    try {
        const db = await getDatabase();
        
        // Users collection indexes
        const usersCollection = db.collection('users');
        await usersCollection.createIndex({ wallet: 1 }, { unique: true });
        await usersCollection.createIndex({ username: 1 }, { unique: true });
        await usersCollection.createIndex({ createdAt: -1 });
        
        // Match history collection indexes
        const matchHistoryCollection = db.collection('matchHistory');
        await matchHistoryCollection.createIndex({ 'players.wallet': 1 });
        await matchHistoryCollection.createIndex({ 'winner.wallet': 1 });
        
        // Drop old unique index on lobbyNumber if it exists (migration)
        try {
            await matchHistoryCollection.dropIndex('lobbyNumber_1');
            console.log('Dropped old unique index on lobbyNumber');
        } catch (error) {
            // Index might not exist, that's okay
            if (error.code !== 27) { // 27 = IndexNotFound
                console.warn('Could not drop lobbyNumber index:', error.message);
            }
        }
        
        // Drop non-unique lobbyNumber index if it exists (migration)
        try {
            await matchHistoryCollection.dropIndex('lobbyNumber_1');
            console.log('Dropped old lobbyNumber index');
        } catch (error) {
            // Index might not exist, that's okay
            if (error.code !== 27) { // 27 = IndexNotFound
                // Ignore - might have already been dropped above
            }
        }
        
        // Create new indexes
        await matchHistoryCollection.createIndex({ gameId: 1 }, { unique: true });
        await matchHistoryCollection.createIndex({ createdAt: -1 });
        await matchHistoryCollection.createIndex({ gameMode: 1 });
        
        // Games collection indexes
        const gamesCollection = db.collection('games');
        await gamesCollection.createIndex({ gameId: 1 }, { unique: true });
        await gamesCollection.createIndex({ lobbyId: 1 });
        await gamesCollection.createIndex({ 'players.wallet': 1 });
        await gamesCollection.createIndex({ 'winner.wallet': 1 });
        await gamesCollection.createIndex({ status: 1 });
        await gamesCollection.createIndex({ startedAt: -1 });
        await gamesCollection.createIndex({ endedAt: -1 });
        
        console.log('✅ Database indexes initialized successfully');
    } catch (error) {
        console.error('❌ Error initializing database indexes:', error);
        // Don't throw - indexes might already exist
    }
}

