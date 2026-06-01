// =============================================
// SCTMS — Transfer Routes v2
// Features:
//   ✅ Ticket Lock       — listing হলে Booking.Status = 'listed'
//   ✅ Platform Fee 5%   — seller gets 95% of AskingPrice
//   ✅ Smart Price       — departure কাছে হলে suggested price কমে
//   ✅ Waitlist Notify   — listing হলে waitlist passengers notify হয়
// =============================================

const express = require('express');
const router  = express.Router();
const { sql, poolPromise } = require('../config/db');
const { protect } = require('../middleware/auth');
const { createNotification } = require('./notificationRoutes');

const PLATFORM_FEE_PCT = 0.05;

function getAffectedRows(result) {
    if (!result || !Array.isArray(result.rowsAffected)) return 0;
    return result.rowsAffected.reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0);
}

/** departure datetime দেখে suggested resale price বের করে */
function suggestedPrice(originalFare, departureDatetime) {
    if (!departureDatetime) return originalFare;
    const hoursLeft = (new Date(departureDatetime) - new Date()) / 3600000;
    let pct;
    if      (hoursLeft >= 24) pct = 1.00;
    else if (hoursLeft >= 12) pct = 0.80;
    else if (hoursLeft >=  6) pct = 0.60;
    else if (hoursLeft >=  3) pct = 0.40;
    else if (hoursLeft >=  1) pct = 0.25;
    else                      pct = 0.10;
    return Math.max(1, Math.round(originalFare * pct));
}

/**
 * ✅ FIX: JourneyDate (date) + DepartureTime (SQL time type) combine করে
 * একটা proper DateTime বানায়।
 * SQL Server-এর time column Node.js-এ 1900-01-01T HH:MM আকারে আসে,
 * তাই সরাসরি new Date(DepartureTime) করলে past date হয়ে hoursLeft = 0 হয়।
 */
function buildDepartureDateTime(journeyDate, departureTime) {
    if (!journeyDate) return null;

    // JourneyDate থেকে "YYYY-MM-DD" বের করো
    const dateStr = new Date(journeyDate).toISOString().split('T')[0];

    if (departureTime) {
        // SQL time type হিসেবে আসলে Date object হবে, time part নাও
        // e.g. 1900-01-01T06:30:00.000Z → "06:30"
        let timeStr;
        if (departureTime instanceof Date) {
            timeStr = departureTime.toISOString().split('T')[1].substring(0, 5);
        } else {
            timeStr = String(departureTime).substring(0, 5); // "HH:MM"
        }
        // Local time হিসেবে parse করো (BST = UTC+6)
        return new Date(`${dateStr}T${timeStr}:00`);
    }

    // DepartureTime না থাকলে সেই দিনের end of day ধরো
    const d = new Date(journeyDate);
    d.setHours(23, 59, 0, 0);
    return d;
}

/** listing তৈরির পর waitlist passengers notify করে */
async function notifyWaitlist(pool, scheduleID, journeyDate) {
    try {
        const wl = await pool.request()
            .input('ScheduleID',  sql.Int,  scheduleID)
            .input('JourneyDate', sql.Date, journeyDate)
            .query(`
                SELECT TOP 5 w.WaitlistID, u.FirstName, u.Email
                FROM Waitlist w
                JOIN Users u ON u.UserID = w.UserID
                WHERE w.ScheduleID  = @ScheduleID
                  AND w.JourneyDate = @JourneyDate
                  AND w.Status      = 'waiting'
                ORDER BY w.AddedAt ASC
            `);

        if (!wl.recordset.length) return;

        for (const row of wl.recordset) {
            await pool.request()
                .input('WaitlistID', sql.Int, row.WaitlistID)
                .query(`
                    UPDATE Waitlist
                    SET Status = 'marketplace_notified', NotifiedAt = GETDATE()
                    WHERE WaitlistID = @WaitlistID AND Status = 'waiting'
                `);
            console.log(`📢 [Waitlist→Marketplace] Notified: ${row.FirstName} <${row.Email}>`);
        }

        console.log(`✅ ${wl.recordset.length} waitlist passenger(s) notified for schedule ${scheduleID}`);
    } catch (err) {
        console.error('Waitlist notify error:', err.message);
    }
}

// ─────────────────────────────────────────────
// GET /transfer/marketplace
// ─────────────────────────────────────────────
router.get('/marketplace', async (req, res) => {
    try {
        const { origin, destination, date } = req.query;
        const pool = await poolPromise;
        let query = `
            SELECT *,
                   DATEDIFF(HOUR, GETDATE(), DepartureTime) AS HoursUntilDep
            FROM vw_TicketMarketplace
            WHERE ListingStatus = 'open'
              AND (ExpiresAt IS NULL OR ExpiresAt > GETDATE())
              AND JourneyDate >= CAST(GETDATE() AS DATE)
        `;
        const request = pool.request();
        if (origin)      { query += ` AND Origin = @Origin`;                  request.input('Origin',      sql.NVarChar, origin); }
        if (destination) { query += ` AND Destination = @Destination`;        request.input('Destination', sql.NVarChar, destination); }
        if (date)        { query += ` AND CAST(JourneyDate AS DATE) = @Date`; request.input('Date',        sql.Date,     date); }
        query += ` ORDER BY JourneyDate ASC, DepartureTime ASC`;
        const result = await request.query(query);

        const listings = result.recordset.map(l => ({
            ...l,
            SuggestedPrice: suggestedPrice(l.AskingPrice, l.DepartureTime),
            PlatformFee:    Math.round((l.AskingPrice || 0) * PLATFORM_FEE_PCT),
            SellerReceives: Math.round((l.AskingPrice || 0) * (1 - PLATFORM_FEE_PCT))
        }));

        res.json({ count: listings.length, listings });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ─────────────────────────────────────────────
// GET /transfer/price-suggestion?bookingID=X
// ─────────────────────────────────────────────
router.get('/price-suggestion', protect, async (req, res) => {
    const { bookingID } = req.query;
    if (!bookingID) return res.status(400).json({ message: 'bookingID দিন।' });
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('BookingID', sql.Int, bookingID)
            .input('UserID',    sql.Int, req.user.userID)
            .query(`
                SELECT b.TotalFare, b.JourneyDate, s.DepartureTime,
                       r.Origin, r.Destination
                FROM Bookings b
                JOIN Schedules s ON b.ScheduleID = s.ScheduleID
                JOIN Routes    r ON s.RouteID    = r.RouteID
                WHERE b.BookingID = @BookingID AND b.UserID = @UserID
            `);

        if (!result.recordset.length)
            return res.status(404).json({ message: 'Booking পাওয়া যায়নি।' });

        const bk = result.recordset[0];

        // ✅ FIX: JourneyDate + DepartureTime সঠিকভাবে combine করো
        // SQL time type সরাসরি ব্যবহার করলে 1900-01-01 date আসে → hoursLeft=0 bug
        const dep = buildDepartureDateTime(bk.JourneyDate, bk.DepartureTime);
        const hoursLeft = dep ? Math.max(0, Math.round((dep - new Date()) / 3600000)) : null;

        const tiers = [
            { label: '24h+ বাকি',   minHours: 24, pct: 100 },
            { label: '12–24h বাকি', minHours: 12, pct:  80 },
            { label: '6–12h বাকি',  minHours:  6, pct:  60 },
            { label: '3–6h বাকি',   minHours:  3, pct:  40 },
            { label: '1–3h বাকি',   minHours:  1, pct:  25 },
            { label: '1h এরও কম',   minHours:  0, pct:  10 },
        ];

        res.json({
            originalFare:   bk.TotalFare,
            suggestedPrice: suggestedPrice(bk.TotalFare, dep),
            platformFeePct: PLATFORM_FEE_PCT * 100,
            platformFee:    Math.round(bk.TotalFare * PLATFORM_FEE_PCT),
            sellerReceives: Math.round(bk.TotalFare * (1 - PLATFORM_FEE_PCT)),
            hoursLeft,
            tiers,
            route:         `${bk.Origin} → ${bk.Destination}`,
            journeyDate:   bk.JourneyDate,
            departureTime: dep
        });
    } catch (err) {
        console.error('price-suggestion error:', err.message);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ─────────────────────────────────────────────
// POST /transfer/list   (Sell)
// ─────────────────────────────────────────────
router.post('/list', protect, async (req, res) => {
    const { bookingID, askingPrice, expiresAt } = req.body;
    const sellerID = req.user.userID;
    if (!bookingID || !askingPrice)
        return res.status(400).json({ message: 'bookingID এবং askingPrice দিন।' });

    try {
        const pool = await poolPromise;

        // Booking verify
        const bk = await pool.request()
            .input('BookingID', sql.Int, bookingID)
            .input('UserID',    sql.Int, sellerID)
            .query(`
                SELECT b.BookingID, b.Status, b.TotalFare, b.JourneyDate,
                       b.ScheduleID, s.DepartureTime
                FROM Bookings b
                LEFT JOIN Schedules s ON b.ScheduleID = s.ScheduleID
                WHERE b.BookingID = @BookingID AND b.UserID = @UserID
            `);

        if (!bk.recordset.length)
            return res.status(404).json({ message: 'Booking পাওয়া যায়নি।' });

        const booking = bk.recordset[0];

        if (booking.Status !== 'confirmed')
            return res.status(400).json({ message: 'শুধুমাত্র confirmed booking list করা যাবে।' });

        const jDate = new Date(booking.JourneyDate); jDate.setUTCHours(23, 59, 59);
        if (jDate < new Date())
            return res.status(400).json({ message: 'অতীতের ticket list করা যাবে না।' });

        // Anti-scalping
        if (parseFloat(askingPrice) > parseFloat(booking.TotalFare))
            return res.status(400).json({
                message: `Asking price ৳${booking.TotalFare} এর বেশি হতে পারবে না। (Anti-scalping rule)`
            });

        // ✅ FIX: Table column is 'Status' (not ListingStatus)
        const existing = await pool.request()
            .input('BookingID', sql.Int, bookingID)
            .query(`
                SELECT ListingID FROM TicketListings
                WHERE BookingID = @BookingID
                  AND Status NOT IN ('cancelled', 'transferred')
            `);
        if (existing.recordset.length)
            return res.status(409).json({ message: 'এই ticket আগেই marketplace এ আছে।' });

        // Platform fee calculation
        const platformFee    = Math.round(parseFloat(askingPrice) * PLATFORM_FEE_PCT * 100) / 100;
        const sellerReceives = Math.round((parseFloat(askingPrice) - platformFee) * 100) / 100;

        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            // ✅ আগে INSERT — trigger চেক করে Status = 'confirmed', এখন ঠিক আছে
            const result = await transaction.request()
                .input('BookingID',   sql.Int,            bookingID)
                .input('SellerID',    sql.Int,            sellerID)
                .input('AskingPrice', sql.Decimal(10, 2), askingPrice)
                .input('ExpiresAt',   sql.DateTime,       expiresAt || null)
                .input('ListingType', sql.NVarChar,       'sell')
                .query(`
                    INSERT INTO TicketListings (BookingID, SellerID, AskingPrice, ExpiresAt, ListingType)
                    VALUES (@BookingID, @SellerID, @AskingPrice, @ExpiresAt, @ListingType);
                    SELECT SCOPE_IDENTITY() AS ListingID;
                `);

            // ✅ তারপর TICKET LOCK — INSERT হয়ে গেছে, trigger আর fire হবে না
            const lock = await transaction.request()
                .input('BookingID', sql.Int, bookingID)
                .query(`UPDATE Bookings SET Status = 'listed' WHERE BookingID = @BookingID AND Status = 'confirmed'`);
            if (!lock.rowsAffected.some(n => n > 0)) {
                throw new Error('Ticket is no longer available to list.');
            }

            await transaction.commit();

            if (booking.ScheduleID)
                notifyWaitlist(pool, booking.ScheduleID, booking.JourneyDate);

            createNotification(pool, sellerID, 'transfer_listed',
                `Ticket listed! Asking ৳${askingPrice} — Platform fee ৳${platformFee}, you'll receive ৳${sellerReceives}.`,
                { listingID: result.recordset[0].ListingID, askingPrice, sellerReceives }
            );

            res.status(201).json({
                message:       'Ticket listed হয়েছে! Booking এখন locked।',
                listingID:     result.recordset[0].ListingID,
                askingPrice:   parseFloat(askingPrice),
                platformFee,
                sellerReceives,
                note:          `Transfer হলে আপনি ৳${sellerReceives} পাবেন (৳${platformFee} platform fee)`
            });
        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }

    } catch (err) {
        console.error('list error:', err.message);
        if (err.message.includes('duplicate') || err.message.includes('UNIQUE'))
            return res.status(409).json({ message: 'এই ticket আগেই listed আছে।' });
        res.status(500).json({ message: 'Server error.' });
    }
});

// ─────────────────────────────────────────────
// POST /transfer/list-swap   (Swap)
// ─────────────────────────────────────────────
router.post('/list-swap', protect, async (req, res) => {
    const { bookingID, wantDescription, note } = req.body;
    const sellerID = req.user.userID;
    if (!bookingID) return res.status(400).json({ message: 'bookingID দিন।' });

    try {
        const pool = await poolPromise;

        const bk = await pool.request()
            .input('BookingID', sql.Int, bookingID)
            .input('UserID',    sql.Int, sellerID)
            .query(`
                SELECT b.BookingID, b.Status, b.TotalFare, b.JourneyDate, b.ScheduleID
                FROM Bookings b
                WHERE b.BookingID = @BookingID AND b.UserID = @UserID
            `);

        if (!bk.recordset.length)
            return res.status(404).json({ message: 'Booking পাওয়া যায়নি।' });

        const booking = bk.recordset[0];

        if (booking.Status !== 'confirmed')
            return res.status(400).json({ message: 'Confirmed booking ছাড়া list করা যাবে না।' });

        const jDate = new Date(booking.JourneyDate); jDate.setUTCHours(23, 59, 59);
        if (jDate < new Date())
            return res.status(400).json({ message: 'অতীতের ticket list করা যাবে না।' });

        // ✅ FIX: Table column is 'Status' (not ListingStatus)
        const existing = await pool.request()
            .input('BookingID', sql.Int, bookingID)
            .query(`
                SELECT ListingID FROM TicketListings
                WHERE BookingID = @BookingID
                  AND Status NOT IN ('cancelled', 'transferred')
            `);
        if (existing.recordset.length)
            return res.status(409).json({ message: 'এই ticket ইতিমধ্যে marketplace এ আছে।' });

        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            // ✅ আগে INSERT — trigger চেক করে Status = 'confirmed', এখন ঠিক আছে
            const result = await transaction.request()
                .input('BookingID',       sql.Int,            bookingID)
                .input('SellerID',        sql.Int,            sellerID)
                .input('AskingPrice',     sql.Decimal(10, 2), 0)
                .input('WantDescription', sql.NVarChar,       wantDescription || null)
                .input('Note',            sql.NVarChar,       note || null)
                .input('ListingType',     sql.NVarChar,       'swap')
                .query(`
                    INSERT INTO TicketListings (BookingID, SellerID, AskingPrice, WantDescription, Note, ListingType)
                    VALUES (@BookingID, @SellerID, @AskingPrice, @WantDescription, @Note, @ListingType);
                    SELECT SCOPE_IDENTITY() AS ListingID;
                `);

            // ✅ তারপর TICKET LOCK — INSERT হয়ে গেছে, trigger আর fire হবে না
            const lock = await transaction.request()
                .input('BookingID', sql.Int, bookingID)
                .query(`UPDATE Bookings SET Status = 'listed' WHERE BookingID = @BookingID AND Status = 'confirmed'`);
            if (!lock.rowsAffected.some(n => n > 0)) {
                throw new Error('Ticket is no longer available to list.');
            }

            await transaction.commit();

            if (booking.ScheduleID)
                notifyWaitlist(pool, booking.ScheduleID, booking.JourneyDate);

            res.status(201).json({
                message:   'Swap listing তৈরি হয়েছে! Booking এখন locked।',
                listingID: result.recordset[0].ListingID
            });
        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }

    } catch (err) {
        console.error('list-swap error:', err.message);
        res.status(500).json({ message: 'Server error: ' + err.message });
    }
});

// ─────────────────────────────────────────────
// POST /transfer/request/:listingID   (Buy)
// ─────────────────────────────────────────────
router.post('/request/:listingID', protect, async (req, res) => {
    const listingID = parseInt(req.params.listingID);
    const buyerID   = req.user.userID;
    const { paymentRef } = req.body;
    if (!paymentRef) return res.status(400).json({ message: 'Payment reference দিন।' });

    try {
        const pool = await poolPromise;

        const ls = await pool.request()
            .input('ListingID', sql.Int, listingID)
            .query(`SELECT * FROM vw_TicketMarketplace WHERE ListingID = @ListingID`);

        if (!ls.recordset.length)
            return res.status(404).json({ message: 'Listing পাওয়া যায়নি।' });

        const listing = ls.recordset[0];

        if (listing.ListingStatus !== 'open')
            return res.status(400).json({ message: 'এই ticket আর available নেই।' });
        if (listing.SellerID === buyerID)
            return res.status(400).json({ message: 'নিজের ticket নিজে কিনতে পারবেন না।' });

        const dup = await pool.request()
            .input('ListingID', sql.Int, listingID)
            .input('BuyerID',   sql.Int, buyerID)
            .query(`
                SELECT TransferID FROM TicketTransfers
                WHERE ListingID = @ListingID AND BuyerID = @BuyerID
                  AND TransferStatus IN ('pending','completed')
            `);
        if (dup.recordset.length)
            return res.status(409).json({ message: 'আপনি আগেই এই ticket এর জন্য request করেছেন।' });

        const askingPrice    = parseFloat(listing.AskingPrice || 0);
        const platformFee    = Math.round(askingPrice * PLATFORM_FEE_PCT * 100) / 100;
        const sellerReceives = Math.round((askingPrice - platformFee) * 100) / 100;

        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const tr = await transaction.request()
                .input('ListingID',      sql.Int,            listingID)
                .input('BuyerID',        sql.Int,            buyerID)
                .input('PaymentRef',     sql.NVarChar,       paymentRef)
                .input('PlatformFee',    sql.Decimal(10, 2), platformFee)
                .input('SellerReceives', sql.Decimal(10, 2), sellerReceives)
                .query(`
                    INSERT INTO TicketTransfers
                        (ListingID, BuyerID, PaymentRef, PaymentStatus, TransferStatus, PlatformFee, SellerReceives)
                    VALUES
                        (@ListingID, @BuyerID, @PaymentRef, 'paid', 'pending', @PlatformFee, @SellerReceives);
                    SELECT SCOPE_IDENTITY() AS TransferID;
                `).catch(async () => {
                    return await transaction.request()
                        .input('ListingID',  sql.Int,     listingID)
                        .input('BuyerID',    sql.Int,     buyerID)
                        .input('PaymentRef', sql.NVarChar, paymentRef)
                        .query(`
                            INSERT INTO TicketTransfers (ListingID, BuyerID, PaymentRef, PaymentStatus, TransferStatus)
                            VALUES (@ListingID, @BuyerID, @PaymentRef, 'paid', 'pending');
                            SELECT SCOPE_IDENTITY() AS TransferID;
                        `);
                });

            const transferID = tr.recordset[0].TransferID;

            await transaction.request()
                .input('ListingID', sql.Int, listingID)
                .query(`UPDATE TicketListings SET Status = 'reserved' WHERE ListingID = @ListingID`);

            await transaction.request()
                .input('BuyerID',   sql.Int, buyerID)
                .input('BookingID', sql.Int, listing.BookingID)
                .query(`UPDATE Bookings SET UserID = @BuyerID, Status = 'confirmed' WHERE BookingID = @BookingID`);

            await transaction.request()
                .input('TransferID', sql.Int, transferID)
                .query(`
                    UPDATE TicketTransfers
                    SET TransferStatus = 'completed', CompletedAt = GETDATE()
                    WHERE TransferID = @TransferID
                `);

            await transaction.request()
                .input('ListingID', sql.Int, listingID)
                .query(`UPDATE TicketListings SET Status = 'transferred' WHERE ListingID = @ListingID`);

            await transaction.commit();

            createNotification(pool, buyerID, 'transfer_completed',
                `Transfer complete! Ticket (Seat ${listing.SeatNumber}) এখন আপনার নামে। ৳${askingPrice} paid.`,
                { bookingID: listing.BookingID, seatNumber: listing.SeatNumber, amountPaid: askingPrice }
            );
            createNotification(pool, listing.SellerID, 'transfer_completed',
                `Ticket sold! Seat ${listing.SeatNumber} — আপনি ৳${sellerReceives} পাবেন (৳${platformFee} platform fee কাটা হয়েছে).`,
                { bookingID: listing.BookingID, sellerReceives, platformFee }
            );

            res.json({
                message:       'Transfer সফল! Ticket এখন আপনার নামে।',
                transferID,
                bookingID:     listing.BookingID,
                seatNumber:    listing.SeatNumber,
                route:         `${listing.Origin} → ${listing.Destination}`,
                amountPaid:    askingPrice,
                platformFee,
                sellerReceives,
                breakdown:     `৳${askingPrice} paid → platform ৳${platformFee} (5%) → seller ৳${sellerReceives}`
            });
        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }

    } catch (err) {
        console.error('request error:', err.message);
        res.status(500).json({ message: 'Transfer failed: ' + err.message });
    }
});

// ─────────────────────────────────────────────
// DELETE /transfer/cancel/:listingID
// ─────────────────────────────────────────────
router.delete('/cancel/:listingID', protect, async (req, res) => {
    const listingID = parseInt(req.params.listingID);
    const sellerID  = req.user.userID;
    try {
        const pool = await poolPromise;

        const ls = await pool.request()
            .input('ListingID', sql.Int, listingID)
            .input('SellerID',  sql.Int, sellerID)
            .query(`SELECT * FROM TicketListings WHERE ListingID = @ListingID AND SellerID = @SellerID`);

        if (!ls.recordset.length)
            return res.status(404).json({ message: 'Listing পাওয়া যায়নি।' });
        if (ls.recordset[0].Status !== 'open')
            return res.status(400).json({ message: 'Reserved listing cancel করা যাবে না।' });

        const bookingID = ls.recordset[0].BookingID;

        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            await transaction.request()
                .input('ListingID', sql.Int, listingID)
                .query(`UPDATE TicketListings SET Status = 'cancelled' WHERE ListingID = @ListingID`);

            // ✅ TICKET UNLOCK
            await transaction.request()
                .input('BookingID', sql.Int, bookingID)
                .query(`UPDATE Bookings SET Status = 'confirmed' WHERE BookingID = @BookingID AND Status = 'listed'`);

            await transaction.commit();
            res.json({ message: 'Listing cancel হয়েছে। Booking আবার active হয়েছে।' });
        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }

    } catch (err) {
        console.error('cancel error:', err.message);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ─────────────────────────────────────────────
// GET /transfer/my-listings
// ─────────────────────────────────────────────
router.get('/my-listings', protect, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('SellerID', sql.Int, req.user.userID)
            .query(`SELECT * FROM vw_TicketMarketplace WHERE SellerID = @SellerID ORDER BY ListedAt DESC`);

        const listings = result.recordset.map(l => ({
            ...l,
            PlatformFee:    Math.round((l.AskingPrice || 0) * PLATFORM_FEE_PCT),
            SellerReceives: Math.round((l.AskingPrice || 0) * (1 - PLATFORM_FEE_PCT))
        }));

        res.json(listings);
    } catch (err) {
        console.error('my-listings error:', err.message);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ─────────────────────────────────────────────
// GET /transfer/my-requests
// ─────────────────────────────────────────────
router.get('/my-requests', protect, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('BuyerID', sql.Int, req.user.userID)
            .query(`SELECT * FROM vw_TransferHistory WHERE BuyerID = @BuyerID ORDER BY RequestedAt DESC`);
        res.json(result.recordset);
    } catch (err) {
        console.error('my-requests error:', err.message);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ─────────────────────────────────────────────
// GET /transfer/my-transfers
// ─────────────────────────────────────────────
router.get('/my-transfers', protect, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('BuyerID', sql.Int, req.user.userID)
            .query(`SELECT * FROM vw_TransferHistory WHERE BuyerID = @BuyerID ORDER BY RequestedAt DESC`);
        res.json(result.recordset);
    } catch (err) {
        console.error('my-transfers error:', err.message);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ─────────────────────────────────────────────
// GET /transfer/history   (admin/staff)
// ─────────────────────────────────────────────
router.get('/history', protect, async (req, res) => {
    if (!['admin', 'staff'].includes(req.user.role))
        return res.status(403).json({ message: 'Access denied.' });
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .query(`SELECT TOP 100 * FROM vw_TransferHistory ORDER BY RequestedAt DESC`);
        res.json(result.recordset);
    } catch (err) {
        console.error('history error:', err.message);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ─────────────────────────────────────────────
// POST /transfer/swap-request/:listingID
// ─────────────────────────────────────────────
router.post('/swap-request/:listingID', protect, async (req, res) => {
    const listingID = parseInt(req.params.listingID);
    const buyerID   = req.user.userID;
    const { offeredBookingID, message } = req.body;

    if (!offeredBookingID)
        return res.status(400).json({ message: 'offeredBookingID দিন।' });

    try {
        const pool = await poolPromise;

        const obk = await pool.request()
            .input('BookingID', sql.Int, offeredBookingID)
            .input('UserID',    sql.Int, buyerID)
            .query(`SELECT BookingID, Status, JourneyDate FROM Bookings WHERE BookingID = @BookingID AND UserID = @UserID`);

        if (!obk.recordset.length)
            return res.status(404).json({ message: 'Offered booking পাওয়া যায়নি।' });
        if (obk.recordset[0].Status !== 'confirmed')
            return res.status(400).json({ message: 'Confirmed booking ছাড়া offer করা যাবে না।' });

        const ls = await pool.request()
            .input('ListingID', sql.Int, listingID)
            .query(`SELECT * FROM vw_TicketMarketplace WHERE ListingID = @ListingID`);

        if (!ls.recordset.length)
            return res.status(404).json({ message: 'Listing পাওয়া যায়নি।' });
        if (ls.recordset[0].Status !== 'open')
            return res.status(400).json({ message: 'এই listing আর available নেই।' });
        if (ls.recordset[0].SellerID === buyerID)
            return res.status(400).json({ message: 'নিজের listing এ request করা যাবে না।' });

        const paymentRef = `SWAP:${offeredBookingID}:${message || ''}`;

        const tr = await pool.request()
            .input('ListingID',  sql.Int,     listingID)
            .input('BuyerID',    sql.Int,     buyerID)
            .input('PaymentRef', sql.NVarChar, paymentRef)
            .query(`
                INSERT INTO TicketTransfers (ListingID, BuyerID, PaymentRef, PaymentStatus, TransferStatus)
                VALUES (@ListingID, @BuyerID, @PaymentRef, 'pending', 'pending');
                SELECT SCOPE_IDENTITY() AS TransferID;
            `);

        const offeredLock = await pool.request()
            .input('BookingID', sql.Int, offeredBookingID)
            .query(`UPDATE Bookings SET Status = 'listed' WHERE BookingID = @BookingID AND Status = 'confirmed'`);
        if (!getAffectedRows(offeredLock)) {
            return res.status(409).json({ message: 'Offered ticket আর available নেই।' });
        }

        res.status(201).json({
            message:    'Swap request পাঠানো হয়েছে! Seller accept করলে swap হবে।',
            transferID: tr.recordset[0].TransferID
        });
    } catch (err) {
        console.error('swap-request error:', err.message);
        res.status(500).json({ message: 'Server error: ' + err.message });
    }
});

// ─────────────────────────────────────────────
// PUT /transfer/swap-request/:transferID   (accept/decline)
// ─────────────────────────────────────────────
router.put('/swap-request/:transferID', protect, async (req, res) => {
    const transferID = parseInt(req.params.transferID);
    const sellerID   = req.user.userID;
    const { action } = req.body;

    if (!['accept', 'decline'].includes(action))
        return res.status(400).json({ message: 'action: accept অথবা decline' });

    try {
        const pool = await poolPromise;

        const tr = await pool.request()
            .input('TransferID', sql.Int, transferID)
            .query(`
                SELECT t.*, tl.BookingID AS SellerBookingID, tl.SellerID
                FROM TicketTransfers t
                JOIN TicketListings tl ON t.ListingID = tl.ListingID
                WHERE t.TransferID = @TransferID AND t.TransferStatus = 'pending'
            `);

        if (!tr.recordset.length)
            return res.status(404).json({ message: 'Pending request পাওয়া যায়নি।' });

        const reqData = tr.recordset[0];
        if (reqData.SellerID !== sellerID)
            return res.status(403).json({ message: 'শুধু listing owner accept/decline করতে পারবে।' });

        if (action === 'decline') {
            const payRef = reqData.PaymentRef || '';
            const match  = payRef.match(/^SWAP:(\d+)/);
            if (match) {
                const buyerBookingID = parseInt(match[1]);
                await pool.request()
                    .input('BookingID', sql.Int, buyerBookingID)
                    .query(`UPDATE Bookings SET Status = 'confirmed' WHERE BookingID = @BookingID AND Status = 'listed'`);
            }
            await pool.request()
                .input('TransferID', sql.Int, transferID)
                .query(`UPDATE TicketTransfers SET TransferStatus = 'cancelled' WHERE TransferID = @TransferID`);
            return res.json({ message: 'Swap request decline করা হয়েছে। Booking unlock হয়েছে।' });
        }

        // ACCEPT
        const payRef = reqData.PaymentRef || '';
        const match  = payRef.match(/^SWAP:(\d+)/);
        if (!match) return res.status(400).json({ message: 'Invalid swap request format.' });

        const buyerBookingID = parseInt(match[1]);
        const buyerID        = reqData.BuyerID;

        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            await transaction.request()
                .input('NewOwner',  sql.Int, buyerID)
                .input('BookingID', sql.Int, reqData.SellerBookingID)
                .query(`UPDATE Bookings SET UserID = @NewOwner, Status = 'confirmed' WHERE BookingID = @BookingID`);

            await transaction.request()
                .input('NewOwner',  sql.Int, sellerID)
                .input('BookingID', sql.Int, buyerBookingID)
                .query(`UPDATE Bookings SET UserID = @NewOwner, Status = 'confirmed' WHERE BookingID = @BookingID`);

            await transaction.request()
                .input('TransferID', sql.Int, transferID)
                .query(`
                    UPDATE TicketTransfers
                    SET TransferStatus = 'completed', PaymentStatus = 'paid', CompletedAt = GETDATE()
                    WHERE TransferID = @TransferID
                `);

            await transaction.request()
                .input('ListingID', sql.Int, reqData.ListingID)
                .query(`UPDATE TicketListings SET Status = 'transferred' WHERE ListingID = @ListingID`);

            const others = await transaction.request()
                .input('ListingID',  sql.Int, reqData.ListingID)
                .input('TransferID', sql.Int, transferID)
                .query(`
                    SELECT t.TransferID, t.PaymentRef FROM TicketTransfers t
                    WHERE t.ListingID = @ListingID AND t.TransferID <> @TransferID
                      AND t.TransferStatus = 'pending'
                `);

            for (const other of others.recordset) {
                const m2 = (other.PaymentRef || '').match(/^SWAP:(\d+)/);
                if (m2) {
                    await transaction.request()
                        .input('BookingID', sql.Int, parseInt(m2[1]))
                        .query(`UPDATE Bookings SET Status = 'confirmed' WHERE BookingID = @BookingID AND Status = 'listed'`);
                }
                await transaction.request()
                    .input('TransferID', sql.Int, other.TransferID)
                    .query(`UPDATE TicketTransfers SET TransferStatus = 'cancelled' WHERE TransferID = @TransferID`);
            }

            await transaction.commit();

            createNotification(pool, buyerID, 'transfer_completed',
                `Swap accepted! Your ticket has been exchanged successfully.`,
                { listingID: reqData.ListingID }
            );
            createNotification(pool, sellerID, 'transfer_completed',
                `Swap complete! Your ticket has been exchanged.`,
                { listingID: reqData.ListingID }
            );

            res.json({ message: 'Swap সম্পন্ন! দুটো ticket swap হয়ে গেছে।' });
        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }

    } catch (err) {
        console.error('swap-accept error:', err.message);
        res.status(500).json({ message: 'Server error: ' + err.message });
    }
});

// ─────────────────────────────────────────────
// GET /transfer/my-swap-requests
// ─────────────────────────────────────────────
router.get('/my-swap-requests', protect, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('SellerID', sql.Int, req.user.userID)
            .query(`
                SELECT t.TransferID, t.BuyerID, t.PaymentRef, t.TransferStatus, t.RequestedAt,
                       tl.ListingID, tl.BookingID AS SellerBookingID,
                       r.Origin, r.Destination, b.JourneyDate, b.SeatNumber,
                       u.FirstName + ' ' + u.LastName AS BuyerName, u.Email AS BuyerEmail,
                       TRY_CAST(
                           SUBSTRING(t.PaymentRef, 6,
                               CASE WHEN CHARINDEX(':', t.PaymentRef, 6) > 0
                                    THEN CHARINDEX(':', t.PaymentRef, 6) - 6
                                    ELSE LEN(t.PaymentRef) - 4 END
                           ) AS INT
                       ) AS OfferedBookingID
                FROM TicketTransfers t
                JOIN TicketListings tl ON t.ListingID = tl.ListingID
                JOIN Bookings b        ON tl.BookingID = b.BookingID
                JOIN Schedules s       ON b.ScheduleID = s.ScheduleID
                JOIN Routes r          ON s.RouteID = r.RouteID
                JOIN Users u           ON t.BuyerID = u.UserID
                WHERE tl.SellerID = @SellerID
                  AND t.PaymentRef LIKE 'SWAP:%'
                  AND t.TransferStatus = 'pending'
                ORDER BY t.RequestedAt DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        console.error('my-swap-requests error:', err.message);
        res.status(500).json({ message: 'Server error.' });
    }
});

module.exports = router;