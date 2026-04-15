// Waitlist Routes
const express = require('express');
const router  = express.Router();
const { sql, poolPromise } = require('../config/db');
const { protect, staffOrAdmin } = require('../middleware/auth');

// POST /api/waitlist — waitlist এ যোগ হও
router.post('/', protect, async (req, res) => {
    const { scheduleID, journeyDate } = req.body;
    const userID = req.user.userID;
    if (!scheduleID || !journeyDate)
        return res.status(400).json({ message: 'scheduleID এবং journeyDate দিন।' });

    try {
        const pool = await poolPromise;

        // Already waitlist এ আছে কিনা
        const dup = await pool.request()
            .input('ScheduleID',  sql.Int,  scheduleID)
            .input('JourneyDate', sql.Date,  journeyDate)
            .input('UserID',      sql.Int,  userID)
            .query(`SELECT WaitlistID FROM Waitlist WHERE ScheduleID=@ScheduleID AND JourneyDate=@JourneyDate AND UserID=@UserID AND Status='waiting'`);

        if (dup.recordset.length)
            return res.status(409).json({ message: 'আপনি ইতিমধ্যে এই schedule এর waitlist এ আছেন।' });

        // Position বের করো
        const pos = await pool.request()
            .input('ScheduleID',  sql.Int,  scheduleID)
            .input('JourneyDate', sql.Date,  journeyDate)
            .query(`SELECT COUNT(*)+1 AS Position FROM Waitlist WHERE ScheduleID=@ScheduleID AND JourneyDate=@JourneyDate AND Status='waiting'`);

        await pool.request()
            .input('ScheduleID',  sql.Int,  scheduleID)
            .input('JourneyDate', sql.Date,  journeyDate)
            .input('UserID',      sql.Int,  userID)
            .query(`INSERT INTO Waitlist (ScheduleID, JourneyDate, UserID) VALUES (@ScheduleID, @JourneyDate, @UserID)`);

        res.status(201).json({
            message: `Waitlist এ যোগ হয়েছেন! আপনার position: #${pos.recordset[0].Position}`,
            position: pos.recordset[0].Position
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server error।' });
    }
});

// GET /api/waitlist/my — আমার waitlist
router.get('/my', protect, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('UserID', sql.Int, req.user.userID)
            .query(`
                SELECT w.WaitlistID, w.JourneyDate, w.Status, w.AddedAt, w.NotifiedAt,
                       r.Origin, r.Destination, s.DepartureTime, s.ArrivalTime,
                       v.VehicleName, v.Type AS VehicleType,
                       (SELECT COUNT(*) FROM Waitlist w2 WHERE w2.ScheduleID=w.ScheduleID 
                        AND w2.JourneyDate=w.JourneyDate AND w2.Status='waiting' 
                        AND w2.WaitlistID <= w.WaitlistID) AS Position
                FROM Waitlist w
                JOIN Schedules s ON s.ScheduleID = w.ScheduleID
                JOIN Routes r    ON r.RouteID    = s.RouteID
                JOIN Vehicles v  ON v.VehicleID  = s.VehicleID
                WHERE w.UserID=@UserID
                ORDER BY w.AddedAt DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

// DELETE /api/waitlist/:id — waitlist থেকে বের হও
router.delete('/:id', protect, async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('WaitlistID', sql.Int, req.params.id)
            .input('UserID',     sql.Int, req.user.userID)
            .query(`UPDATE Waitlist SET Status='cancelled' WHERE WaitlistID=@WaitlistID AND UserID=@UserID`);
        res.json({ message: 'Waitlist থেকে বাদ দেওয়া হয়েছে।' });
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

// POST /api/waitlist/notify/:scheduleID — seat available হলে notify (auto trigger on cancel)
router.post('/notify/:scheduleID', protect, staffOrAdmin, async (req, res) => {
    const { journeyDate } = req.body;
    try {
        const pool = await poolPromise;
        const next = await pool.request()
            .input('ScheduleID',  sql.Int,  req.params.scheduleID)
            .input('JourneyDate', sql.Date,  journeyDate)
            .query(`
                SELECT TOP 1 w.WaitlistID, w.UserID, u.FirstName, u.Email
                FROM Waitlist w
                JOIN Users u ON u.UserID = w.UserID
                WHERE w.ScheduleID=@ScheduleID AND w.JourneyDate=@JourneyDate AND w.Status='waiting'
                ORDER BY w.AddedAt ASC
            `);

        if (!next.recordset.length)
            return res.json({ message: 'Waitlist খালি।' });

        const user = next.recordset[0];
        await pool.request()
            .input('WaitlistID', sql.Int, user.WaitlistID)
            .query(`UPDATE Waitlist SET Status='notified', NotifiedAt=GETDATE() WHERE WaitlistID=@WaitlistID`);

        res.json({
            message: `${user.FirstName} কে notify করা হয়েছে।`,
            notifiedUser: { userID: user.UserID, email: user.Email, name: user.FirstName }
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

module.exports = router;
