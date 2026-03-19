-- =============================================
-- SCTMS — Complete Bangladesh Transport Seed
-- Shohoj + RailSeba based realistic data
-- Routes, Vehicles (Bus+Train), Schedules
-- =============================================

USE SCTMS;
SET NOCOUNT ON;

-- ─────────────────────────────────────────────
-- STEP 1: ROUTES (সব major routes)
-- ─────────────────────────────────────────────
-- পুরনো test data মুছো (optional)
-- DELETE FROM Schedules; DELETE FROM Vehicles; DELETE FROM Routes;

MERGE Routes AS target
USING (VALUES
-- ── BUS ROUTES ──────────────────────────────
-- Dhaka থেকে
(N'Dhaka',      N'Chittagong',  244),
(N'Dhaka',      N'Sylhet',      244),
(N'Dhaka',      N'Rajshahi',    253),
(N'Dhaka',      N'Khulna',      278),
(N'Dhaka',      N'Barishal',    190),
(N'Dhaka',      N'Rangpur',     300),
(N'Dhaka',      N'Cox''s Bazar',414),
(N'Dhaka',      N'Mymensingh',   84),
(N'Dhaka',      N'Comilla',      90),
(N'Dhaka',      N'Tangail',      93),
-- Chittagong থেকে
(N'Chittagong', N'Cox''s Bazar',152),
(N'Chittagong', N'Sylhet',      323),
(N'Chittagong', N'Khulna',      441),
-- অন্যান্য
(N'Rajshahi',   N'Khulna',      175),
(N'Sylhet',     N'Mymensingh',  148),
(N'Rangpur',    N'Dhaka',       300)
) AS source (Origin, Destination, DistanceKM)
ON target.Origin = source.Origin AND target.Destination = source.Destination
WHEN NOT MATCHED THEN
    INSERT (Origin, Destination, DistanceKM, IsActive)
    VALUES (source.Origin, source.Destination, source.DistanceKM, 1);

PRINT '✅ Routes inserted: ' + CAST(@@ROWCOUNT AS NVARCHAR);

-- ─────────────────────────────────────────────
-- STEP 2: VEHICLES
-- ─────────────────────────────────────────────

-- পুরানো test vehicles মুছো যদি দরকার হয়
-- DELETE FROM Vehicles;

-- BUS — Shohoj based operators
INSERT INTO Vehicles (VehicleName, Type, TotalSeats, Amenities, IsActive)
SELECT v.VehicleName, v.Type, v.TotalSeats, v.Amenities, 1
FROM (VALUES
-- AC Bus
(N'Shyamoli NR Express', N'bus', 41, N'AC, WiFi, USB Charging, Recliner Seat'),
(N'Green Line Paribahan', N'bus', 41, N'AC, WiFi, USB Charging, Blanket'),
(N'Hanif Enterprise AC', N'bus', 41, N'AC, Snacks, USB Charging'),
(N'Ena Transport AC', N'bus', 41, N'AC, WiFi, Water Bottle'),
(N'S Alam Express AC', N'bus', 41, N'AC, USB Charging, Recliner Seat'),
(N'Royal Coach AC', N'bus', 41, N'AC, WiFi, Snacks, Blanket'),
(N'Soudia AC Service', N'bus', 41, N'AC, USB Charging, Water'),
(N'Nabil Paribahan AC', N'bus', 41, N'AC, Recliner, WiFi'),
-- Non-AC Bus
(N'Shyamoli Paribahan', N'bus', 52, N'Fan, Comfortable Seat'),
(N'Hanif Paribahan', N'bus', 52, N'Fan, Regular Seat'),
(N'Ena Transport', N'bus', 52, N'Fan, Regular Seat'),
(N'Saint Martin Express', N'bus', 52, N'Fan, Regular Seat'),
(N'TR Travels', N'bus', 52, N'Fan, Regular Seat'),
-- Sleeper / Chair Coach
(N'Green Line Sleeper', N'bus', 28, N'AC, Full Flat Seat, Curtain, Pillow'),
(N'Shyamoli Sleeper', N'bus', 28, N'AC, Semi-Sleeper, USB Charging'),
-- TRAIN — RailSeba based
-- Dhaka-Chittagong
(N'Subarna Express', N'train', 400, N'AC Chair, Dining Car, Luggage Van'),
(N'Turna Nishitha', N'train', 400, N'AC Chair, Food Service'),
(N'Mahanagar Godhuli', N'train', 500, N'Snigdha Chair, S_Chair, Shovon'),
(N'Mahanagar Provati', N'train', 500, N'Snigdha Chair, S_Chair, Shovon'),
(N'Chattala Express', N'train', 400, N'Shovon Chair, S_Chair'),
-- Dhaka-Sylhet
(N'Parabat Express', N'train', 400, N'AC Chair, Food Service, Snigdha'),
(N'Upaban Express', N'train', 400, N'Snigdha, S_Chair, Shovon'),
(N'Jayantika Express', N'train', 400, N'Snigdha, Shovon Chair'),
-- Dhaka-Rajshahi
(N'Silk City Express', N'train', 400, N'AC Chair, Snigdha, Food Service'),
(N'Padma Express', N'train', 500, N'Snigdha, S_Chair, Shovon'),
-- Dhaka-Khulna
(N'Sundarban Express', N'train', 400, N'AC Chair, Snigdha, Food Service'),
(N'Chitra Express', N'train', 500, N'Snigdha, S_Chair, Shovon'),
-- Dhaka-Rangpur
(N'Rangpur Express', N'train', 400, N'Snigdha, S_Chair, Shovon'),
(N'Lalmoni Express', N'train', 400, N'Snigdha, Shovon'),
-- Dhaka-Mymensingh
(N'Brahmaputra Express', N'train', 300, N'Shovon Chair, S_Chair'),
(N'Aggarwal Express', N'train', 300, N'Shovon Chair')
) AS v(VehicleName, Type, TotalSeats, Amenities)
WHERE NOT EXISTS (
    SELECT 1 FROM Vehicles WHERE VehicleName = v.VehicleName
);

PRINT '✅ Vehicles inserted';

-- ─────────────────────────────────────────────
-- STEP 3: SCHEDULES — আজ থেকে ৩০ দিন
-- Real timing based on Shohoj + RailSeba
-- ─────────────────────────────────────────────

-- Helper: vehicle ID গুলো variable এ রাখো
DECLARE @v_ShyamoliAC    INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Shyamoli NR Express');
DECLARE @v_GreenLineAC   INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Green Line Paribahan');
DECLARE @v_HanifAC       INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Hanif Enterprise AC');
DECLARE @v_EnaAC         INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Ena Transport AC');
DECLARE @v_SAlamAC       INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'S Alam Express AC');
DECLARE @v_RoyalAC       INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Royal Coach AC');
DECLARE @v_SoudiaAC      INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Soudia AC Service');
DECLARE @v_NabilAC       INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Nabil Paribahan AC');
DECLARE @v_ShyamoliNA   INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Shyamoli Paribahan');
DECLARE @v_HanifNA       INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Hanif Paribahan');
DECLARE @v_EnaNA         INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Ena Transport');
DECLARE @v_TRTravels     INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'TR Travels');
DECLARE @v_GreenSleeper  INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Green Line Sleeper');
DECLARE @v_ShyamoliSL   INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Shyamoli Sleeper');

DECLARE @t_Subarna       INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Subarna Express');
DECLARE @t_Turna         INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Turna Nishitha');
DECLARE @t_MhGodhuli     INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Mahanagar Godhuli');
DECLARE @t_MhProvati     INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Mahanagar Provati');
DECLARE @t_ChattalaExp   INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Chattala Express');
DECLARE @t_Parabat       INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Parabat Express');
DECLARE @t_Upaban        INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Upaban Express');
DECLARE @t_Jayantika     INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Jayantika Express');
DECLARE @t_SilkCity      INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Silk City Express');
DECLARE @t_Padma         INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Padma Express');
DECLARE @t_Sundarban     INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Sundarban Express');
DECLARE @t_Chitra        INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Chitra Express');
DECLARE @t_Rangpur       INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Rangpur Express');
DECLARE @t_Lalmoni       INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Lalmoni Express');
DECLARE @t_Brahmaputra   INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Brahmaputra Express');
DECLARE @t_Aggarwal      INT = (SELECT TOP 1 VehicleID FROM Vehicles WHERE VehicleName=N'Aggarwal Express');

-- Route IDs
DECLARE @r_DhkCtg    INT = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Dhaka'      AND Destination=N'Chittagong');
DECLARE @r_DhkSyl    INT = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Dhaka'      AND Destination=N'Sylhet');
DECLARE @r_DhkRaj    INT = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Dhaka'      AND Destination=N'Rajshahi');
DECLARE @r_DhkKhl    INT = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Dhaka'      AND Destination=N'Khulna');
DECLARE @r_DhkBar    INT = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Dhaka'      AND Destination=N'Barishal');
DECLARE @r_DhkRng    INT = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Dhaka'      AND Destination=N'Rangpur');
DECLARE @r_DhkCox    INT = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Dhaka'      AND Destination=N'Cox''s Bazar');
DECLARE @r_DhkMym    INT = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Dhaka'      AND Destination=N'Mymensingh');
DECLARE @r_DhkCom    INT = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Dhaka'      AND Destination=N'Comilla');
DECLARE @r_CtgCox    INT = (SELECT TOP 1 RouteID FROM Routes WHERE Origin=N'Chittagong' AND Destination=N'Cox''s Bazar');

-- ── Schedule insert helper table ────────────
-- RouteID, VehicleID, DepHH, DepMM, DurationMin, Fare, Seats
CREATE TABLE #sched_template (
    RouteID     INT,
    VehicleID   INT,
    DepHH       INT,
    DepMM       INT,
    DurationMin INT,
    Fare        INT,
    Seats       INT
);

-- ════════════════════════════════════════════
-- DHAKA → CHITTAGONG
-- Bus: ~5-6h, Train: 5-7h
-- ════════════════════════════════════════════
INSERT INTO #sched_template VALUES
-- BUS (Shohoj style)
(@r_DhkCtg, @v_ShyamoliAC,   7, 30, 330, 700,  41),  -- 07:30 → 13:00 AC
(@r_DhkCtg, @v_GreenLineAC,  8,  0, 330, 750,  41),  -- 08:00 → 13:30 AC
(@r_DhkCtg, @v_HanifAC,      9,  0, 330, 680,  41),  -- 09:00 → 14:30 AC
(@r_DhkCtg, @v_EnaAC,       10,  0, 330, 680,  41),  -- 10:00 → 15:30 AC
(@r_DhkCtg, @v_SAlamAC,     14,  0, 330, 700,  41),  -- 14:00 → 19:30 AC
(@r_DhkCtg, @v_RoyalAC,     20,  0, 330, 750,  41),  -- 20:00 → 01:30 AC Night
(@r_DhkCtg, @v_GreenSleeper,21,  0, 330, 900,  28),  -- 21:00 Sleeper
(@r_DhkCtg, @v_ShyamoliSL,  22,  0, 330, 850,  28),  -- 22:00 Sleeper
(@r_DhkCtg, @v_ShyamoliNA,   6,  0, 360, 450,  52),  -- 06:00 Non-AC
(@r_DhkCtg, @v_HanifNA,      6, 30, 360, 420,  52),  -- 06:30 Non-AC
(@r_DhkCtg, @v_EnaNA,       23,  0, 360, 420,  52),  -- 23:00 Non-AC Night
-- TRAIN (RailSeba style)
(@r_DhkCtg, @t_Subarna,      7,  0, 330, 590,  400), -- 07:00 Subarna (AC: 590)
(@r_DhkCtg, @t_MhProvati,    7, 45, 390, 265,  500), -- 07:45 Mahanagar Provati
(@r_DhkCtg, @t_Turna,       23,  0, 390, 590,  400), -- 23:00 Turna Nishitha (Night)
(@r_DhkCtg, @t_MhGodhuli,   15,  0, 390, 265,  500), -- 15:00 Mahanagar Godhuli
(@r_DhkCtg, @t_ChattalaExp, 16, 30, 420, 215,  400); -- 16:30 Chattala Express

-- ════════════════════════════════════════════
-- DHAKA → SYLHET
-- Bus: ~4-5h, Train: 6-7h
-- ════════════════════════════════════════════
INSERT INTO #sched_template VALUES
(@r_DhkSyl, @v_ShyamoliAC,   7,  0, 270, 600,  41),
(@r_DhkSyl, @v_GreenLineAC,  8,  0, 270, 650,  41),
(@r_DhkSyl, @v_EnaAC,        9,  0, 270, 580,  41),
(@r_DhkSyl, @v_SAlamAC,     14,  0, 270, 600,  41),
(@r_DhkSyl, @v_SoudiaAC,    20,  0, 270, 620,  41),
(@r_DhkSyl, @v_ShyamoliNA,   6, 30, 300, 380,  52),
(@r_DhkSyl, @v_HanifNA,     22,  0, 300, 360,  52),
(@r_DhkSyl, @t_Parabat,      6, 40, 390, 590,  400), -- 06:40 Parabat Express
(@r_DhkSyl, @t_Upaban,      10,  0, 420, 265,  400), -- 10:00 Upaban Express
(@r_DhkSyl, @t_Jayantika,   13, 45, 390, 295,  400); -- 13:45 Jayantika Express

-- ════════════════════════════════════════════
-- DHAKA → RAJSHAHI
-- Bus: ~5-6h, Train: 5-6h
-- ════════════════════════════════════════════
INSERT INTO #sched_template VALUES
(@r_DhkRaj, @v_ShyamoliAC,   7, 30, 330, 650,  41),
(@r_DhkRaj, @v_GreenLineAC,  9,  0, 330, 680,  41),
(@r_DhkRaj, @v_HanifAC,     14,  0, 330, 650,  41),
(@r_DhkRaj, @v_NabilAC,     22,  0, 330, 680,  41),
(@r_DhkRaj, @v_ShyamoliNA,   7,  0, 360, 380,  52),
(@r_DhkRaj, @v_EnaNA,       21, 30, 360, 360,  52),
(@r_DhkRaj, @t_SilkCity,     7, 40, 360, 590,  400), -- 07:40 Silk City Express
(@r_DhkRaj, @t_Padma,       11,  0, 360, 265,  500); -- 11:00 Padma Express

-- ════════════════════════════════════════════
-- DHAKA → KHULNA
-- Bus: ~7-8h, Train: 8-9h
-- ════════════════════════════════════════════
INSERT INTO #sched_template VALUES
(@r_DhkKhl, @v_ShyamoliAC,   8,  0, 480, 850,  41),
(@r_DhkKhl, @v_GreenLineAC,  9,  0, 480, 900,  41),
(@r_DhkKhl, @v_GreenSleeper, 21,  0, 480,1050,  28),
(@r_DhkKhl, @v_ShyamoliSL,  22,  0, 480, 980,  28),
(@r_DhkKhl, @v_ShyamoliNA,   7,  0, 510, 480,  52),
(@r_DhkKhl, @v_HanifNA,     20, 30, 510, 460,  52),
(@r_DhkKhl, @t_Sundarban,    6, 20, 540, 690,  400), -- 06:20 Sundarban Express
(@r_DhkKhl, @t_Chitra,       9,  0, 540, 315,  500); -- 09:00 Chitra Express

-- ════════════════════════════════════════════
-- DHAKA → BARISHAL
-- Bus: ~4-5h (via ferry ~7h), 
-- ════════════════════════════════════════════
INSERT INTO #sched_template VALUES
(@r_DhkBar, @v_EnaAC,         7, 30, 300, 600,  41),
(@r_DhkBar, @v_SAlamAC,       8,  0, 300, 620,  41),
(@r_DhkBar, @v_SoudiaAC,     20,  0, 300, 600,  41),
(@r_DhkBar, @v_ShyamoliNA,    7,  0, 330, 370,  52),
(@r_DhkBar, @v_HanifNA,      21,  0, 330, 350,  52);

-- ════════════════════════════════════════════
-- DHAKA → RANGPUR
-- Bus: ~6-7h, Train: 7-8h
-- ════════════════════════════════════════════
INSERT INTO #sched_template VALUES
(@r_DhkRng, @v_ShyamoliAC,   8,  0, 420, 750,  41),
(@r_DhkRng, @v_HanifAC,      9, 30, 420, 720,  41),
(@r_DhkRng, @v_NabilAC,     20,  0, 420, 750,  41),
(@r_DhkRng, @v_ShyamoliNA,   7, 30, 450, 420,  52),
(@r_DhkRng, @v_EnaNA,       21,  0, 450, 400,  52),
(@r_DhkRng, @t_Rangpur,      9,  0, 480, 390,  400), -- 09:00 Rangpur Express
(@r_DhkRng, @t_Lalmoni,     22,  0, 480, 340,  400); -- 22:00 Lalmoni Express

-- ════════════════════════════════════════════
-- DHAKA → COX'S BAZAR
-- Bus: ~10-12h (long haul)
-- ════════════════════════════════════════════
INSERT INTO #sched_template VALUES
(@r_DhkCox, @v_GreenLineAC,  20,  0, 660,1100,  41), -- 20:00 → 07:00 Night AC
(@r_DhkCox, @v_SAlamAC,      21,  0, 660,1050,  41),
(@r_DhkCox, @v_GreenSleeper, 20, 30, 660,1350,  28), -- Sleeper
(@r_DhkCox, @v_ShyamoliSL,  21, 30, 660,1280,  28),
(@r_DhkCox, @v_ShyamoliNA,   9,  0, 720, 650,  52), -- Day bus
(@r_DhkCox, @v_TRTravels,   21,  0, 720, 580,  52);

-- ════════════════════════════════════════════
-- DHAKA → MYMENSINGH
-- Bus: ~2h, Train: ~2.5h
-- ════════════════════════════════════════════
INSERT INTO #sched_template VALUES
(@r_DhkMym, @v_EnaAC,         7,  0, 120, 280,  41),
(@r_DhkMym, @v_EnaAC,         9,  0, 120, 280,  41),
(@r_DhkMym, @v_EnaAC,        12,  0, 120, 280,  41),
(@r_DhkMym, @v_EnaAC,        15,  0, 120, 280,  41),
(@r_DhkMym, @v_EnaAC,        18,  0, 120, 280,  41),
(@r_DhkMym, @v_EnaNA,         7, 30, 130, 180,  52),
(@r_DhkMym, @v_EnaNA,        14,  0, 130, 180,  52),
(@r_DhkMym, @t_Brahmaputra,   7, 30, 150, 135,  300), -- Brahmaputra Express
(@r_DhkMym, @t_Aggarwal,     14,  0, 150, 115,  300); -- Aggarwal Express

-- ════════════════════════════════════════════
-- DHAKA → COMILLA
-- Bus: ~2h
-- ════════════════════════════════════════════
INSERT INTO #sched_template VALUES
(@r_DhkCom, @v_EnaAC,         7,  0,  90, 250,  41),
(@r_DhkCom, @v_HanifAC,       9,  0,  90, 250,  41),
(@r_DhkCom, @v_EnaAC,        13,  0,  90, 250,  41),
(@r_DhkCom, @v_HanifAC,      17,  0,  90, 250,  41),
(@r_DhkCom, @v_EnaNA,         6, 30, 100, 160,  52),
(@r_DhkCom, @v_HanifNA,      16,  0, 100, 150,  52);

-- ════════════════════════════════════════════
-- CHITTAGONG → COX'S BAZAR
-- Bus: ~3h
-- ════════════════════════════════════════════
INSERT INTO #sched_template VALUES
(@r_CtgCox, @v_EnaAC,         7,  0, 180, 450,  41),
(@r_CtgCox, @v_SAlamAC,       9,  0, 180, 450,  41),
(@r_CtgCox, @v_GreenLineAC,  12,  0, 180, 480,  41),
(@r_CtgCox, @v_SAlamAC,      14,  0, 180, 450,  41),
(@r_CtgCox, @v_EnaAC,        17,  0, 180, 450,  41),
(@r_CtgCox, @v_EnaNA,         6, 30, 200, 280,  52),
(@r_CtgCox, @v_HanifNA,      13,  0, 200, 260,  52),
(@r_CtgCox, @v_TRTravels,    20,  0, 200, 260,  52);

-- ─────────────────────────────────────────────
-- STEP 4: Schedule generate — আজ থেকে ৩০ দিন
-- ─────────────────────────────────────────────
DECLARE @day       INT  = 0;   -- আজকেও include
DECLARE @maxDays   INT  = 30;
DECLARE @inserted  INT  = 0;

DECLARE @routeID   INT;
DECLARE @vehicleID INT;
DECLARE @depHH     INT;
DECLARE @depMM     INT;
DECLARE @durMin    INT;
DECLARE @fare      INT;
DECLARE @seats     INT;
DECLARE @jDate     DATE;
DECLARE @depTime   DATETIME;
DECLARE @arrTime   DATETIME;

WHILE @day <= @maxDays
BEGIN
    SET @jDate = DATEADD(DAY, @day, CAST(GETDATE() AS DATE));

    DECLARE sched_cur CURSOR LOCAL FAST_FORWARD FOR
        SELECT RouteID, VehicleID, DepHH, DepMM, DurationMin, Fare, Seats
        FROM #sched_template
        WHERE RouteID IS NOT NULL AND VehicleID IS NOT NULL;

    OPEN sched_cur;
    FETCH NEXT FROM sched_cur INTO @routeID,@vehicleID,@depHH,@depMM,@durMin,@fare,@seats;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM Schedules
            WHERE RouteID    = @routeID
              AND VehicleID  = @vehicleID
              AND JourneyDate = @jDate
              AND DATEPART(HOUR,   DepartureTime) = @depHH
              AND DATEPART(MINUTE, DepartureTime) = @depMM
              AND Status != 'cancelled'
        )
        BEGIN
            SET @depTime = DATEADD(MINUTE, @depMM,
                           DATEADD(HOUR,   @depHH,
                           CAST(@jDate AS DATETIME)));
            SET @arrTime = DATEADD(MINUTE, @durMin, @depTime);

            INSERT INTO Schedules
                (RouteID, VehicleID, DepartureTime, ArrivalTime,
                 JourneyDate, Fare, AvailableSeats, Status)
            VALUES
                (@routeID, @vehicleID, @depTime, @arrTime,
                 @jDate, @fare, @seats, 'scheduled');

            SET @inserted = @inserted + 1;
        END

        FETCH NEXT FROM sched_cur INTO @routeID,@vehicleID,@depHH,@depMM,@durMin,@fare,@seats;
    END

    CLOSE sched_cur;
    DEALLOCATE sched_cur;

    SET @day = @day + 1;
END

DROP TABLE #sched_template;

PRINT '';
PRINT '════════════════════════════════════════';
PRINT '✅ SCTMS Seed Complete!';
PRINT '   Schedules inserted: ' + CAST(@inserted AS NVARCHAR);
PRINT '   Coverage: Today → +30 days';
PRINT '   Routes:   Dhaka-Ctg, Sylhet, Rajshahi,';
PRINT '             Khulna, Barishal, Rangpur,';
PRINT '             Cox''s Bazar, Mymensingh, Comilla';
PRINT '             Chittagong-Cox''s Bazar';
PRINT '   Bus:      Shyamoli, Green Line, Hanif,';
PRINT '             Ena, S Alam, Royal, Soudia';
PRINT '   Train:    Subarna, Turna, Parabat,';
PRINT '             Silk City, Sundarban, Rangpur...';
PRINT '════════════════════════════════════════';
