# Database Models

This directory contains MongoDB models for the UNO multiplayer game.

## Models

### User Model (`User.js`)

Manages user accounts with wallet-based authentication.

**Schema:**
- `username`: string (unique)
- `wallet`: string (unique, public wallet address - primary identifier)
- `createdAt`: Date
- `updatedAt`: Date

**Functions:**
- `createOrUpdateUser(username, wallet)` - Create or update a user
- `getUserByWallet(wallet)` - Get user by wallet address
- `getUserByUsername(username)` - Get user by username
- `updateUsername(wallet, newUsername)` - Update user's username
- `getAllUsers(limit, skip)` - Get all users (paginated)

### Match History Model (`MatchHistory.js`)

Tracks game match history for analytics and display.

**Schema:**
- `lobbyNumber`: string (unique lobby identifier)
- `players`: Array of `{ username: string, wallet: string }`
- `gameMode`: string ('2p', '3p', '4p')
- `winner`: `{ username: string, wallet: string }`
- `createdAt`: Date (match end time)
- `txHash`: string (Solana transaction hash, optional)

**Functions:**
- `createMatchHistory(matchData)` - Create a new match record
- `getMatchHistoryByWallet(wallet, limit, skip)` - Get matches for a wallet
- `getMatchHistoryByUsername(username, limit, skip)` - Get matches for a username
- `getMatchHistoryByLobbyNumber(lobbyNumber)` - Get match by lobby number
- `updateMatchHistoryTxHash(lobbyNumber, txHash)` - Update transaction hash
- `getAllMatchHistory(limit, skip)` - Get all matches (paginated)
- `getUserMatchStats(wallet)` - Get user statistics (wins, losses, win rate)

## Usage Examples

### Creating/Updating a User
```javascript
import { createOrUpdateUser } from './server/models/User.js';

const user = await createOrUpdateUser('player1', 'SolanaWalletAddress123...');
```

### Creating Match History
```javascript
import { createMatchHistory } from './server/models/MatchHistory.js';

const match = await createMatchHistory({
    lobbyNumber: 'lobby_1',
    players: [
        { username: 'player1', wallet: 'wallet1...' },
        { username: 'player2', wallet: 'wallet2...' }
    ],
    gameMode: '2p',
    winner: { username: 'player1', wallet: 'wallet1...' },
    txHash: null // Will be added later when payment is processed
});
```

### Getting User Match History
```javascript
import { getMatchHistoryByWallet } from './server/models/MatchHistory.js';

const matches = await getMatchHistoryByWallet('walletAddress...', 10, 0);
```

### Getting User Statistics
```javascript
import { getUserMatchStats } from './server/models/MatchHistory.js';

const stats = await getUserMatchStats('walletAddress...');
// Returns: { totalMatches: 10, wins: 7, losses: 3, winRate: '70.00' }
```

## Indexes

Database indexes are automatically created on server startup via `initIndexes.js`:
- Users: `wallet` (unique), `username` (unique), `createdAt`
- Match History: `players.wallet`, `winner.wallet`, `lobbyNumber` (unique), `createdAt`, `gameMode`

