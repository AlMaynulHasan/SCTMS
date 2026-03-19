-- =============================================
-- SCTMS Migration v2
-- Features: Ticket Lock, Platform Fee, Smart Price, Waitlist→Marketplace
-- Run এটা SQL Server Management Studio তে
-- =============================================

-- ─────────────────────────────────────────────
-- 1. Bookings.Status — 'listed' value allow করো
-- (CHECK constraint থাকলে alter করতে হবে)
-- ─────────────────────────────────────────────

-- পুরনো constraint drop করো (name ভিন্ন হতে পারে — SSMS এ দেখো)
-- ALTER TABLE Bookings DROP CONSTRAINT CK_Bookings_Status;

-- নতুন constraint — 'listed' যোগ হয়েছে
-- ALTER TABLE Bookings ADD CONSTRAINT CK_Bookings_Status
--   CHECK (Status IN ('pending','confirmed','cancelled','exchanged','listed'));

-- ─────────────────────────────────────────────
-- 2. TicketListings — নতুন columns
-- ─────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('TicketListings') AND name='ListingType')
    ALTER TABLE TicketListings ADD ListingType NVARCHAR(10) DEFAULT 'sell';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('TicketListings') AND name='WantDescription')
    ALTER TABLE TicketListings ADD WantDescription NVARCHAR(500) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('TicketListings') AND name='Note')
    ALTER TABLE TicketListings ADD Note NVARCHAR(300) NULL;

-- ─────────────────────────────────────────────
-- 3. TicketTransfers — Platform fee columns
-- ─────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('TicketTransfers') AND name='PlatformFee')
    ALTER TABLE TicketTransfers ADD PlatformFee DECIMAL(10,2) DEFAULT 0;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('TicketTransfers') AND name='SellerReceives')
    ALTER TABLE TicketTransfers ADD SellerReceives DECIMAL(10,2) DEFAULT 0;

-- ─────────────────────────────────────────────
-- 4. Waitlist table (না থাকলে create করো)
-- ─────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='Waitlist')
BEGIN
    CREATE TABLE Waitlist (
        WaitlistID  INT IDENTITY(1,1) PRIMARY KEY,
        UserID      INT NOT NULL REFERENCES Users(UserID),
        ScheduleID  INT NOT NULL REFERENCES Schedules(ScheduleID),
        JourneyDate DATE NOT NULL,
        Status      NVARCHAR(30) DEFAULT 'waiting',
            -- waiting | marketplace_notified | fulfilled | expired
        AddedAt     DATETIME DEFAULT GETDATE(),
        NotifiedAt  DATETIME NULL
    );
    CREATE INDEX IX_Waitlist_Schedule ON Waitlist(ScheduleID, JourneyDate, Status);
    PRINT 'Waitlist table created.';
END
ELSE
BEGIN
    -- NotifiedAt column না থাকলে যোগ করো
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Waitlist') AND name='NotifiedAt')
        ALTER TABLE Waitlist ADD NotifiedAt DATETIME NULL;

    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Waitlist') AND name='Status')
        ALTER TABLE Waitlist ADD Status NVARCHAR(30) DEFAULT 'waiting';

    PRINT 'Waitlist table already exists — columns updated.';
END

-- ─────────────────────────────────────────────
-- 5. vw_TicketMarketplace — recreate with new columns
-- ─────────────────────────────────────────────

IF OBJECT_ID('vw_TicketMarketplace', 'V') IS NOT NULL
    DROP VIEW vw_TicketMarketplace;
GO

CREATE VIEW vw_TicketMarketplace AS
SELECT
    tl.ListingID,
    tl.Status           AS ListingStatus,
    tl.SellerID,
    u.FirstName + ' ' + u.LastName AS SellerName,
    tl.BookingID,
    b.SeatNumber,
    r.Origin,
    r.Destination,
    b.JourneyDate,
    s.DepartureTime,
    s.ArrivalTime,
    v.VehicleName,
    v.VehicleType,
    tl.AskingPrice,
    b.TotalFare,
    tl.ListingType,
    tl.WantDescription,
    tl.Note,
    tl.ListedAt,
    tl.ExpiresAt,
    -- Platform fee breakdown
    ROUND(tl.AskingPrice * 0.05, 2)              AS PlatformFee,
    ROUND(tl.AskingPrice * 0.95, 2)              AS SellerReceives,
    -- Smart price: hours until departure
    DATEDIFF(HOUR, GETDATE(), s.DepartureTime)   AS HoursUntilDep,
    -- Auto-suggested price based on time remaining
    CASE
        WHEN DATEDIFF(HOUR, GETDATE(), s.DepartureTime) >= 24 THEN ROUND(b.TotalFare * 1.00, 0)
        WHEN DATEDIFF(HOUR, GETDATE(), s.DepartureTime) >= 12 THEN ROUND(b.TotalFare * 0.80, 0)
        WHEN DATEDIFF(HOUR, GETDATE(), s.DepartureTime) >=  6 THEN ROUND(b.TotalFare * 0.60, 0)
        WHEN DATEDIFF(HOUR, GETDATE(), s.DepartureTime) >=  3 THEN ROUND(b.TotalFare * 0.40, 0)
        WHEN DATEDIFF(HOUR, GETDATE(), s.DepartureTime) >=  1 THEN ROUND(b.TotalFare * 0.25, 0)
        ELSE                                                        ROUND(b.TotalFare * 0.10, 0)
    END                                          AS SuggestedPrice
FROM TicketListings tl
JOIN Bookings  b ON tl.BookingID  = b.BookingID
JOIN Schedules s ON b.ScheduleID  = s.ScheduleID
JOIN Routes    r ON s.RouteID     = r.RouteID
JOIN Vehicles  v ON s.VehicleID   = v.VehicleID
JOIN Users     u ON tl.SellerID   = u.UserID;
GO

-- ─────────────────────────────────────────────
-- 6. vw_TransferHistory — recreate with fee columns
-- ─────────────────────────────────────────────

IF OBJECT_ID('vw_TransferHistory', 'V') IS NOT NULL
    DROP VIEW vw_TransferHistory;
GO

CREATE VIEW vw_TransferHistory AS
SELECT
    tt.TransferID,
    tt.ListingID,
    tt.BuyerID,
    ub.FirstName + ' ' + ub.LastName AS BuyerName,
    ub.Email                          AS BuyerEmail,
    tl.SellerID,
    us.FirstName + ' ' + us.LastName AS SellerName,
    tl.BookingID,
    b.SeatNumber,
    r.Origin,
    r.Destination,
    b.JourneyDate,
    s.DepartureTime,
    tl.AskingPrice,
    tl.ListingType,
    tt.PaymentRef,
    tt.PaymentStatus,
    tt.TransferStatus,
    tt.PlatformFee,
    tt.SellerReceives,
    tt.RequestedAt,
    tt.CompletedAt
FROM TicketTransfers tt
JOIN TicketListings tl ON tt.ListingID  = tl.ListingID
JOIN Bookings       b  ON tl.BookingID  = b.BookingID
JOIN Schedules      s  ON b.ScheduleID  = s.ScheduleID
JOIN Routes         r  ON s.RouteID     = r.RouteID
JOIN Users          ub ON tt.BuyerID    = ub.UserID
JOIN Users          us ON tl.SellerID   = us.UserID;
GO

PRINT '✅ Migration v2 complete!';
PRINT 'Features added: Ticket Lock, Platform Fee (5%), Smart Price view, Waitlist table';

-- =============================================
-- SCTMS Migration v2 — PATCH (views only)
-- শুধু এটা run করুন, বাকি migration আগেই হয়ে গেছে
-- =============================================
 
-- vw_TicketMarketplace
IF OBJECT_ID('vw_TicketMarketplace', 'V') IS NOT NULL
    DROP VIEW vw_TicketMarketplace;
GO
 
CREATE VIEW vw_TicketMarketplace AS
SELECT
    tl.ListingID,
    tl.Status           AS ListingStatus,
    tl.SellerID,
    u.FirstName + ' ' + u.LastName AS SellerName,
    tl.BookingID,
    b.SeatNumber,
    r.Origin,
    r.Destination,
    b.JourneyDate,
    s.DepartureTime,
    s.ArrivalTime,
    v.VehicleName,
    v.Type              AS VehicleType,
    tl.AskingPrice,
    b.TotalFare,
    tl.ListingType,
    tl.WantDescription,
    tl.Note,
    tl.ListedAt,
    tl.ExpiresAt,
    ROUND(tl.AskingPrice * 0.05, 2)            AS PlatformFee,
    ROUND(tl.AskingPrice * 0.95, 2)            AS SellerReceives,
    DATEDIFF(HOUR, GETDATE(), s.DepartureTime) AS HoursUntilDep,
    CASE
        WHEN DATEDIFF(HOUR, GETDATE(), s.DepartureTime) >= 24 THEN ROUND(b.TotalFare * 1.00, 0)
        WHEN DATEDIFF(HOUR, GETDATE(), s.DepartureTime) >= 12 THEN ROUND(b.TotalFare * 0.80, 0)
        WHEN DATEDIFF(HOUR, GETDATE(), s.DepartureTime) >=  6 THEN ROUND(b.TotalFare * 0.60, 0)
        WHEN DATEDIFF(HOUR, GETDATE(), s.DepartureTime) >=  3 THEN ROUND(b.TotalFare * 0.40, 0)
        WHEN DATEDIFF(HOUR, GETDATE(), s.DepartureTime) >=  1 THEN ROUND(b.TotalFare * 0.25, 0)
        ELSE                                                        ROUND(b.TotalFare * 0.10, 0)
    END                                        AS SuggestedPrice
FROM TicketListings tl
JOIN Bookings  b ON tl.BookingID = b.BookingID
JOIN Schedules s ON b.ScheduleID = s.ScheduleID
JOIN Routes    r ON s.RouteID    = r.RouteID
JOIN Vehicles  v ON s.VehicleID  = v.VehicleID
JOIN Users     u ON tl.SellerID  = u.UserID;
GO
 
-- vw_TransferHistory
IF OBJECT_ID('vw_TransferHistory', 'V') IS NOT NULL
    DROP VIEW vw_TransferHistory;
GO
 
CREATE VIEW vw_TransferHistory AS
SELECT
    tt.TransferID,
    tt.ListingID,
    tt.BuyerID,
    ub.FirstName + ' ' + ub.LastName AS BuyerName,
    ub.Email                          AS BuyerEmail,
    tl.SellerID,
    us.FirstName + ' ' + us.LastName AS SellerName,
    tl.BookingID,
    b.SeatNumber,
    r.Origin,
    r.Destination,
    b.JourneyDate,
    s.DepartureTime,
    tl.AskingPrice,
    v.Type              AS VehicleType,
    tl.ListingType,
    tt.PaymentRef,
    tt.PaymentStatus,
    tt.TransferStatus,
    tt.PlatformFee,
    tt.SellerReceives,
    tt.RequestedAt,
    tt.CompletedAt
FROM TicketTransfers tt
JOIN TicketListings tl ON tt.ListingID  = tl.ListingID
JOIN Bookings       b  ON tl.BookingID  = b.BookingID
JOIN Schedules      s  ON b.ScheduleID  = s.ScheduleID
JOIN Routes         r  ON s.RouteID     = r.RouteID
JOIN Vehicles       v  ON s.VehicleID   = v.VehicleID
JOIN Users          ub ON tt.BuyerID    = ub.UserID
JOIN Users          us ON tl.SellerID   = us.UserID;
GO
 
PRINT '✅ Views patched successfully!';
 
 -- SQL Server এ View এর কোড দেখার জন্য
SELECT definition 
FROM sys.sql_modules 
WHERE object_id = OBJECT_ID('vw_BookingReport');

SELECT ScheduleID, DepartureTime, ArrivalTime, Status
FROM Schedules

SELECT ScheduleID, SeatNumber, JourneyDate
FROM Bookings

SELECT *
FROM Bookings
WHERE ScheduleID = 42
AND SeatNumber = '26'

EXEC sp_helptext 'sp_BookTicket'

CREATE OR ALTER PROCEDURE sp_BookTicket
    @UserID INT,
    @ScheduleID INT,
    @SeatNumber NVARCHAR(10),
    @TotalFare DECIMAL(10,2),
    @JourneyDate DATE,
    @Method NVARCHAR(20) = 'bkash'
AS
BEGIN
    BEGIN TRANSACTION;
    BEGIN TRY

        DECLARE @TotalSeats INT =
        (
            SELECT TotalSeats
            FROM Vehicles v
            JOIN Schedules s ON v.VehicleID = s.VehicleID
            WHERE s.ScheduleID = @ScheduleID
        );

        DECLARE @BookedSeats INT =
        (
            SELECT COUNT(*)
            FROM Bookings
            WHERE ScheduleID = @ScheduleID
            AND JourneyDate = @JourneyDate
            AND Status != 'cancelled'
        );

        IF @BookedSeats >= @TotalSeats
        BEGIN
            ROLLBACK;
            RAISERROR('No seats available',16,1);
            RETURN;
        END;

        IF EXISTS (
            SELECT 1
            FROM Bookings
            WHERE ScheduleID=@ScheduleID
            AND SeatNumber=@SeatNumber
            AND JourneyDate=@JourneyDate
            AND Status!='cancelled'
        )
        BEGIN
            ROLLBACK;
            RAISERROR('Seat already taken',16,1);
            RETURN;
        END;

        INSERT INTO Bookings (UserID,ScheduleID,SeatNumber,TotalFare,JourneyDate)
        VALUES (@UserID,@ScheduleID,@SeatNumber,@TotalFare,@JourneyDate);

        DECLARE @BookingID INT = SCOPE_IDENTITY();

        INSERT INTO Payments (BookingID,UserID,Amount,Method)
        VALUES (@BookingID,@UserID,@TotalFare,@Method);

        COMMIT;

        SELECT @BookingID AS BookingID,'success' AS Result;

    END TRY
    BEGIN CATCH
        ROLLBACK;
        THROW;
    END CATCH
END

EXEC sp_BookTicket
@UserID = 13,
@ScheduleID = 42,
@SeatNumber = '27',
@TotalFare = 900,
@JourneyDate = '2026-03-18'

SELECT ScheduleID, JourneyDate
FROM Schedules