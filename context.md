
UNO Multiplayer – Project Context
Core Game Structure

The game will have lobbies where players join before a match starts.

Each lobby has a maximum of 2 players (for now).

A player pays to join a lobby; when the second player joins, the game should automatically transition from lobby to live match.

The transition must be instant, smooth, and handled by the server, not dependent on canvas or heavy UI logic.

Lobby → Game Flow

The lobby itself is NOT canvas-based; it's simple HTML/CSS UI.

Only the actual UNO game will be rendered inside a canvas or advanced UI component.

Server sends a message (WS) like game_start to both players when lobby is full & payment is confirmed.

Both clients then switch from lobby UI → game UI.

Networking & Architecture

We will use WebSockets for real-time communication.

The lobby should be lightweight and should not lag — it only listens for events like:

player joined

second player joined

game starting

Game logic runs on backend; clients only render and send actions.

Payments / Solana Wallet

Users connect Solana wallet before joining a lobby.

Joining a lobby requires pre-payment / entry fee.

Handling Solana connection + payment is separate from the lobby logic, but occurs before entering a match queue.

After payment, player is placed in lobby and waits for second player.

Performance / Lag

Transition from lobby → game does not create lag since:

No canvas is active during lobby.

Canvas only initializes once game begins.

Correct server region helps, but lobby-to-game is lightweight and should not cause noticeable lag.