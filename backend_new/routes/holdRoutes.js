// Seat Hold Routes
const express = require('express');
const router  = express.Router();
const { sql, poolPromise } = require('../config/db');
const { protect } = require('../middleware/auth');

// POST /api/holds — seat hold করো (15 min)
router.post('/', protect, async (req, res) => {
    const { scheduleID, seatNumber, journeyDate } = req.body;
    const userID = req.user.userID;
    if (!scheduleID || !seatNumber || !journeyDate)
        return res.status(400).json({ message: 'scheduleID, seatNumber, journeyDate দিন।' });

    try {
        const pool = await poolPromise;

        // পুরনো expired holds clean করো
        await pool.request().query(`
            UPDATE SeatHolds SET Status='expired' 
            WHERE Status='active' AND ExpiresAt < GETDATE()
        `);

        // এই seat এ active hold আছে কিনা check করো
        const existing = await pool.request()
            .input('ScheduleID',  sql.Int,      scheduleID)
            .input('SeatNumber',  sql.NVarChar,  seatNumber)
            .input('JourneyDate', sql.Date,      journeyDate)
            .query(`
                SELECT HoldID, UserID, ExpiresAt FROM SeatHolds
                WHERE ScheduleID=@ScheduleID AND SeatNumber=@SeatNumber 
                AND JourneyDate=@JourneyDate AND Status='active'
            `);

        if (existing.recordset.length > 0) {
            const hold = existing.recordset[0];
            if (hold.UserID === userID) {
                // নিজের hold — extend করো
                await pool.request()
                    .input('HoldID', sql.Int, hold.HoldID)
                    .query(`UPDATE SeatHolds SET ExpiresAt=DATEADD(MINUTE,15,GETDATE()) WHERE HoldID=@HoldID`);
                return res.json({ message: 'Hold extended!', expiresAt: new Date(Date.now() + 15*60*1000) });
            }
            return res.status(409).json({ message: 'এই seat অন্য কেউ hold করেছে। অন্য seat বেছে নিন।' });
        }

        // Booking এ already আছে কিনা check করো
        const booked = await pool.request()
            .input('ScheduleID',  sql.Int,     scheduleID)
            .input('SeatNumber',  sql.NVarChar, seatNumber)
            .input('JourneyDate', sql.Date,     journeyDate)
            .query(`SELECT BookingID FROM Bookings WHERE ScheduleID=@ScheduleID AND SeatNumber=@SeatNumber AND JourneyDate=@JourneyDate AND Status!='cancelled'`);

        if (booked.recordset.length > 0)
            return res.status(409).json({ message: 'এই seat আগেই booked।' });

        // Hold তৈরি করো
        const result = await pool.request()
            .input('ScheduleID',  sql.Int,      scheduleID)
            .input('SeatNumber',  sql.NVarChar,  seatNumber)
            .input('JourneyDate', sql.Date,      journeyDate)
            .input('UserID',      sql.Int,       userID)
            .query(`
                INSERT INTO SeatHolds (ScheduleID, SeatNumber, JourneyDate, UserID)
                VALUES (@ScheduleID, @SeatNumber, @JourneyDate, @UserID);
                SELECT SCOPE_IDENTITY() AS HoldID, DATEADD(MINUTE,15,GETDATE()) AS ExpiresAt;
            `);

        res.status(201).json({
            message: 'Seat hold হয়েছে! ১৫ মিনিটের মধ্যে payment করুন।',
            holdID:    result.recordset[0].HoldID,
            expiresAt: result.recordset[0].ExpiresAt
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server error।' });
    }
});

// DELETE /api/holds/:holdID — hold release করো
router.delete('/:holdID', protect, async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('HoldID', sql.Int, req.params.holdID)
            .input('UserID', sql.Int, req.user.userID)
            .query(`UPDATE SeatHolds SET Status='released' WHERE HoldID=@HoldID AND UserID=@UserID`);
        res.json({ message: 'Hold release হয়েছে।' });
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

// GET /api/holds/my — আমার active holds
router.get('/my', protect, async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request().query(`UPDATE SeatHolds SET Status='expired' WHERE Status='active' AND ExpiresAt < GETDATE()`);
        const result = await pool.request()
            .input('UserID', sql.Int, req.user.userID)
            .query(`
                SELECT h.*, r.Origin, r.Destination, s.DepartureTime, v.VehicleName
                FROM SeatHolds h
                JOIN Schedules s ON s.ScheduleID = h.ScheduleID
                JOIN Routes r    ON r.RouteID    = s.RouteID
                JOIN Vehicles v  ON v.VehicleID  = s.VehicleID
                WHERE h.UserID=@UserID AND h.Status='active'
                ORDER BY h.ExpiresAt ASC
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

module.exports = router;
