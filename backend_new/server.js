// =============================================
// SCTMS BACKEND — Main Server v2.1
// =============================================
 
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const morgan     = require('morgan');
require('dotenv').config();
require('./config/db');
 
const app = express();
 
// ── 1. CORS ────────────────────────────────────
const allowedOrigins = [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:5502',
    'http://127.0.0.1:5502',
    'http://localhost:3000'
];
 
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            callback(new Error('CORS blocked: Origin not allowed'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
 
// ── 2. SECURITY HEADERS ────────────────────────
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
 
// ── 3. REQUEST LOGGING ─────────────────────────
if (process.env.NODE_ENV !== 'test') {
    app.use(morgan(':method :url :status :res[content-length] - :response-time ms'));
}
 
// ── 4. BODY PARSERS ────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
 
// ── 5. RATE LIMITERS ───────────────────────────
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'অনেক বেশি request। ১৫ মিনিট পর চেষ্টা করুন।' }
});
app.use('/api/', globalLimiter);
 
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { message: 'অনেক বেশি login attempt। ১৫ মিনিট পর চেষ্টা করুন।' }
});
 
// ── 6. ROUTES ──────────────────────────────────
app.use('/api/auth',         authLimiter, require('./routes/authRoutes'));
app.use('/api/schedules',                 require('./routes/scheduleRoutes'));
app.use('/api/bookings',                  require('./routes/bookingRoutes'));
app.use('/api/transfer',                  require('./routes/transferRoutes'));
app.use('/api/admin',                     require('./routes/adminRoutes'));
app.use('/api/promo',                     require('./routes/promoRoutes'));
app.use('/api/vehicles',                  require('./routes/vehicleRoutes'));
app.use('/api/routes',                    require('./routes/routeRoutes'));
app.use('/api/holds',                     require('./routes/holdRoutes'));
app.use('/api/waitlist',                  require('./routes/waitlistRoutes'));
app.use('/api/notifications',             require('./routes/notificationRoutes').router);
 
// ── 7. HEALTH CHECK ────────────────────────────
app.get('/', (req, res) => {
    res.json({
        status:  '✅ Running',
        message: '🚌 SCTMS API is live!',
        version: '2.1.0'
    });
});
 
// ── 8. GLOBAL ERROR HANDLER ────────────────────
app.use((err, req, res, next) => {
    console.error(`[Error] ${req.method} ${req.url} —`, err.message);
    if (err.message === 'CORS blocked: Origin not allowed')
        return res.status(403).json({ error: 'CORS policy blocked this request.' });
    res.status(500).json({ error: 'Internal server error.' });
});
 
// ── 9. 404 ─────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ message: `Route "${req.originalUrl}" পাওয়া যায়নি।` });
});
 
// ── 10. AUTO SCHEDULE GENERATOR ────────────────
// Server চালু হলে একবার run হয়, তারপর প্রতি ১৪ দিনে
const { poolPromise } = require('./config/db');
const mssql = require('mssql');
 
async function autoGenerateSchedules() {
    try {
        const pool = await poolPromise;
 
        // Column check — just for logging, not blocking
        const colRes = await pool.request().query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME='Routes'
              AND COLUMN_NAME IN ('BaseFare','Fare','EstimatedDuration','Duration')
        `);
        console.log('[AutoSchedule] Routes fare columns found:', colRes.recordset.map(r=>r.COLUMN_NAME).join(', ')||'none — using avg from Schedules');
 
        // Routes — fare/duration column নেই, Schedules থেকে average নেব
        const routes = await pool.request().query(`
            SELECT r.RouteID,
                   ISNULL(
                       (SELECT AVG(Fare) FROM Schedules WHERE RouteID=r.RouteID AND Fare>0),
                       500
                   ) AS Fare,
                   360 AS DurationMin
            FROM Routes r WHERE r.IsActive = 1
        `);
        const vehs = await pool.request().query(
            `SELECT VehicleID, TotalSeats FROM Vehicles WHERE IsActive=1 ORDER BY VehicleID`
        );
 
        if (!routes.recordset.length || !vehs.recordset.length) {
            console.log('[AutoSchedule] No active routes or vehicles.');
            return;
        }
 
        // সকাল ৭, দুপুর ২, রাত ১০ — তিনটা trip per route per day
        const slots = [
            { hour: 7,  min: 0, mult: 1.00 },
            { hour: 14, min: 0, mult: 1.00 },
            { hour: 22, min: 0, mult: 0.90 }, // রাতে ১০% সস্তা
        ];
 
        let created = 0, skipped = 0;
 
        for (let day = 1; day <= 14; day++) {
            const target  = new Date();
            target.setDate(target.getDate() + day);
            const dateStr = target.toISOString().split('T')[0]; // YYYY-MM-DD
 
            for (const route of routes.recordset) {
                const veh = vehs.recordset[route.RouteID % vehs.recordset.length];
 
                for (const slot of slots) {
                    // Already exists?
                    const check = await pool.request()
                        .input('RouteID', mssql.Int,  route.RouteID)
                        .input('Date',    mssql.Date, dateStr)
                        .input('Hour',    mssql.Int,  slot.hour)
                        .query(`
                            SELECT 1 FROM Schedules
                            WHERE RouteID    = @RouteID
                              AND JourneyDate = @Date
                              AND DATEPART(HOUR, DepartureTime) = @Hour
                              AND Status     != 'cancelled'
                        `);
 
                    if (check.recordset.length) { skipped++; continue; }
 
                    const depStr = `${dateStr} ${String(slot.hour).padStart(2,'0')}:${String(slot.min).padStart(2,'0')}:00`;
                    const arrDt  = new Date(`${dateStr}T${String(slot.hour).padStart(2,'0')}:00:00`);
                    arrDt.setMinutes(arrDt.getMinutes() + route.DurationMin);
                    const arrStr = arrDt.toISOString().replace('T',' ').substring(0, 19);
                    const fare   = Math.round(route.Fare * slot.mult / 10) * 10;
 
                    await pool.request()
                        .input('RouteID',   mssql.Int,           route.RouteID)
                        .input('VehicleID', mssql.Int,           veh.VehicleID)
                        .input('DepTime',   mssql.NVarChar,      depStr)
                        .input('ArrTime',   mssql.NVarChar,      arrStr)
                        .input('Date',      mssql.Date,          dateStr)
                        .input('Fare',      mssql.Decimal(10,2), fare)
                        .input('Seats',     mssql.Int,           veh.TotalSeats)
                        .query(`
                            INSERT INTO Schedules
                                (RouteID, VehicleID, DepartureTime, ArrivalTime,
                                 JourneyDate, Fare, AvailableSeats, Status)
                            VALUES
                                (@RouteID, @VehicleID, @DepTime, @ArrTime,
                                 @Date, @Fare, @Seats, 'scheduled')
                        `);
                    created++;
                }
            }
        }
 
        console.log(`[AutoSchedule] ✅ Created: ${created}, Skipped: ${skipped} (covers next 14 days)`);
    } catch (err) {
        console.error('[AutoSchedule] ❌ Error:', err.message);
    }
}
 
// Startup এ একবার + প্রতি ১৪ দিনে
autoGenerateSchedules();
setInterval(autoGenerateSchedules, 14 * 24 * 60 * 60 * 1000);
 
// ── 11. START ──────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log('\n╔═══════════════════════════════════════════╗');
    console.log('║        🚌 SCTMS Backend v2.1.0             ║');
    console.log('╠═══════════════════════════════════════════╣');
    console.log(`║  Server    →  http://localhost:${PORT}       ║`);
    console.log('║  CORS      ✅  Port 5500 & 5502 allowed   ║');
    console.log('║  AutoSched ✅  14-day rolling window      ║');
    console.log('╚═══════════════════════════════════════════╝\n');
});
 