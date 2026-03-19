-- =============================================
-- SCTMS — Extended Routes + Intermediate Stops
-- =============================================
USE SCTMS;
SET NOCOUNT ON;

-- ─────────────────────────────────────────────
-- STEP 1: নতুন Routes যোগ
-- ─────────────────────────────────────────────
MERGE Routes AS target
USING (VALUES
-- ── Reverse routes (সব দিক থেকে Dhaka) ──────
(N'Chittagong', N'Dhaka',        244),
(N'Sylhet',     N'Dhaka',        244),
(N'Rajshahi',   N'Dhaka',        253),
(N'Khulna',     N'Dhaka',        278),
(N'Barishal',   N'Dhaka',        190),
(N'Rangpur',    N'Dhaka',        300),
(N'Cox''s Bazar',N'Dhaka',       414),
(N'Mymensingh', N'Dhaka',         84),
(N'Comilla',    N'Dhaka',         90),
-- ── উত্তরবঙ্গ routes ─────────────────────────
(N'Rangpur',    N'Chittagong',   554),
(N'Rangpur',    N'Rajshahi',     135),
(N'Rangpur',    N'Sylhet',       450),
(N'Rangpur',    N'Khulna',       430),
(N'Panchagarh', N'Dhaka',        480),
(N'Panchagarh', N'Rangpur',      101),
(N'Panchagarh', N'Rajshahi',     272),
(N'Dinajpur',   N'Dhaka',        393),
(N'Dinajpur',   N'Rangpur',       75),
(N'Bogura',     N'Dhaka',        196),
(N'Bogura',     N'Chittagong',   358),
(N'Bogura',     N'Rajshahi',      72),
-- ── দক্ষিণ ও পূর্ব ──────────────────────────
(N'Cox''s Bazar',N'Chittagong',  152),
(N'Sylhet',     N'Chittagong',   323),
(N'Khulna',     N'Rajshahi',     175),
(N'Khulna',     N'Chittagong',   441),
(N'Barishal',   N'Khulna',       130),
(N'Comilla',    N'Chittagong',   100),
(N'Jessore',    N'Dhaka',        275),
(N'Jessore',    N'Khulna',        70),
(N'Faridpur',   N'Dhaka',        120),
(N'Tangail',    N'Dhaka',         93),
(N'Dhaka',      N'Jessore',      275),
(N'Dhaka',      N'Faridpur',     120),
(N'Dhaka',      N'Bogura',       196),
(N'Dhaka',      N'Dinajpur',     393),
(N'Dhaka',      N'Panchagarh',   480),
(N'Dhaka',      N'Tangail',       93)
) AS source (Origin, Destination, DistanceKM)
ON target.Origin = source.Origin AND target.Destination = source.Destination
WHEN NOT MATCHED THEN
    INSERT (Origin, Destination, DistanceKM, IsActive)
    VALUES (source.Origin, source.Destination, source.DistanceKM, 1);

PRINT '✅ Routes inserted/merged';

-- ─────────────────────────────────────────────
-- STEP 2: RouteStops table — intermediate stops
-- ─────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='RouteStops')
BEGIN
    CREATE TABLE RouteStops (
        StopID          INT IDENTITY(1,1) PRIMARY KEY,
        RouteID         INT NOT NULL REFERENCES Routes(RouteID),
        StopName        NVARCHAR(100) NOT NULL,
        StopOrder       INT NOT NULL,        -- 0 = origin, 99 = destination
        DistanceFromOrigin INT DEFAULT 0,    -- km
        MinutesFromOrigin  INT DEFAULT 0,    -- departure থেকে কত মিনিট পরে
        FareFromOrigin  INT DEFAULT 0,       -- এই stop পর্যন্ত fare
        IsPickupPoint   BIT DEFAULT 1,       -- এখান থেকে উঠা যাবে?
        IsDropPoint     BIT DEFAULT 1        -- এখানে নামা যাবে?
    );
    CREATE INDEX IX_RouteStops_Route ON RouteStops(RouteID, StopOrder);
    PRINT '✅ RouteStops table created';
END

-- ─────────────────────────────────────────────
-- STEP 3: Stops data insert
-- ─────────────────────────────────────────────

-- Helper function
DECLARE @r INT;

-- ── Dhaka → Chittagong stops ─────────────────
SET @r = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Dhaka' AND Destination=N'Chittagong');
IF @r IS NOT NULL AND NOT EXISTS (SELECT 1 FROM RouteStops WHERE RouteID=@r)
INSERT INTO RouteStops (RouteID,StopName,StopOrder,DistanceFromOrigin,MinutesFromOrigin,FareFromOrigin) VALUES
(@r,N'Dhaka (Sayedabad)',    0,   0,   0, 0),
(@r,N'Demra',                1,  18,  30, 80),
(@r,N'Narayanganj',          2,  24,  45, 120),
(@r,N'Comilla',              3,  90, 120, 280),
(@r,N'Feni',                 4, 148, 180, 420),
(@r,N'Chittagong (Dampara)', 5, 244, 330, 700);

-- ── Chittagong → Dhaka stops (reverse) ───────
SET @r = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Chittagong' AND Destination=N'Dhaka');
IF @r IS NOT NULL AND NOT EXISTS (SELECT 1 FROM RouteStops WHERE RouteID=@r)
INSERT INTO RouteStops (RouteID,StopName,StopOrder,DistanceFromOrigin,MinutesFromOrigin,FareFromOrigin) VALUES
(@r,N'Chittagong (Dampara)', 0,   0,   0, 0),
(@r,N'Feni',                 1,  96,  90, 200),
(@r,N'Comilla',              2, 154, 150, 380),
(@r,N'Narayanganj',          3, 220, 270, 560),
(@r,N'Dhaka (Sayedabad)',    4, 244, 330, 700);

-- ── Dhaka → Sylhet stops ─────────────────────
SET @r = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Dhaka' AND Destination=N'Sylhet');
IF @r IS NOT NULL AND NOT EXISTS (SELECT 1 FROM RouteStops WHERE RouteID=@r)
INSERT INTO RouteStops (RouteID,StopName,StopOrder,DistanceFromOrigin,MinutesFromOrigin,FareFromOrigin) VALUES
(@r,N'Dhaka (Syedabad)',     0,   0,   0, 0),
(@r,N'Narsingdi',            1,  55,  60, 150),
(@r,N'Brahmanbaria',         2,  98, 110, 260),
(@r,N'Habiganj',             3, 175, 195, 450),
(@r,N'Sylhet',               4, 244, 270, 600);

-- ── Dhaka → Rajshahi stops ───────────────────
SET @r = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Dhaka' AND Destination=N'Rajshahi');
IF @r IS NOT NULL AND NOT EXISTS (SELECT 1 FROM RouteStops WHERE RouteID=@r)
INSERT INTO RouteStops (RouteID,StopName,StopOrder,DistanceFromOrigin,MinutesFromOrigin,FareFromOrigin) VALUES
(@r,N'Dhaka (Gabtoli)',      0,   0,   0, 0),
(@r,N'Manikganj',            1,  48,  60, 140),
(@r,N'Sirajganj',            2, 136, 165, 340),
(@r,N'Natore',               3, 206, 250, 520),
(@r,N'Rajshahi',             4, 253, 330, 650);

-- ── Dhaka → Rangpur stops (★ Pirganj এখানে) ──
SET @r = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Dhaka' AND Destination=N'Rangpur');
IF @r IS NOT NULL AND NOT EXISTS (SELECT 1 FROM RouteStops WHERE RouteID=@r)
INSERT INTO RouteStops (RouteID,StopName,StopOrder,DistanceFromOrigin,MinutesFromOrigin,FareFromOrigin) VALUES
(@r,N'Dhaka (Gabtoli)',      0,   0,   0, 0),
(@r,N'Tangail',              1,  93,  90, 200),
(@r,N'Sirajganj',            2, 136, 140, 290),
(@r,N'Bogura',               3, 196, 200, 410),
(@r,N'Gobindaganj',          4, 242, 255, 510),
(@r,N'Palashbari',           5, 263, 275, 560),
(@r,N'Rangpur',              6, 300, 330, 750);

-- ── Rangpur → Dhaka stops (★ Pirganj এখানে) ──
SET @r = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Rangpur' AND Destination=N'Dhaka');
IF @r IS NOT NULL AND NOT EXISTS (SELECT 1 FROM RouteStops WHERE RouteID=@r)
INSERT INTO RouteStops (RouteID,StopName,StopOrder,DistanceFromOrigin,MinutesFromOrigin,FareFromOrigin) VALUES
(@r,N'Rangpur (Bus Terminal)', 0,   0,   0, 0),
(@r,N'Pirganj',                1,  38,  45, 120),  -- ★ Pirganj stop
(@r,N'Palashbari',             2,  52,  60, 160),
(@r,N'Gobindaganj',            3,  73,  80, 210),
(@r,N'Bogura',                 4, 119, 125, 330),
(@r,N'Sirajganj',              5, 179, 185, 450),
(@r,N'Tangail',                6, 222, 240, 560),
(@r,N'Dhaka (Gabtoli)',        7, 300, 330, 750);

-- ── Rangpur → Chittagong stops ───────────────
SET @r = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Rangpur' AND Destination=N'Chittagong');
IF @r IS NOT NULL AND NOT EXISTS (SELECT 1 FROM RouteStops WHERE RouteID=@r)
INSERT INTO RouteStops (RouteID,StopName,StopOrder,DistanceFromOrigin,MinutesFromOrigin,FareFromOrigin) VALUES
(@r,N'Rangpur (Bus Terminal)', 0,   0,   0, 0),
(@r,N'Bogura',                 1, 119, 120, 250),
(@r,N'Dhaka (Transit)',        2, 300, 330, 560),
(@r,N'Comilla',                3, 390, 450, 750),
(@r,N'Chittagong',             4, 554, 630,1050);

-- ── Panchagarh → Dhaka stops ─────────────────
SET @r = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Panchagarh' AND Destination=N'Dhaka');
IF @r IS NOT NULL AND NOT EXISTS (SELECT 1 FROM RouteStops WHERE RouteID=@r)
INSERT INTO RouteStops (RouteID,StopName,StopOrder,DistanceFromOrigin,MinutesFromOrigin,FareFromOrigin) VALUES
(@r,N'Panchagarh',             0,   0,   0, 0),
(@r,N'Tetulia',                1,  20,  25,  60),
(@r,N'Thakurgaon',             2,  48,  60, 140),
(@r,N'Dinajpur',               3, 101,  90, 230),
(@r,N'Rangpur',                4, 182, 150, 380),
(@r,N'Bogura',                 5, 301, 255, 570),
(@r,N'Dhaka (Gabtoli)',        6, 480, 420, 950);

-- ── Panchagarh → Rajshahi stops ──────────────
SET @r = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Panchagarh' AND Destination=N'Rajshahi');
IF @r IS NOT NULL AND NOT EXISTS (SELECT 1 FROM RouteStops WHERE RouteID=@r)
INSERT INTO RouteStops (RouteID,StopName,StopOrder,DistanceFromOrigin,MinutesFromOrigin,FareFromOrigin) VALUES
(@r,N'Panchagarh',             0,   0,   0, 0),
(@r,N'Thakurgaon',             1,  48,  55, 130),
(@r,N'Dinajpur',               2, 101, 115, 250),
(@r,N'Rangpur',                3, 182, 175, 380),
(@r,N'Natore',                 4, 233, 235, 480),
(@r,N'Rajshahi',               5, 272, 280, 580);

-- ── Dhaka → Khulna stops ─────────────────────
SET @r = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Dhaka' AND Destination=N'Khulna');
IF @r IS NOT NULL AND NOT EXISTS (SELECT 1 FROM RouteStops WHERE RouteID=@r)
INSERT INTO RouteStops (RouteID,StopName,StopOrder,DistanceFromOrigin,MinutesFromOrigin,FareFromOrigin) VALUES
(@r,N'Dhaka (Gabtoli)',        0,   0,   0, 0),
(@r,N'Faridpur',               1, 120, 120, 280),
(@r,N'Jessore',                2, 275, 280, 580),
(@r,N'Khulna',                 3, 278, 480, 850);

-- ── Dhaka → Cox''s Bazar stops ───────────────
SET @r = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Dhaka' AND Destination=N'Cox''s Bazar');
IF @r IS NOT NULL AND NOT EXISTS (SELECT 1 FROM RouteStops WHERE RouteID=@r)
INSERT INTO RouteStops (RouteID,StopName,StopOrder,DistanceFromOrigin,MinutesFromOrigin,FareFromOrigin) VALUES
(@r,N'Dhaka (Syedabad)',       0,   0,   0, 0),
(@r,N'Comilla',                1,  90,  90, 280),
(@r,N'Feni',                   2, 148, 150, 420),
(@r,N'Chittagong',             3, 244, 240, 680),
(@r,N'Chakaria',               4, 365, 360, 920),
(@r,N'Cox''s Bazar',           5, 414, 660,1100);

PRINT '✅ RouteStops data inserted';

-- ─────────────────────────────────────────────
-- STEP 4: Bookings table এ BoardingStop যোগ
-- ─────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Bookings') AND name='BoardingStop')
    ALTER TABLE Bookings ADD BoardingStop NVARCHAR(100) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Bookings') AND name='DroppingStop')
    ALTER TABLE Bookings ADD DroppingStop NVARCHAR(100) NULL;

PRINT '✅ Bookings.BoardingStop + DroppingStop added';
PRINT '';
PRINT '🎉 Done! Now passengers can search Pirganj→Dhaka';
PRINT '   and board the Rangpur→Dhaka bus from Pirganj.';
