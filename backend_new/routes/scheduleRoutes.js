// GET /api/schedules/search?origin=Dhaka&destination=Chittagong&date=2026-02-28
// GET /api/schedules/:id/seats  — কোন seat নেওয়া আছে
// GET /api/schedules            — সব schedules (admin)
// POST /api/schedules           — নতুন schedule (admin)

const express = require('express');
const router  = express.Router();
const { sql, poolPromise } = require('../config/db');
const { protect, adminOnly } = require('../middleware/auth');

/* ── SEARCH (origin/destination + intermediate stops support) ── */
router.get('/search', async (req, res) => {
    const { origin, destination, date } = req.query;

    if (!origin || !destination)
        return res.status(400).json({ message: 'origin এবং destination দিন।' });

    try {
        const pool = await poolPromise;

        // ── 1. Direct route match ─────────────────────────────────
        const directReq = pool.request()
            .input('Origin',      sql.NVarChar, origin)
            .input('Destination', sql.NVarChar, destination);
        if (date) directReq.input('JourneyDate', sql.Date, date);

        const direct = await directReq.query(`
            SELECT
                s.ScheduleID,
                r.Origin,
                r.Destination,
                r.Origin        AS BoardingStop,
                r.Destination   AS DroppingStop,
                s.DepartureTime AS BoardingTime,
                s.ArrivalTime   AS DroppingTime,
                s.DepartureTime,
                s.ArrivalTime,
                s.JourneyDate,
                s.Fare,
                s.AvailableSeats,
                v.VehicleName,
                v.Type          AS VehicleType,
                v.Amenities,
                'direct'        AS MatchType,
                0               AS OffsetMinutes
            FROM Schedules s
            JOIN Routes   r ON r.RouteID   = s.RouteID
            JOIN Vehicles v ON v.VehicleID = s.VehicleID
            WHERE r.Origin      = @Origin
              AND r.Destination = @Destination
              AND s.Status      = 'scheduled'
              AND v.IsActive    = 1
              ${date ? 'AND s.JourneyDate = @JourneyDate' : ''}
            ORDER BY s.DepartureTime
        `);

        // ── 2. Stop-based match ───────────────────────────────────
        // যেমন: Pirganj → Dhaka → Rangpur-Dhaka route এর Pirganj stop থেকে
        const stopReq = pool.request()
            .input('BoardStop', sql.NVarChar, origin)
            .input('DropStop',  sql.NVarChar, destination);
        if (date) stopReq.input('JourneyDate', sql.Date, date);

        const stopBased = await stopReq.query(`
            SELECT
                s.ScheduleID,
                r.Origin,
                r.Destination,
                rs_board.StopName   AS BoardingStop,
                rs_drop.StopName    AS DroppingStop,
                DATEADD(MINUTE, rs_board.MinutesFromOrigin, s.DepartureTime) AS BoardingTime,
                DATEADD(MINUTE, rs_drop.MinutesFromOrigin,  s.DepartureTime) AS DroppingTime,
                s.DepartureTime,
                s.ArrivalTime,
                s.JourneyDate,
                -- Stop-to-stop fare (drop fare - board fare)
                (rs_drop.FareFromOrigin - rs_board.FareFromOrigin) AS Fare,
                s.AvailableSeats,
                v.VehicleName,
                v.Type             AS VehicleType,
                v.Amenities,
                'via_stop'         AS MatchType,
                rs_board.MinutesFromOrigin AS OffsetMinutes
            FROM Schedules s
            JOIN Routes   r        ON r.RouteID   = s.RouteID
            JOIN Vehicles v        ON v.VehicleID = s.VehicleID
            -- Boarding stop
            JOIN RouteStops rs_board ON rs_board.RouteID   = r.RouteID
                                    AND rs_board.StopName   = @BoardStop
                                    AND rs_board.IsPickupPoint = 1
            -- Dropping stop (must come AFTER boarding stop)
            JOIN RouteStops rs_drop  ON rs_drop.RouteID    = r.RouteID
                                    AND rs_drop.StopName    = @DropStop
                                    AND rs_drop.IsDropPoint = 1
                                    AND rs_drop.StopOrder   > rs_board.StopOrder
            WHERE s.Status    = 'scheduled'
              AND v.IsActive  = 1
              ${date ? 'AND s.JourneyDate = @JourneyDate' : ''}
            ORDER BY s.DepartureTime
        `).catch(() => ({ recordset: [] })); // RouteStops না থাকলে graceful fallback

        // ── Merge results (direct first, then stop-based, deduplicate) ──
        const seen    = new Set();
        const results = [];

        for (const row of [...direct.recordset, ...stopBased.recordset]) {
            const key = `${row.ScheduleID}-${row.BoardingStop}-${row.DroppingStop}`;
            if (!seen.has(key)) {
                seen.add(key);
                results.push(row);
            }
        }

        res.json({ count: results.length, schedules: results });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server error।' });
    }
});


/* ── BOOKED SEATS ── */
router.get('/:id/seats', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('ScheduleID', sql.Int, req.params.id)
            .query(`
                SELECT SeatNumber FROM Bookings
                WHERE ScheduleID = @ScheduleID AND Status != 'cancelled'
            `);

        res.json({ bookedSeats: result.recordset.map(r => r.SeatNumber) });

    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

/* ── ALL SCHEDULES (admin) ── */
router.get('/', protect, adminOnly, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT s.*, r.Origin, r.Destination, v.VehicleName, v.Type
            FROM Schedules s
            JOIN Routes r ON s.RouteID = r.RouteID
            JOIN Vehicles v ON s.VehicleID = v.VehicleID
            ORDER BY s.JourneyDate, s.DepartureTime
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

/* â”€â”€ ALL SCHEDULES (admin alias) â”€â”€ */
router.get('/admin', protect, adminOnly, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT s.*, r.Origin, r.Destination, v.VehicleName, v.Type
            FROM Schedules s
            JOIN Routes r ON s.RouteID = r.RouteID
            JOIN Vehicles v ON s.VehicleID = v.VehicleID
            ORDER BY s.JourneyDate, s.DepartureTime
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ message: 'Server errorà¥¤' });
    }
});

/* ── ADD SCHEDULE (admin) ── */
router.post('/', protect, adminOnly, async (req, res) => {
    const { routeID, vehicleID, departureTime, arrivalTime, journeyDate, fare, availableSeats } = req.body;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('RouteID',        sql.Int,           routeID)
            .input('VehicleID',      sql.Int,           vehicleID)
            .input('DepartureTime',  sql.NVarChar,      departureTime)
            .input('ArrivalTime',    sql.NVarChar,      arrivalTime)
            .input('JourneyDate',    sql.Date,          journeyDate)
            .input('Fare',           sql.Decimal(10,2), fare)
            .input('AvailableSeats', sql.Int,           availableSeats)
            .query(`
                INSERT INTO Schedules (RouteID,VehicleID,DepartureTime,ArrivalTime,JourneyDate,Fare,AvailableSeats)
                VALUES (@RouteID,@VehicleID,@DepartureTime,@ArrivalTime,@JourneyDate,@Fare,@AvailableSeats)
            `);
        res.status(201).json({ message: 'Schedule তৈরি হয়েছে।' });
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

/* â”€â”€ UPDATE SCHEDULE (admin) â”€â”€ */
router.put('/:id', protect, adminOnly, async (req, res) => {
    const { routeID, vehicleID, departureTime, arrivalTime, journeyDate, fare, availableSeats, status } = req.body;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('ScheduleID',    sql.Int,           req.params.id)
            .input('RouteID',        sql.Int,           routeID)
            .input('VehicleID',      sql.Int,           vehicleID)
            .input('DepartureTime',  sql.NVarChar,      departureTime)
            .input('ArrivalTime',    sql.NVarChar,      arrivalTime)
            .input('JourneyDate',    sql.Date,          journeyDate)
            .input('Fare',           sql.Decimal(10,2), fare)
            .input('AvailableSeats', sql.Int,           availableSeats)
            .input('Status',         sql.NVarChar,      status || 'scheduled')
            .query(`
                UPDATE Schedules
                SET RouteID=@RouteID, VehicleID=@VehicleID, DepartureTime=@DepartureTime, ArrivalTime=@ArrivalTime,
                    JourneyDate=@JourneyDate, Fare=@Fare, AvailableSeats=@AvailableSeats, Status=@Status
                WHERE ScheduleID=@ScheduleID
            `);
        if (!result.rowsAffected[0]) return res.status(404).json({ message: 'Schedule not found.' });
        res.json({ message: 'Schedule updated.' });
    } catch (err) {
        res.status(500).json({ message: 'Server errorÃ Â¥Â¤' });
    }
});

/* â”€â”€ DELETE/CANCEL SCHEDULE (admin) â”€â”€ */
router.delete('/:id', protect, adminOnly, async (req, res) => {
    try {
        const pool = await poolPromise;
        const hasBookings = await pool.request()
            .input('ScheduleID', sql.Int, req.params.id)
            .query(`SELECT COUNT(*) AS Cnt FROM Bookings WHERE ScheduleID=@ScheduleID`);

        if (hasBookings.recordset[0].Cnt > 0) {
            await pool.request()
                .input('ScheduleID', sql.Int, req.params.id)
                .query(`UPDATE Schedules SET Status='cancelled' WHERE ScheduleID=@ScheduleID`);
            return res.json({ message: 'Schedule cancelled.' });
        }

        const result = await pool.request()
            .input('ScheduleID', sql.Int, req.params.id)
            .query(`DELETE FROM Schedules WHERE ScheduleID=@ScheduleID`);
        if (!result.rowsAffected[0]) return res.status(404).json({ message: 'Schedule not found.' });
        res.json({ message: 'Schedule deleted.' });
    } catch (err) {
        res.status(500).json({ message: 'Server errorÃ Â¥Â¤' });
    }
});

module.exports = router;
