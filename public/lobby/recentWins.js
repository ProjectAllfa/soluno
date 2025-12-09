/**
 * Recent Wins Component
 * Displays recent game wins in a table
 */

import { getPfpUrl } from '../utils/pfpLoader.js';

// UI Elements
const recentWinsTableBody = document.getElementById('recentWinsTableBody');
const recentWinsContainer = document.querySelector('.recent-wins-container');
let refreshInterval = null;

/**
 * Format time for display
 */
function formatTime(date) {
    if (!date) return 'N/A';
    
    const d = new Date(date);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) {
        return 'Just now';
    } else if (diffMins < 60) {
        return `${diffMins}m ago`;
    } else if (diffHours < 24) {
        return `${diffHours}h ago`;
    } else if (diffDays < 7) {
        return `${diffDays}d ago`;
    } else {
        return d.toLocaleDateString();
    }
}

/**
 * Format SOL amount
 */
function formatSOL(amount) {
    if (amount === null || amount === undefined) return '0.00';
    return parseFloat(amount).toFixed(2);
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Render recent wins table
 */
function renderRecentWins(wins) {
    if (!recentWinsTableBody) return;
    
    if (!wins || wins.length === 0) {
        recentWinsTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888; padding: 20px;">No recent wins yet</td></tr>';
        return;
    }
    
    recentWinsTableBody.innerHTML = wins.map((win, index) => {
        const txLink = win.txHash 
            ? `<div class="tx-link-container">
                <a href="https://solscan.io/tx/${win.txHash}" target="_blank" rel="noopener noreferrer" class="tx-link">solscan.io/tx/${win.txHash.substring(0, 8)}...</a>
                <button class="tx-copy-btn" data-tx-hash="${win.txHash}" data-index="${index}" title="Copy transaction hash">
                    <i class="fas fa-copy"></i>
                </button>
            </div>`
            : '<span style="color: #666;">Pending</span>';
        
        // Extract player count from gameMode (e.g., '2p' -> 2)
        const playerCount = win.gameMode ? parseInt(win.gameMode.replace('p', '').replace('P', '')) : 2;
        const gameModeDisplay = win.gameMode ? win.gameMode.toUpperCase() : '2P';
        
        // Get pfp URL (use provided pfpUrl or default)
        const pfpUrl = getPfpUrl({ pfpUrl: win.pfpUrl });
        const escapedUsername = escapeHtml(win.username || 'Unknown');
        
        return `
            <tr>
                <td>
                    <div class="winner-cell">
                        <img src="${pfpUrl}" alt="${escapedUsername}'s avatar" class="winner-avatar" onerror="this.src='/pfp/default.jpg'">
                        <span class="winner-username">${escapedUsername}</span>
                    </div>
                </td>
                <td><span class="win-time">${formatTime(win.time)}</span></td>
                <td class="win-mode-cell">
                    <span class="win-mode">
                        <img src="assets/site/${playerCount}p.png" alt="${playerCount} players" class="win-mode-icon">
                        <span class="win-mode-text">${gameModeDisplay}</span>
                    </span>
                </td>
                <td><span class="win-stake">${formatSOL(win.stake)} SOL</span></td>
                <td><span class="win-amount">${formatSOL(win.winAmount)} SOL</span></td>
                <td>${txLink}</td>
            </tr>
        `;
    }).join('');
    
    // Add click handlers for copy buttons
    recentWinsTableBody.querySelectorAll('.tx-copy-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const txHash = btn.getAttribute('data-tx-hash');
            if (txHash) {
                try {
                    await navigator.clipboard.writeText(txHash);
                    // Visual feedback - change icon temporarily
                    const icon = btn.querySelector('i');
                    const originalClass = icon.className;
                    icon.className = 'fas fa-check';
                    btn.style.color = '#4caf50';
                    setTimeout(() => {
                        icon.className = originalClass;
                        btn.style.color = '';
                    }, 1500);
                } catch (err) {
                    console.error('Failed to copy:', err);
                    // Fallback for older browsers
                    const textArea = document.createElement('textarea');
                    textArea.value = txHash;
                    textArea.style.position = 'fixed';
                    textArea.style.opacity = '0';
                    document.body.appendChild(textArea);
                    textArea.select();
                    try {
                        document.execCommand('copy');
                        const icon = btn.querySelector('i');
                        const originalClass = icon.className;
                        icon.className = 'fas fa-check';
                        btn.style.color = '#4caf50';
                        setTimeout(() => {
                            icon.className = originalClass;
                            btn.style.color = '';
                        }, 1500);
                    } catch (fallbackErr) {
                        console.error('Fallback copy failed:', fallbackErr);
                    }
                    document.body.removeChild(textArea);
                }
            }
        });
    });
}

/**
 * Fetch recent wins from API
 */
async function fetchRecentWins() {
    try {
        const response = await fetch('/api/recent-wins');
        if (!response.ok) {
            throw new Error('Failed to fetch recent wins');
        }
        const wins = await response.json();
        handleRecentWins(wins);
    } catch (error) {
        console.error('Error fetching recent wins:', error);
        handleRecentWinsError(error);
    }
}

/**
 * Initialize recent wins component
 */
export function initRecentWins() {
    // Request initial data
    fetchRecentWins();
    
    // Set up auto-refresh every 30 seconds
    refreshInterval = setInterval(() => {
        fetchRecentWins();
    }, 30000);
}

/**
 * Handle recent wins data
 */
export function handleRecentWins(wins) {
    renderRecentWins(wins);
}

/**
 * Handle recent wins error
 */
export function handleRecentWinsError(error) {
    if (recentWinsTableBody) {
        recentWinsTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #f44; padding: 20px;">Error loading recent wins</td></tr>';
    }
    console.error('Recent wins error:', error);
}

/**
 * Hide recent wins section
 */
export function hideRecentWins() {
    if (recentWinsContainer) {
        recentWinsContainer.style.display = 'none';
    }
}

/**
 * Show recent wins section
 */
export function showRecentWins() {
    if (recentWinsContainer) {
        recentWinsContainer.style.display = 'flex';
    }
}

/**
 * Cleanup (stop refresh interval)
 */
export function cleanupRecentWins() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}

