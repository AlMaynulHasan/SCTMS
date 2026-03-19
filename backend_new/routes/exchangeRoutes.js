// POST /api/exchange        — exchange request পাঠাও
// GET  /api/exchange/my     — আমার exchange requests
// GET  /api/exchange        — সব requests (admin)
// PUT  /api/exchange/:id    — approve/reject (admin)

const express = require('express');
const router  = express.Router();
const { sql, poolPromise } = require('../config/db');
const { protect, adminOnly } = require('../middleware/auth');

/* ── REQUEST EXCHANGE ── */
router.post('/', protect, async (req, res) => {
    const { receiverID, bookingIDFrom, bookingIDTo } = req.body;
    const requesterID = req.user.userID;

    if (!receiverID || !bookingIDFrom || !bookingIDTo)
        return res.status(400).json({ message: 'সব field দিন।' });

    try {
        const pool = await poolPromise;

        // দুটো booking confirmed কিনা + একই schedule কিনা check
        const check = await pool.request()
            .input('B1', sql.Int, bookingIDFrom)
            .input('B2', sql.Int, bookingIDTo)
            .query(`
                SELECT b1.ScheduleID AS S1, b2.ScheduleID AS S2
                FROM Bookings b1, Bookings b2
                WHERE b1.BookingID = @B1 AND b2.BookingID = @B2
                  AND b1.Status = 'confirmed' AND b2.Status = 'confirmed'
            `);

        if (check.recordset.length === 0)
            return res.status(400).json({ message: 'Booking valid নয়।' });

        if (check.recordset[0].S1 !== check.recordset[0].S2)
            return res.status(400).json({ message: 'দুটো ticket একই schedule এ হতে হবে।' });

        // আগে কোনো pending request আছে কিনা
        const pending = await pool.request()
            .input('B1', sql.Int, bookingIDFrom)
            .input('B2', sql.Int, bookingIDTo)
            .query(`
                SELECT ExchangeID FROM TicketExchange
                WHERE (BookingID_From = @B1 OR BookingID_To = @B2) AND Status = 'pending'
            `);

        if (pending.recordset.length > 0)
            return res.status(400).json({ message: 'ইতিমধ্যে একটা pending request আছে।' });

        await pool.request()
            .input('RequesterID',   sql.Int, requesterID)
            .input('ReceiverID',    sql.Int, receiverID)
            .input('BookingIDFrom', sql.Int, bookingIDFrom)
            .input('BookingIDTo',   sql.Int, bookingIDTo)
            .query(`
                INSERT INTO TicketExchange (RequesterID, ReceiverID, BookingID_From, BookingID_To)
                VALUES (@RequesterID, @ReceiverID, @BookingIDFrom, @BookingIDTo)
            `);

        res.status(201).json({ message: 'Exchange request পাঠানো হয়েছে। Admin approve করবে।' });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server error।' });
    }
});

/* ── MY EXCHANGES ── */
router.get('/my', protect, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('UserID', sql.Int, req.user.userID)
            .query(`
                SELECT
                    te.ExchangeID, te.Status, te.RequestedAt, te.ResolvedAt, te.AdminNote,
                    u1.FirstName+' '+u1.LastName AS RequesterName,
                    u2.FirstName+' '+u2.LastName AS ReceiverName,
                    b1.SeatNumber AS FromSeat, b2.SeatNumber AS ToSeat,
                    r.Origin, r.Destination, s.JourneyDate
                FROM TicketExchange te
                JOIN Users u1    ON te.RequesterID   = u1.UserID
                JOIN Users u2    ON te.ReceiverID    = u2.UserID
                JOIN Bookings b1 ON te.BookingID_From = b1.BookingID
                JOIN Bookings b2 ON te.BookingID_To   = b2.BookingID
                JOIN Schedules s ON b1.ScheduleID    = s.ScheduleID
                JOIN Routes r    ON s.RouteID         = r.RouteID
                WHERE te.RequesterID = @UserID OR te.ReceiverID = @UserID
                ORDER BY te.RequestedAt DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

/* ── ALL EXCHANGES (admin) ── */
router.get('/', protect, adminOnly, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT
                te.ExchangeID, te.Status, te.RequestedAt, te.AdminNote,
                u1.FirstName+' '+u1.LastName AS RequesterName, u1.Email AS RequesterEmail,
                u2.FirstName+' '+u2.LastName AS ReceiverName,  u2.Email AS ReceiverEmail,
                b1.SeatNumber AS FromSeat, b2.SeatNumber AS ToSeat,
                r.Origin, r.Destination, s.JourneyDate
            FROM TicketExchange te
            JOIN Users u1    ON te.RequesterID   = u1.UserID
            JOIN Users u2    ON te.ReceiverID    = u2.UserID
            JOIN Bookings b1 ON te.BookingID_From = b1.BookingID
            JOIN Bookings b2 ON te.BookingID_To   = b2.BookingID
            JOIN Schedules s ON b1.ScheduleID    = s.ScheduleID
            JOIN Routes r    ON s.RouteID         = r.RouteID
            ORDER BY te.RequestedAt DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

/* ── APPROVE / REJECT (admin) ── */
router.put('/:id', protect, adminOnly, async (req, res) => {
    const { action, adminNote } = req.body;

    if (!['approved', 'rejected'].includes(action))
        return res.status(400).json({ message: 'action হবে "approved" বা "rejected"।' });

    try {
        const pool = await poolPromise;

        const exchange = await pool.request()
            .input('ExchangeID', sql.Int, req.params.id)
            .query("SELECT * FROM TicketExchange WHERE ExchangeID = @ExchangeID AND Status = 'pending'");

        if (exchange.recordset.length === 0)
            return res.status(404).json({ message: 'Request পাওয়া যায়নি বা আগেই resolved।' });

        const ex = exchange.recordset[0];

        if (action === 'approved') {
            // দুটো seat swap করো
            await pool.request()
                .input('B1', sql.Int, ex.BookingID_From)
                .input('B2', sql.Int, ex.BookingID_To)
                .query(`
                    DECLARE @s1 NVARCHAR(10), @s2 NVARCHAR(10);
                    SELECT @s1 = SeatNumber FROM Bookings WHERE BookingID = @B1;
                    SELECT @s2 = SeatNumber FROM Bookings WHERE BookingID = @B2;
                    UPDATE Bookings SET SeatNumber = @s2, Status = 'exchanged'  WHERE BookingID = @B1;
                    UPDATE Bookings SET SeatNumber = @s1, Status = 'confirmed' WHERE BookingID = @B2;
                `);
        }

        await pool.request()
            .input('ExchangeID', sql.Int,     req.params.id)
            .input('Status',     sql.NVarChar, action)
            .input('AdminNote',  sql.NVarChar, adminNote || null)
            .query(`
                UPDATE TicketExchange
                SET Status = @Status, AdminNote = @AdminNote, ResolvedAt = GETDATE()
                WHERE ExchangeID = @ExchangeID
            `);

        res.json({ message: `Exchange ${action} হয়েছে।` });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server error।' });
    }
});

module.exports = router;
