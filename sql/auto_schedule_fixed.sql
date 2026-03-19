-- =============================================
-- SCTMS — Auto Schedule Generator (Fixed)
-- Column names auto-detect করে
-- =============================================

USE SCTMS;
GO

CREATE OR ALTER PROCEDURE sp_GenerateNext14DaysSchedules
AS
BEGIN
    SET NOCOUNT ON;

    -- ── Column names detect করো ──────────────
    DECLARE @fareCol     NVARCHAR(50);
    DECLARE @durationCol NVARCHAR(50);

    -- Routes table এ কোন fare column আছে?
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_NAME='Routes' AND COLUMN_NAME='BaseFare')
        SET @fareCol = 'BaseFare';
    ELSE IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME='Routes' AND COLUMN_NAME='Fare')
        SET @fareCol = 'Fare';
    ELSE
        SET @fareCol = NULL;

    -- Routes table এ duration column আছে?
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_NAME='Routes' AND COLUMN_NAME='EstimatedDuration')
        SET @durationCol = 'EstimatedDuration';
    ELSE IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME='Routes' AND COLUMN_NAME='Duration')
        SET @durationCol = 'Duration';
    ELSE
        SET @durationCol = NULL;

    -- ── Temp table — Routes data ──────────────
    CREATE TABLE #routes (
        RouteID    INT,
        BaseFare   DECIMAL(10,2),
        DurationMin INT   -- minutes
    );

    DECLARE @sql NVARCHAR(500);
    SET @sql = N'INSERT INTO #routes SELECT RouteID, ' +
        ISNULL('ISNULL(CAST(' + @fareCol + ' AS DECIMAL(10,2)), 500)', '500') +
        ', ' +
        ISNULL('ISNULL(CAST(' + @durationCol + ' AS INT) * 60, 360)', '360') +
        ' FROM Routes WHERE IsActive = 1';
    EXEC sp_executesql @sql;

    -- ── Variables ────────────────────────────
    DECLARE @generated  INT = 0;
    DECLARE @skipped    INT = 0;
    DECLARE @i          INT = 1;
    DECLARE @targetDate DATE;
    DECLARE @routeID    INT;
    DECLARE @vehicleID  INT;
    DECLARE @totalSeats INT;
    DECLARE @baseFare   DECIMAL(10,2);
    DECLARE @duration   INT;
    DECLARE @depTime    DATETIME;
    DECLARE @arrTime    DATETIME;
    DECLARE @fare       DECIMAL(10,2);

    -- ── Time slots: সকাল, দুপুর, রাত ──────────
    CREATE TABLE #slots (
        DepartHour INT, DepartMin INT, FareMult DECIMAL(4,2)
    );
    INSERT INTO #slots VALUES
        (7,  0, 1.00),
        (14, 0, 1.00),
        (22, 0, 0.90);

    -- ── Day loop: আজ+1 থেকে আজ+14 ───────────
    WHILE @i <= 14
    BEGIN
        SET @targetDate = DATEADD(DAY, @i, CAST(GETDATE() AS DATE));

        -- Route loop
        DECLARE route_cur CURSOR LOCAL FAST_FORWARD FOR
            SELECT r.RouteID, rt.BaseFare, rt.DurationMin
            FROM Routes r
            JOIN #routes rt ON rt.RouteID = r.RouteID
            WHERE r.IsActive = 1;

        OPEN route_cur;
        FETCH NEXT FROM route_cur INTO @routeID, @baseFare, @duration;

        WHILE @@FETCH_STATUS = 0
        BEGIN
            -- Vehicle বেছে নাও (RouteID দিয়ে rotate)
            SELECT TOP 1
                @vehicleID  = v.VehicleID,
                @totalSeats = v.TotalSeats
            FROM Vehicles v
            WHERE v.IsActive = 1
            ORDER BY (v.VehicleID + @routeID) % 
                     NULLIF((SELECT COUNT(*) FROM Vehicles WHERE IsActive=1), 0),
                     v.VehicleID;

            -- Slot loop
            DECLARE slot_cur CURSOR LOCAL FAST_FORWARD FOR
                SELECT DepartHour, DepartMin, FareMult FROM #slots;

            OPEN slot_cur;

            DECLARE @dh INT, @dm INT, @fm DECIMAL(4,2);
            FETCH NEXT FROM slot_cur INTO @dh, @dm, @fm;

            WHILE @@FETCH_STATUS = 0
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM Schedules s
                    WHERE s.RouteID     = @routeID
                      AND s.JourneyDate = @targetDate
                      AND DATEPART(HOUR, s.DepartureTime) = @dh
                      AND s.Status     != 'cancelled'
                )
                BEGIN
                    SET @depTime = DATEADD(MINUTE, @dm,
                                   DATEADD(HOUR,   @dh,
                                   CAST(@targetDate AS DATETIME)));
                    SET @arrTime = DATEADD(MINUTE, @duration, @depTime);
                    SET @fare    = ROUND(@baseFare * @fm, -1);

                    INSERT INTO Schedules
                        (RouteID, VehicleID, DepartureTime, ArrivalTime,
                         JourneyDate, Fare, AvailableSeats, Status)
                    VALUES
                        (@routeID, @vehicleID, @depTime, @arrTime,
                         @targetDate, @fare, @totalSeats, 'scheduled');

                    SET @generated = @generated + 1;
                END
                ELSE
                    SET @skipped = @skipped + 1;

                FETCH NEXT FROM slot_cur INTO @dh, @dm, @fm;
            END

            CLOSE slot_cur; DEALLOCATE slot_cur;
            FETCH NEXT FROM route_cur INTO @routeID, @baseFare, @duration;
        END

        CLOSE route_cur; DEALLOCATE route_cur;
        SET @i = @i + 1;
    END

    DROP TABLE #routes;
    DROP TABLE #slots;

    -- Result
    SELECT
        @generated AS SchedulesCreated,
        @skipped   AS AlreadyExisted,
        DATEADD(DAY, 1,  CAST(GETDATE() AS DATE)) AS CoverageFrom,
        DATEADD(DAY, 14, CAST(GETDATE() AS DATE)) AS CoverageTo;

    PRINT '✅ Done! Created: ' + CAST(@generated AS NVARCHAR)
        + ', Skipped: ' + CAST(@skipped AS NVARCHAR);
END;
GO

-- ── এখনই run করো ─────────────────────────────
EXEC sp_GenerateNext14DaysSchedules;
GO

-- ─────────────────────────────────────────────
-- SQL Server Agent Job
-- (Agent চালু থাকলে এটাও run করুন)
-- ─────────────────────────────────────────────
USE msdb;
GO

IF EXISTS (SELECT 1 FROM msdb.dbo.sysjobs WHERE name='SCTMS_AutoSchedule_14Day')
    EXEC sp_delete_job @job_name='SCTMS_AutoSchedule_14Day';
GO

EXEC sp_add_job
    @job_name    = 'SCTMS_AutoSchedule_14Day',
    @description = 'প্রতি ১৪ দিনে পরের ১৪ দিনের schedule auto-generate করে',
    @enabled     = 1;

EXEC sp_add_jobstep
    @job_name      = 'SCTMS_AutoSchedule_14Day',
    @step_name     = 'Generate Schedules',
    @command       = 'USE SCTMS; EXEC sp_GenerateNext14DaysSchedules;',
    @database_name = 'SCTMS';

EXEC sp_add_schedule
    @schedule_name     = 'Every14Days_Midnight',
    @freq_type         = 4,
    @freq_interval     = 14,
    @active_start_time = 000100;

EXEC sp_attach_schedule
    @job_name      = 'SCTMS_AutoSchedule_14Day',
    @schedule_name = 'Every14Days_Midnight';

EXEC sp_add_jobserver
    @job_name = 'SCTMS_AutoSchedule_14Day';
GO

PRINT '✅ Agent Job created.';
GO
