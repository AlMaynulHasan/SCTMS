-- =============================================
-- SCTMS Migration v3
-- Features: Booking RefCode, Schedule lifecycle status
-- =============================================

-- 1. Bookings table এ RefCode column যোগ
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Bookings') AND name='RefCode')
    ALTER TABLE Bookings ADD RefCode NVARCHAR(20) NULL;

-- Existing bookings এর জন্য RefCode generate করো
UPDATE Bookings
SET RefCode = 'BK-' + CAST(YEAR(BookedAt) AS NVARCHAR) + '-' + RIGHT('000000' + CAST(BookingID AS NVARCHAR), 6)
WHERE RefCode IS NULL;

-- 2. Schedules table এ Status column — 'scheduled' default
-- (আগে থেকে থাকলে skip)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Schedules') AND name='Status')
    ALTER TABLE Schedules ADD Status NVARCHAR(20) DEFAULT 'scheduled';

-- Existing schedules এ default status set করো
UPDATE Schedules SET Status = 'scheduled' WHERE Status IS NULL;

PRINT '✅ Migration v3 complete!';
PRINT 'Added: Bookings.RefCode, Schedules.Status lifecycle';
