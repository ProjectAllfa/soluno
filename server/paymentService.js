import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';

dotenv.config();

// Solana connection - using mainnet with Helius RPC
// RPC URL must be provided via SOLANA_RPC_URL environment variable
if (!process.env.SOLANA_RPC_URL) {
    console.error('❌ SOLANA_RPC_URL environment variable is required');
    throw new Error('SOLANA_RPC_URL environment variable is required');
}

const connection = new Connection(
    process.env.SOLANA_RPC_URL,
    {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000
    }
);

// Get wallets from environment variables
const ESCROW_WALLET = process.env.ESCROW_WALLET;
const FEE_WALLET = process.env.FEE_WALLET;
const ESCROW_SECRET = process.env.ESCROW_SECRET;
const FEE_SECRET = process.env.FEE_SECRET;

// Parse secret keys
let escrowKeypair = null;
let feeKeypair = null;

try {
    if (ESCROW_SECRET) {
        const escrowSecretArray = JSON.parse(ESCROW_SECRET);
        escrowKeypair = Keypair.fromSecretKey(new Uint8Array(escrowSecretArray));
    }
} catch (error) {
    try {
        // Try as base58 string
        escrowKeypair = Keypair.fromSecretKey(bs58.decode(ESCROW_SECRET));
    } catch (e) {
        console.error('Error parsing ESCROW_SECRET:', e);
    }
}

try {
    if (FEE_SECRET) {
        const feeSecretArray = JSON.parse(FEE_SECRET);
        feeKeypair = Keypair.fromSecretKey(new Uint8Array(feeSecretArray));
    }
} catch (error) {
    try {
        // Try as base58 string
        feeKeypair = Keypair.fromSecretKey(bs58.decode(FEE_SECRET));
    } catch (e) {
        console.error('Error parsing FEE_SECRET:', e);
    }
}

// Validate configuration after keypairs are initialized
if (!ESCROW_WALLET || !FEE_WALLET || !ESCROW_SECRET || !FEE_SECRET) {
    console.error('❌ Missing required environment variables for payment service');
    console.error('Required: ESCROW_WALLET, FEE_WALLET, ESCROW_SECRET, FEE_SECRET');
} else {
    console.log('✅ Payment service environment variables loaded');
    if (escrowKeypair) {
        console.log(`✅ Escrow wallet configured: ${escrowKeypair.publicKey.toString()}`);
    } else {
        console.error('❌ Failed to parse escrow keypair');
    }
    if (feeKeypair) {
        console.log(`✅ Fee wallet configured: ${feeKeypair.publicKey.toString()}`);
    } else {
        console.error('❌ Failed to parse fee keypair');
    }
}

/**
 * Convert SOL amount to lamports
 */
function solToLamports(sol) {
    return Math.floor(sol * LAMPORTS_PER_SOL);
}

/**
 * Convert lamports to SOL
 */
function lamportsToSol(lamports) {
    return lamports / LAMPORTS_PER_SOL;
}

/**
 * Get escrow wallet address for payment
 * Client will create and sign the transaction
 * @returns {Object} Escrow wallet info
 */
export async function getEscrowWallet() {
    try {
        if (!escrowKeypair) {
            throw new Error('Escrow wallet not configured');
        }

        return {
            success: true,
            escrowWallet: escrowKeypair.publicKey.toString()
        };
    } catch (error) {
        console.error('Error getting escrow wallet:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Verify payment transaction signature
 * @param {string} signature - Transaction signature
 * @param {string} userWallet - User's wallet public key
 * @param {number} solAmount - Expected amount in SOL
 * @returns {Object} Result
 */
export async function verifyPayment(signature, userWallet, solAmount) {
    try {
        if (!escrowKeypair) {
            throw new Error('Escrow wallet not configured');
        }

        const userPublicKey = new PublicKey(userWallet);
        const escrowPublicKey = escrowKeypair.publicKey;

        // Wait for transaction confirmation
        await connection.confirmTransaction(signature, 'confirmed');

        // Verify transaction
        const transaction = await connection.getTransaction(signature, {
            commitment: 'confirmed'
        });

        if (!transaction) {
            return { success: false, error: 'Transaction not found' };
        }

        // Check if transaction was successful
        if (transaction.meta?.err) {
            return { success: false, error: 'Transaction failed', details: transaction.meta.err };
        }

        // Verify accounts involved
        const accountKeys = transaction.transaction.message.accountKeys;
        const userIndex = accountKeys.findIndex(key => key.equals(userPublicKey));
        const escrowIndex = accountKeys.findIndex(key => key.equals(escrowPublicKey));

        if (userIndex === -1 || escrowIndex === -1) {
            return { success: false, error: 'Transaction does not involve required accounts' };
        }

        // Verify amount transferred
        const preBalances = transaction.meta.preBalances;
        const postBalances = transaction.meta.postBalances;

        const amountTransferred = preBalances[userIndex] - postBalances[userIndex];
        const escrowReceived = postBalances[escrowIndex] - preBalances[escrowIndex];

        const expectedAmount = solToLamports(solAmount);

        // Check if escrow received the expected amount (accounting for transaction fees)
        if (escrowReceived < expectedAmount) {
            return { success: false, error: `Insufficient payment amount. Expected ${solAmount} SOL, received ${lamportsToSol(escrowReceived)} SOL` };
        }

        return {
            success: true,
            signature: signature,
            amount: lamportsToSol(escrowReceived)
        };
    } catch (error) {
        console.error('Error verifying payment:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Refund payment from escrow to user
 * @param {string} userWallet - User's wallet public key
 * @param {number} solAmount - Amount in SOL to refund
 * @returns {Object} Result with transaction signature
 */
export async function refundPayment(userWallet, solAmount) {
    try {
        if (!escrowKeypair) {
            throw new Error('Escrow wallet not configured');
        }

        const userPublicKey = new PublicKey(userWallet);
        const escrowPublicKey = escrowKeypair.publicKey;

        // Create refund transaction
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: escrowPublicKey,
                toPubkey: userPublicKey,
                lamports: solToLamports(solAmount),
            })
        );

        // Get recent blockhash
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = escrowPublicKey;

        // Sign and send transaction
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [escrowKeypair],
            { commitment: 'confirmed' }
        );

        return {
            success: true,
            signature: signature,
            amount: solAmount
        };
    } catch (error) {
        console.error('Error refunding payment:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Distribute winnings to winner (minus 2% fee to fee wallet)
 * @param {string} winnerWallet - Winner's wallet public key
 * @param {number} totalStake - Total stake amount in SOL
 * @returns {Object} Result with transaction signatures
 */
export async function distributeWinnings(winnerWallet, totalStake) {
    try {
        console.log(`[distributeWinnings] Starting distribution for winner: ${winnerWallet}, totalStake: ${totalStake} SOL`);
        
        if (!escrowKeypair || !feeKeypair) {
            const error = 'Escrow or fee wallet not configured';
            console.error(`[distributeWinnings] ${error}`);
            throw new Error(error);
        }

        const winnerPublicKey = new PublicKey(winnerWallet);
        const escrowPublicKey = escrowKeypair.publicKey;
        const feePublicKey = feeKeypair.publicKey;

        // Check escrow wallet balance first
        const escrowBalance = await connection.getBalance(escrowPublicKey);
        const escrowBalanceSol = lamportsToSol(escrowBalance);
        console.log(`[distributeWinnings] Escrow wallet balance: ${escrowBalanceSol} SOL (${escrowPublicKey.toString()})`);

        // Calculate amounts
        const feeAmount = totalStake * 0.02; // 2% fee
        const winnerAmount = totalStake - feeAmount;
        
        // Solana rent exemption minimum is approximately 0.00089 SOL
        // We need to leave enough in escrow for rent exemption + transaction fees
        const RENT_EXEMPTION_MINIMUM = 0.00089; // Minimum balance to keep account alive
        const TRANSACTION_FEE_ESTIMATE = 0.00001; // Estimated transaction fee
        const MINIMUM_BALANCE = RENT_EXEMPTION_MINIMUM + TRANSACTION_FEE_ESTIMATE;
        
        // Required balance: total stake + minimum balance to keep account alive
        const requiredBalance = totalStake + MINIMUM_BALANCE;
        
        console.log(`[distributeWinnings] Required balance: ${requiredBalance} SOL`);
        console.log(`[distributeWinnings] Fee amount: ${feeAmount} SOL`);
        console.log(`[distributeWinnings] Winner amount: ${winnerAmount} SOL`);
        console.log(`[distributeWinnings] Minimum balance to maintain: ${MINIMUM_BALANCE} SOL`);

        if (escrowBalanceSol < requiredBalance) {
            const error = `Insufficient escrow balance. Required: ${requiredBalance} SOL (including ${MINIMUM_BALANCE} SOL for rent exemption), Available: ${escrowBalanceSol} SOL`;
            console.error(`[distributeWinnings] ${error}`);
            throw new Error(error);
        }

        const transactions = [];

        // Combine both transfers into a single transaction to save on fees and avoid rent issues
        console.log(`[distributeWinnings] Creating combined transaction for fee and winnings...`);
        try {
            const combinedTransaction = new Transaction();
            
            // Add fee transfer
            if (feeAmount > 0) {
                combinedTransaction.add(
                    SystemProgram.transfer({
                        fromPubkey: escrowPublicKey,
                        toPubkey: feePublicKey,
                        lamports: solToLamports(feeAmount),
                    })
                );
                console.log(`[distributeWinnings] Added fee transfer: ${feeAmount} SOL to ${feePublicKey.toString()}`);
            }
            
            // Add winner transfer
            if (winnerAmount > 0) {
                combinedTransaction.add(
                    SystemProgram.transfer({
                        fromPubkey: escrowPublicKey,
                        toPubkey: winnerPublicKey,
                        lamports: solToLamports(winnerAmount),
                    })
                );
                console.log(`[distributeWinnings] Added winner transfer: ${winnerAmount} SOL to ${winnerPublicKey.toString()}`);
            }

            // Get recent blockhash and set fee payer
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
            combinedTransaction.recentBlockhash = blockhash;
            combinedTransaction.feePayer = escrowPublicKey;

            console.log(`[distributeWinnings] Combined transaction prepared, sending...`);
            const signature = await sendAndConfirmTransaction(
                connection,
                combinedTransaction,
                [escrowKeypair],
                { 
                    commitment: 'confirmed',
                    skipPreflight: false
                }
            );

            console.log(`[distributeWinnings] Combined transaction confirmed: ${signature}`);
            
            // Add both transactions to the result (same signature for both)
            if (feeAmount > 0) {
                transactions.push({
                    type: 'fee',
                    signature: signature,
                    amount: feeAmount,
                    to: feePublicKey.toString()
                });
            }
            
            if (winnerAmount > 0) {
                transactions.push({
                    type: 'winnings',
                    signature: signature,
                    amount: winnerAmount,
                    to: winnerPublicKey.toString()
                });
            }
        } catch (error) {
            console.error(`[distributeWinnings] Error sending combined transaction:`, error);
            throw new Error(`Failed to send distribution transaction: ${error.message}`);
        }

        console.log(`[distributeWinnings] Distribution completed successfully. Transactions:`, transactions);
        return {
            success: true,
            transactions: transactions,
            totalStake: totalStake,
            feeAmount: feeAmount,
            winnerAmount: winnerAmount
        };
    } catch (error) {
        console.error('[distributeWinnings] Error distributing winnings:', error);
        console.error('[distributeWinnings] Error stack:', error.stack);
        return {
            success: false,
            error: error.message || 'Unknown error occurred'
        };
    }
}

/**
 * Get wallet balance
 * @param {string} walletAddress - Wallet public key
 * @returns {number} Balance in SOL
 */
export async function getWalletBalance(walletAddress) {
    try {
        const publicKey = new PublicKey(walletAddress);
        const balance = await connection.getBalance(publicKey);
        return lamportsToSol(balance);
    } catch (error) {
        console.error('Error getting wallet balance:', error);
        return 0;
    }
}

