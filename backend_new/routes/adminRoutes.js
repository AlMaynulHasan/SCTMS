// GET /api/admin/stats   — dashboard stats
// GET /api/admin/users   — সব users
// PUT /api/admin/users/:id/toggle — activate/deactivate

const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const { sql, poolPromise } = require('../config/db');
const { protect, adminOnly } = require('../middleware/auth');

/* ── DASHBOARD STATS ── */
router.get('/stats', protect, adminOnly, async (req, res) => {
    try {
        const pool = await poolPromise;

        // Core stats — always available
        const stats = await pool.request().query(`
            SELECT
                (SELECT COUNT(*) FROM Users WHERE Role = 'passenger' AND IsActive = 1) AS TotalPassengers,
                (SELECT COUNT(*) FROM Bookings WHERE CAST(BookedAt AS DATE) = CAST(GETDATE() AS DATE)) AS TodayBookings,
                (SELECT COUNT(*) FROM Routes WHERE IsActive = 1) AS ActiveRoutes,
                (SELECT COUNT(*) FROM Bookings WHERE Status = 'cancelled' AND CAST(BookedAt AS DATE) = CAST(GETDATE() AS DATE)) AS TodayCancellations
        `);

        const result = stats.recordset[0];

        // TodayRevenue — Payments table (may or may not exist)
        try {
            const rev = await pool.request().query(`
                SELECT ISNULL(SUM(Amount), 0) AS TodayRevenue
                FROM Payments
                WHERE CAST(PaidAt AS DATE) = CAST(GETDATE() AS DATE)
                  AND Status = 'paid'
            `);
            result.TodayRevenue = rev.recordset[0].TodayRevenue;
        } catch {
            // Fallback: sum from confirmed bookings today
            try {
                const rev2 = await pool.request().query(`
                    SELECT ISNULL(SUM(TotalFare), 0) AS TodayRevenue
                    FROM Bookings
                    WHERE Status = 'confirmed'
                      AND CAST(BookedAt AS DATE) = CAST(GETDATE() AS DATE)
                `);
                result.TodayRevenue = rev2.recordset[0].TodayRevenue;
            } catch { result.TodayRevenue = 0; }
        }

        // PendingExchanges — TicketListings (new system)
        try {
            const pend = await pool.request().query(`
                SELECT COUNT(*) AS PendingExchanges
                FROM TicketListings
                WHERE Status = 'open'
            `);
            result.PendingExchanges = pend.recordset[0].PendingExchanges;
        } catch { result.PendingExchanges = 0; }

        res.json(result);

    } catch (err) {
        console.error('Stats error:', err.message);
        res.status(500).json({ message: 'Server error।' });
    }
});

/* ── ALL USERS ── */
router.get('/users', protect, adminOnly, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT UserID, FirstName, LastName, Email, Phone, Role, District, CreatedAt, IsActive
            FROM Users ORDER BY CreatedAt DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});


/* -- CREATE STAFF/ADMIN USER -- */
router.post('/users', protect, adminOnly, async (req, res) => {
    const { firstName, lastName, email, phone, role, password } = req.body || {};
    if (!firstName || !lastName || !email)
        return res.status(400).json({ message: 'First name, last name, and email required.' });
    if (!['staff','admin'].includes(role))
        return res.status(400).json({ message: 'Role must be staff or admin.' });
    try {
        const pool = await poolPromise;
        const exists = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query('SELECT UserID FROM Users WHERE Email=@Email');
        if (exists.recordset.length) return res.status(409).json({ message: 'Email already exists.' });

        const tempPass = password && password.length >= 8
            ? null
            : Math.random().toString(36).slice(-8) + 'A1!';
        const finalPass = password && password.length >= 8 ? password : tempPass;
        const hash = await bcrypt.hash(finalPass, 10);

        await pool.request()
            .input('FirstName', sql.NVarChar, firstName)
            .input('LastName',  sql.NVarChar, lastName)
            .input('Email',     sql.NVarChar, email)
            .input('Phone',     sql.NVarChar, phone || null)
            .input('Password',  sql.NVarChar, hash)
            .input('Role',      sql.NVarChar, role)
            .query(`
                INSERT INTO Users (FirstName, LastName, Email, Phone, Password, Role)
                VALUES (@FirstName,@LastName,@Email,@Phone,@Password,@Role)
            `);
        res.status(201).json({ message: 'User created.', tempPassword: tempPass || undefined });
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});
/* ── TOGGLE USER ACTIVE/INACTIVE ── */
router.put('/users/:id/toggle', protect, adminOnly, async (req, res) => {
    const { field, value } = req.body || {};
    try {
        const pool = await poolPromise;

        if (field === 'role') {
            if (!['passenger','staff','admin'].includes(value))
                return res.status(400).json({ message: 'Invalid role.' });
            await pool.request()
                .input('UserID', sql.Int, req.params.id)
                .input('Role', sql.NVarChar, value)
                .query(`UPDATE Users SET Role=@Role WHERE UserID=@UserID`);
            return res.json({ message: 'Role updated.' });
        }

        if (field === 'status') {
            const s = String(value || '').toLowerCase();
            const isActive = (s === 'active' || s === '1' || s === 'true');
            await pool.request()
                .input('UserID', sql.Int, req.params.id)
                .input('IsActive', sql.Bit, isActive ? 1 : 0)
                .query(`UPDATE Users SET IsActive=@IsActive WHERE UserID=@UserID`);
            return res.json({ message: 'Status updated.' });
        }

        await pool.request()
            .input('UserID', sql.Int, req.params.id)
            .query(`
                UPDATE Users
                SET IsActive = CASE WHEN IsActive = 1 THEN 0 ELSE 1 END
                WHERE UserID = @UserID
            `);
        res.json({ message: 'User status update হয়েছে।' });
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});
module.exports = router;



