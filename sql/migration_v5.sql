-- =============================================
-- SCTMS Migration v5
-- vw_BookingReport — RefCode + ScheduleID যোগ
-- =============================================

IF OBJECT_ID('vw_BookingReport', 'V') IS NOT NULL
    DROP VIEW vw_BookingReport;
GO

CREATE VIEW vw_BookingReport AS
SELECT
    b.BookingID,
    b.RefCode,
    b.SeatNumber,
    b.TotalFare,
    b.Status           AS BookingStatus,
    b.BookedAt,
    b.JourneyDate,
    b.ScheduleID,
    b.Rating,
    b.IsUsed,
    b.UsedAt,
    r.Origin,
    r.Destination,
    v.VehicleName,
    v.Type             AS VehicleType,
    s.DepartureTime,
    s.ArrivalTime,
    s.Fare             AS ScheduleFare,
    s.Status           AS TripStatus,
    u.FirstName + ' ' + u.LastName AS PassengerName,
    u.Email,
    u.Phone,
    p.Method           AS PaymentMethod,
    p.Status           AS PaymentStatus,
    p.TransactionRef
FROM Bookings b
JOIN Schedules s  ON b.ScheduleID = s.ScheduleID
JOIN Routes    r  ON s.RouteID    = r.RouteID
JOIN Vehicles  v  ON s.VehicleID  = v.VehicleID
JOIN Users     u  ON b.UserID     = u.UserID
LEFT JOIN Payments p ON b.BookingID = p.BookingID;
GO

PRINT '✅ vw_BookingReport recreated with RefCode, TripStatus, TransactionRef.';
