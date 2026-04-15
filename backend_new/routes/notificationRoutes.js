// =============================================
// SCTMS — Notification Routes
// Events: booking_confirmed, booking_cancelled,
//         transfer_completed, waitlist_notified,
//         trip_status_changed
// =============================================

const express = require('express');
const router  = express.Router();
const { sql, poolPromise } = require('../config/db');
const { protect, staffOrAdmin } = require('../middleware/auth');

// ─────────────────────────────────────────────
// HELPER — notification তৈরি করো (other routes থেকে import করে use করা যাবে)
// ─────────────────────────────────────────────
async function createNotification(pool, userID, type, message, meta = {}) {
    try {
        await pool.request()
            .input('UserID',  sql.Int,      userID)
            .input('Type',    sql.NVarChar,  type)
            .input('Message', sql.NVarChar,  message)
            .input('Meta',    sql.NVarChar,  JSON.stringify(meta))
            .query(`
                INSERT INTO Notifications (UserID, Type, Message, Meta)
                VALUES (@UserID, @Type, @Message, @Meta)
            `);
    } catch (err) {
        // Notifications table না থাকলেও app চলবে
        console.warn('[Notification] Insert failed (table may not exist yet):', err.message);
    }
}

// ─────────────────────────────────────────────
// GET /api/notifications/my  — আমার notifications
// ─────────────────────────────────────────────
router.get('/my', protect, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('UserID', sql.Int, req.user.userID)
            .query(`
                SELECT TOP 30
                    NotificationID, Type, Message, IsRead, CreatedAt,
                    Meta
                FROM Notifications
                WHERE UserID = @UserID
                ORDER BY CreatedAt DESC
            `);

        const notifications = result.recordset.map(n => ({
            ...n,
            Meta: n.Meta ? JSON.parse(n.Meta) : {}
        }));

        const unreadCount = notifications.filter(n => !n.IsRead).length;

        res.json({ notifications, unreadCount });
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

// ─────────────────────────────────────────────
// PUT /api/notifications/read-all  — সব পড়া হয়েছে mark করো
// ─────────────────────────────────────────────
router.put('/read-all', protect, async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('UserID', sql.Int, req.user.userID)
            .query(`UPDATE Notifications SET IsRead = 1 WHERE UserID = @UserID AND IsRead = 0`);
        res.json({ message: 'সব notification পড়া হয়েছে।' });
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

// ─────────────────────────────────────────────
// PUT /api/notifications/:id/read  — একটা পড়া হয়েছে
// ─────────────────────────────────────────────
router.put('/:id/read', protect, async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('NotificationID', sql.Int, req.params.id)
            .input('UserID',         sql.Int, req.user.userID)
            .query(`UPDATE Notifications SET IsRead = 1 WHERE NotificationID = @NotificationID AND UserID = @UserID`);
        res.json({ message: 'Notification read।' });
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

// ─────────────────────────────────────────────
// DELETE /api/notifications/clear  — সব delete করো
// ─────────────────────────────────────────────
router.delete('/clear', protect, async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('UserID', sql.Int, req.user.userID)
            .query(`DELETE FROM Notifications WHERE UserID = @UserID`);
        res.json({ message: 'সব notification মুছে গেছে।' });
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

// ─────────────────────────────────────────────
// GET /api/notifications/admin  — admin: সব recent notifications
// ─────────────────────────────────────────────
router.get('/admin', protect, staffOrAdmin, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT TOP 50
                n.NotificationID, n.Type, n.Message, n.IsRead, n.CreatedAt,
                u.FirstName + ' ' + u.LastName AS UserName, u.Email
            FROM Notifications n
            JOIN Users u ON u.UserID = n.UserID
            ORDER BY n.CreatedAt DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

module.exports = { router, createNotification };
