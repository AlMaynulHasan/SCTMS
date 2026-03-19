const express = require('express');
const router  = express.Router();
const { sql, poolPromise } = require('../config/db');
const { protect, staffOrAdmin } = require('../middleware/auth');
const { createNotification } = require('./notificationRoutes');

/* ── BOOK TICKET ── */
router.post('/', protect, async (req, res) => {
    const { scheduleID, seatNumber, totalFare, paymentMethod, journeyDate, boardingStop, droppingStop } = req.body;
    const userID = req.user.userID;

    if (!scheduleID || !seatNumber || !totalFare || !journeyDate)
        return res.status(400).json({ message: 'scheduleID, seatNumber, totalFare, journeyDate দিন।' });

    try {
        const pool = await poolPromise;

        // Hold আছে কিনা check — অন্য user এর hold থাকলে block
        await pool.request().query(`UPDATE SeatHolds SET Status='expired' WHERE Status='active' AND ExpiresAt < GETDATE()`);

        const holdCheck = await pool.request()
            .input('ScheduleID',  sql.Int,     scheduleID)
            .input('SeatNumber',  sql.NVarChar, seatNumber)
            .input('JourneyDate', sql.Date,     journeyDate)
            .input('UserID',      sql.Int,      userID)
            .query(`
                SELECT HoldID, UserID FROM SeatHolds
                WHERE ScheduleID=@ScheduleID AND SeatNumber=@SeatNumber 
                AND JourneyDate=@JourneyDate AND Status='active'
            `);

        if (holdCheck.recordset.length > 0 && holdCheck.recordset[0].UserID !== userID)
            return res.status(409).json({ message: 'এই seat অন্য কেউ hold করেছে।' });

        const result = await pool.request()
            .input('UserID',      sql.Int,           userID)
            .input('ScheduleID',  sql.Int,           scheduleID)
            .input('SeatNumber',  sql.NVarChar,      seatNumber)
            .input('TotalFare',   sql.Decimal(10,2), totalFare)
            .input('JourneyDate', sql.Date,          journeyDate)
            .input('Method',      sql.NVarChar,      paymentMethod || 'bkash')
            .execute('sp_BookTicket');

        const bookingID = result.recordset[0].BookingID;

        // BoardingStop / DroppingStop save (graceful fallback)
        if (boardingStop || droppingStop) {
            await pool.request()
                .input('BookingID',    sql.Int,      bookingID)
                .input('BoardingStop', sql.NVarChar,  boardingStop  || null)
                .input('DroppingStop', sql.NVarChar,  droppingStop  || null)
                .query(`UPDATE Bookings
                        SET BoardingStop = @BoardingStop,
                            DroppingStop = @DroppingStop
                        WHERE BookingID  = @BookingID`)
                .catch(() => {}); // column না থাকলেও চলবে
        }

        // ── Booking Reference Code — BK-2026-000142 ──
        const year    = new Date().getFullYear();
        const refCode = `BK-${year}-${String(bookingID).padStart(6, '0')}`;

        // Store RefCode if column exists (graceful fallback)
        try {
            await pool.request()
                .input('BookingID', sql.Int,      bookingID)
                .input('RefCode',   sql.NVarChar,  refCode)
                .query(`UPDATE Bookings SET RefCode = @RefCode WHERE BookingID = @BookingID`);
        } catch {
            // RefCode column not yet added — run migration SQL to add it
        }

        // Hold release করো
        await pool.request()
            .input('ScheduleID',  sql.Int,     scheduleID)
            .input('SeatNumber',  sql.NVarChar, seatNumber)
            .input('JourneyDate', sql.Date,     journeyDate)
            .input('UserID',      sql.Int,      userID)
            .query(`UPDATE SeatHolds SET Status='released' WHERE ScheduleID=@ScheduleID AND SeatNumber=@SeatNumber AND JourneyDate=@JourneyDate AND UserID=@UserID`);

        res.status(201).json({
            message:   'Ticket সফলভাবে book হয়েছে!',
            bookingID,
            refCode,
            reference: refCode
        });

        // Notification (async, non-blocking)
        poolPromise.then(pool => createNotification(pool, userID, 'booking_confirmed',
            `Ticket confirmed! ${refCode} — Seat ${seatNumber}`,
            { bookingID, refCode, seatNumber, scheduleID }
        ));

    } catch (err) {
        if (err.message.includes('No seats available'))
            return res.status(400).json({ message: 'কোনো seat নেই।' });
        if (err.message.includes('Seat already taken'))
            return res.status(400).json({ message: 'এই seat আগেই নেওয়া হয়েছে।' });
        console.error('Booking error:', err.message);
        res.status(500).json({ message: 'Booking fail। আবার চেষ্টা করুন।' });
    }
});

/* ── MY BOOKINGS ── */
router.get('/my', protect, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('UserID', sql.Int, req.user.userID)
            .query(`
                SELECT
                    b.BookingID, b.SeatNumber, b.TotalFare,
                    b.Status AS BookingStatus, b.BookedAt,
                    b.JourneyDate, b.RefCode, b.ScheduleID,
                    r.Origin, r.Destination,
                    v.VehicleName, v.Type AS VehicleType,
                    s.DepartureTime, s.ArrivalTime,
                    p.Method AS PaymentMethod, p.Status AS PaymentStatus
                FROM Bookings b
                JOIN Schedules s  ON b.ScheduleID = s.ScheduleID
                JOIN Routes r     ON s.RouteID    = r.RouteID
                JOIN Vehicles v   ON s.VehicleID  = v.VehicleID
                LEFT JOIN Payments p ON b.BookingID = p.BookingID
                WHERE b.UserID = @UserID
                ORDER BY b.BookedAt DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

/* ── CANCEL BOOKING ── */
router.put('/:id/cancel', protect, async (req, res) => {
    try {
        const pool = await poolPromise;
        const isPriv = ['admin','staff'].includes(req.user.role);

        // Booking info for waitlist notify
        const bkReq = pool.request().input('BookingID', sql.Int, req.params.id);
        if (!isPriv) bkReq.input('UserID', sql.Int, req.user.userID);
        const bk = await bkReq.query(`SELECT ScheduleID, JourneyDate FROM Bookings WHERE BookingID=@BookingID ${isPriv ? '' : 'AND UserID=@UserID'}`);
        if (!bk.recordset.length) return res.status(404).json({ message: 'Booking not found.' });

        if (isPriv) {
            const upd = await pool.request()
                .input('BookingID', sql.Int, req.params.id)
                .query(`UPDATE Bookings SET Status='cancelled' WHERE BookingID=@BookingID AND Status='confirmed'`);
            if (!upd.rowsAffected[0]) return res.status(400).json({ message: 'Booking already cancelled.' });
            await pool.request()
                .input('BookingID', sql.Int, req.params.id)
                .query(`UPDATE Payments SET Status='refunded' WHERE BookingID=@BookingID`);
        } else {
            await pool.request()
                .input('BookingID', sql.Int, req.params.id)
                .input('UserID',    sql.Int, req.user.userID)
                .execute('sp_CancelBooking');
        }

        // Waitlist notify
        const { ScheduleID, JourneyDate } = bk.recordset[0];
        const next = await pool.request()
            .input('ScheduleID',  sql.Int,  ScheduleID)
            .input('JourneyDate', sql.Date, JourneyDate)
            .query(`
                SELECT TOP 1 w.WaitlistID, u.FirstName, u.Email
                FROM Waitlist w JOIN Users u ON u.UserID=w.UserID
                WHERE w.ScheduleID=@ScheduleID AND w.JourneyDate=@JourneyDate AND w.Status='waiting'
                ORDER BY w.AddedAt ASC
            `);

        if (next.recordset.length > 0) {
            await pool.request()
                .input('WaitlistID', sql.Int, next.recordset[0].WaitlistID)
                .query(`UPDATE Waitlist SET Status='notified', NotifiedAt=GETDATE() WHERE WaitlistID=@WaitlistID`);
            console.log(`📢 Waitlist notified: ${next.recordset[0].Email}`);
        }

        res.json({ message: 'Booking cancel হয়েছে।' });

        // Notifications (async)
        createNotification(pool, req.user.userID, 'booking_cancelled',
            `Booking #${req.params.id} cancel হয়েছে। Refund process হচ্ছে।`,
            { bookingID: parseInt(req.params.id) }
        );
        // Waitlist user কে notification
        if (next.recordset.length > 0) {
            const wlUser = next.recordset[0];
            const userRes = await pool.request()
                .input('Email', sql.NVarChar, wlUser.Email)
                .query('SELECT UserID FROM Users WHERE Email=@Email').catch(()=>({recordset:[]}));
            if (userRes.recordset.length) {
                createNotification(pool, userRes.recordset[0].UserID, 'waitlist_notified',
                    `Seat available! আপনি waitlist এ ছিলেন — এখন book করুন।`,
                    { scheduleID: ScheduleID, journeyDate: JourneyDate }
                );
            }
        }
    } catch (err) {
        if (err.message.includes('not found'))
            return res.status(404).json({ message: 'Booking পাওয়া যায়নি।' });
        res.status(500).json({ message: 'Server error।' });
    }
});
/* ── ALL BOOKINGS (admin/staff) ── */
router.get('/', protect, staffOrAdmin, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .query('SELECT TOP 100 * FROM vw_BookingReport ORDER BY BookedAt DESC');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

/* ── SINGLE BOOKING ── */
router.get('/:id', protect, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('BookingID', sql.Int, req.params.id)
            .input('UserID',    sql.Int, req.user.userID)
            .query(`
                SELECT * FROM vw_BookingReport
                WHERE BookingID = @BookingID
                  AND (Email = (SELECT Email FROM Users WHERE UserID = @UserID)
                       OR (SELECT Role FROM Users WHERE UserID = @UserID) IN ('admin','staff'))
            `);

        if (result.recordset.length === 0)
            return res.status(404).json({ message: 'Booking পাওয়া যায়নি।' });

        res.json(result.recordset[0]);
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

router.post('/:id/review', protect, async (req, res) => {
    const bookingID = parseInt(req.params.id);
    const { rating, tags, comment } = req.body;
    const userID = req.user.userID;
 
    if (!rating || rating < 1 || rating > 5)
        return res.status(400).json({ message: 'Rating 1–5 এর মধ্যে হতে হবে।' });
 
    try {
        const pool = await poolPromise;
 
        // Verify booking belongs to user and is confirmed
        const bk = await pool.request()
            .input('BookingID', sql.Int, bookingID)
            .input('UserID',    sql.Int, userID)
            .query(`SELECT BookingID, JourneyDate, Status FROM Bookings
                    WHERE BookingID=@BookingID AND UserID=@UserID`);
 
        if (!bk.recordset.length)
            return res.status(404).json({ message: 'Booking পাওয়া যায়নি।' });
 
        const booking = bk.recordset[0];
        if (booking.Status !== 'confirmed')
            return res.status(400).json({ message: 'শুধু completed journey তে review দেওয়া যাবে।' });
 
        // Journey must be in the past
        if (new Date(booking.JourneyDate) > new Date())
            return res.status(400).json({ message: 'Journey এখনো হয়নি।' });
 
        // Check if already reviewed
        const existing = await pool.request()
            .input('BookingID', sql.Int, bookingID)
            .query(`SELECT ReviewID FROM BookingReviews WHERE BookingID=@BookingID`);
        if (existing.recordset.length)
            return res.status(409).json({ message: 'এই booking এ আগেই review দেওয়া হয়েছে।' });
 
        // Insert review
        await pool.request()
            .input('BookingID', sql.Int,      bookingID)
            .input('UserID',    sql.Int,       userID)
            .input('Rating',    sql.Int,        rating)
            .input('Tags',      sql.NVarChar,  (tags||[]).join(','))
            .input('Comment',   sql.NVarChar,  comment || null)
            .query(`INSERT INTO BookingReviews (BookingID, UserID, Rating, Tags, Comment)
                    VALUES (@BookingID, @UserID, @Rating, @Tags, @Comment)`);
 
        // Update booking with rating (optional denormalization)
        await pool.request()
            .input('BookingID', sql.Int, bookingID)
            .input('Rating',    sql.Int, rating)
            .query(`UPDATE Bookings SET Rating=@Rating WHERE BookingID=@BookingID`).catch(()=>{});
        // ^ .catch() because Rating column may not exist — add it: ALTER TABLE Bookings ADD Rating INT NULL
 
        res.json({ message: 'Review submit হয়েছে। ধন্যবাদ!' });
    } catch (err) {
        console.error('review error:', err.message);
        res.status(500).json({ message: 'Server error।' });
    }
});
 
// GET /api/bookings/:id/mark-used  (for QR verification)
router.put('/:id/mark-used', protect, async (req, res) => {
    if (!['admin','staff'].includes(req.user.role))
        return res.status(403).json({ message: 'Staff only.' });
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('BookingID', sql.Int, parseInt(req.params.id))
            .query(`UPDATE Bookings SET IsUsed=1, UsedAt=GETDATE() WHERE BookingID=@BookingID`);
        res.json({ message: 'Marked as used.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error.' });
    }
});

module.exports = router;

