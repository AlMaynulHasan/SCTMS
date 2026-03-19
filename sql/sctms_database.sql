-- ============================================
-- SMART CITY TRANSPORT MANAGEMENT SYSTEM
-- SQL Server Database Schema
-- ============================================

-- STEP 1: Create the Database
CREATE DATABASE SCTMS;
GO
USE SCTMS;
GO

-- ============================================
-- TABLE 1: USERS (Passengers + Admin + Staff)
-- ============================================
CREATE TABLE Users (
    UserID      INT PRIMARY KEY IDENTITY(1,1),
    FirstName   NVARCHAR(50) NOT NULL,
    LastName    NVARCHAR(50) NOT NULL,
    Email       NVARCHAR(100) NOT NULL UNIQUE,
    Phone       NVARCHAR(20),
    Password    NVARCHAR(255) NOT NULL,  -- store hashed password
    NID         NVARCHAR(20),
    Gender      NVARCHAR(10),
    DOB         DATE,
    District    NVARCHAR(50),
    Address     NVARCHAR(200),
    Role        NVARCHAR(10) NOT NULL DEFAULT 'passenger'
                    CHECK (Role IN ('passenger', 'staff', 'admin')),
    CreatedAt   DATETIME DEFAULT GETDATE(),
    IsActive    BIT DEFAULT 1
);
GO

-- ============================================
-- TABLE 2: VEHICLES
-- ============================================
CREATE TABLE Vehicles (
    VehicleID   INT PRIMARY KEY IDENTITY(1,1),
    VehicleName NVARCHAR(100) NOT NULL,
    Type        NVARCHAR(10) NOT NULL CHECK (Type IN ('bus', 'train')),
    TotalSeats  INT NOT NULL,
    Amenities   NVARCHAR(200),  -- e.g. 'AC, WiFi, Charging Port'
    IsActive    BIT DEFAULT 1
);
GO

-- ============================================
-- TABLE 3: ROUTES
-- ============================================
CREATE TABLE Routes (
    RouteID     INT PRIMARY KEY IDENTITY(1,1),
    Origin      NVARCHAR(100) NOT NULL,
    Destination NVARCHAR(100) NOT NULL,
    DistanceKM  DECIMAL(8,2),
    IsActive    BIT DEFAULT 1
);
GO

-- ============================================
-- TABLE 4: SCHEDULES
-- ============================================
CREATE TABLE Schedules (
    ScheduleID      INT PRIMARY KEY IDENTITY(1,1),
    RouteID         INT NOT NULL FOREIGN KEY REFERENCES Routes(RouteID),
    VehicleID       INT NOT NULL FOREIGN KEY REFERENCES Vehicles(VehicleID),
    DepartureTime   TIME NOT NULL,
    ArrivalTime     TIME NOT NULL,
    JourneyDate     DATE NOT NULL,
    Fare            DECIMAL(10,2) NOT NULL,
    AvailableSeats  INT NOT NULL,
    Status          NVARCHAR(20) DEFAULT 'scheduled'
                        CHECK (Status IN ('scheduled','departed','arrived','cancelled')),
    CreatedAt       DATETIME DEFAULT GETDATE()
);
GO

-- ============================================
-- TABLE 5: BOOKINGS
-- ============================================
CREATE TABLE Bookings (
    BookingID   INT PRIMARY KEY IDENTITY(1,1),
    UserID      INT NOT NULL FOREIGN KEY REFERENCES Users(UserID),
    ScheduleID  INT NOT NULL FOREIGN KEY REFERENCES Schedules(ScheduleID),
    SeatNumber  NVARCHAR(10) NOT NULL,
    TotalFare   DECIMAL(10,2) NOT NULL,
    Status      NVARCHAR(20) DEFAULT 'confirmed'
                    CHECK (Status IN ('confirmed','cancelled','completed','exchanged')),
    BookedAt    DATETIME DEFAULT GETDATE(),

    -- Prevent same seat being booked twice on same schedule
    CONSTRAINT UQ_Seat_Schedule UNIQUE (ScheduleID, SeatNumber)
);
GO

-- ============================================
-- TABLE 6: TICKET EXCHANGE
-- ============================================
CREATE TABLE TicketExchange (
    ExchangeID      INT PRIMARY KEY IDENTITY(1,1),
    RequesterID     INT NOT NULL FOREIGN KEY REFERENCES Users(UserID),
    ReceiverID      INT NOT NULL FOREIGN KEY REFERENCES Users(UserID),
    BookingID_From  INT NOT NULL FOREIGN KEY REFERENCES Bookings(BookingID),
    BookingID_To    INT NOT NULL FOREIGN KEY REFERENCES Bookings(BookingID),
    Status          NVARCHAR(20) DEFAULT 'pending'
                        CHECK (Status IN ('pending','approved','rejected')),
    RequestedAt     DATETIME DEFAULT GETDATE(),
    ResolvedAt      DATETIME,
    AdminNote       NVARCHAR(300)
);
GO

-- ============================================
-- TABLE 7: PAYMENTS
-- ============================================
CREATE TABLE Payments (
    PaymentID   INT PRIMARY KEY IDENTITY(1,1),
    BookingID   INT NOT NULL FOREIGN KEY REFERENCES Bookings(BookingID),
    UserID      INT NOT NULL FOREIGN KEY REFERENCES Users(UserID),
    Amount      DECIMAL(10,2) NOT NULL,
    Method      NVARCHAR(20) DEFAULT 'bkash'
                    CHECK (Method IN ('bkash','nagad','card','cash')),
    Status      NVARCHAR(20) DEFAULT 'paid'
                    CHECK (Status IN ('paid','refunded','pending')),
    PaidAt      DATETIME DEFAULT GETDATE()
);
GO

-- ============================================
-- TRIGGER: Auto-decrease AvailableSeats on Booking
-- ============================================
CREATE TRIGGER trg_DecreaseSeats
ON Bookings
AFTER INSERT
AS
BEGIN
    UPDATE Schedules
    SET AvailableSeats = AvailableSeats - 1
    WHERE ScheduleID IN (SELECT ScheduleID FROM inserted)
    AND AvailableSeats > 0;
END;
GO

-- ============================================
-- TRIGGER: Auto-increase AvailableSeats on Cancellation
-- ============================================
CREATE TRIGGER trg_IncreaseSeats
ON Bookings
AFTER UPDATE
AS
BEGIN
    IF UPDATE(Status)
    BEGIN
        UPDATE Schedules
        SET AvailableSeats = AvailableSeats + 1
        WHERE ScheduleID IN (
            SELECT i.ScheduleID FROM inserted i
            JOIN deleted d ON i.BookingID = d.BookingID
            WHERE i.Status = 'cancelled' AND d.Status != 'cancelled'
        );
    END
END;
GO

-- ============================================
-- STORED PROCEDURE: Book a Ticket (with Transaction)
-- ============================================
CREATE PROCEDURE sp_BookTicket
    @UserID     INT,
    @ScheduleID INT,
    @SeatNumber NVARCHAR(10),
    @TotalFare  DECIMAL(10,2),
    @Method     NVARCHAR(20) = 'bkash'
AS
BEGIN
    BEGIN TRANSACTION;
    BEGIN TRY
        -- Check seat availability
        IF (SELECT AvailableSeats FROM Schedules WHERE ScheduleID = @ScheduleID) <= 0
        BEGIN
            ROLLBACK;
            RAISERROR('No seats available', 16, 1);
            RETURN;
        END

        -- Check seat not already taken
        IF EXISTS (
            SELECT 1 FROM Bookings
            WHERE ScheduleID = @ScheduleID
            AND SeatNumber = @SeatNumber
            AND Status != 'cancelled'
        )
        BEGIN
            ROLLBACK;
            RAISERROR('Seat already taken', 16, 1);
            RETURN;
        END

        -- Insert booking
        INSERT INTO Bookings (UserID, ScheduleID, SeatNumber, TotalFare)
        VALUES (@UserID, @ScheduleID, @SeatNumber, @TotalFare);

        DECLARE @BookingID INT = SCOPE_IDENTITY();

        -- Insert payment record
        INSERT INTO Payments (BookingID, UserID, Amount, Method)
        VALUES (@BookingID, @UserID, @TotalFare, @Method);

        COMMIT;
        SELECT @BookingID AS BookingID, 'success' AS Result;
    END TRY
    BEGIN CATCH
        ROLLBACK;
        THROW;
    END CATCH
END;
GO

-- ============================================
-- STORED PROCEDURE: Cancel a Booking
-- ============================================
CREATE PROCEDURE sp_CancelBooking
    @BookingID INT,
    @UserID    INT
AS
BEGIN
    BEGIN TRANSACTION;
    BEGIN TRY
        -- Check booking belongs to user
        IF NOT EXISTS (
            SELECT 1 FROM Bookings
            WHERE BookingID = @BookingID AND UserID = @UserID AND Status = 'confirmed'
        )
        BEGIN
            ROLLBACK;
            RAISERROR('Booking not found or already cancelled', 16, 1);
            RETURN;
        END

        UPDATE Bookings SET Status = 'cancelled' WHERE BookingID = @BookingID;
        UPDATE Payments SET Status = 'refunded' WHERE BookingID = @BookingID;

        COMMIT;
        SELECT 'cancelled' AS Result;
    END TRY
    BEGIN CATCH
        ROLLBACK;
        THROW;
    END CATCH
END;
GO

-- ============================================
-- VIEW: Available Schedules (for search)
-- ============================================
CREATE VIEW vw_AvailableSchedules AS
SELECT
    s.ScheduleID,
    r.Origin,
    r.Destination,
    v.VehicleName,
    v.Type AS VehicleType,
    v.Amenities,
    s.DepartureTime,
    s.ArrivalTime,
    s.JourneyDate,
    s.Fare,
    s.AvailableSeats,
    s.Status
FROM Schedules s
JOIN Routes r ON s.RouteID = r.RouteID
JOIN Vehicles v ON s.VehicleID = v.VehicleID
WHERE s.AvailableSeats > 0
AND s.Status = 'scheduled'
AND s.JourneyDate >= CAST(GETDATE() AS DATE);
GO

-- ============================================
-- VIEW: Admin Booking Report
-- ============================================
CREATE VIEW vw_BookingReport AS
SELECT
    b.BookingID,
    u.FirstName + ' ' + u.LastName AS PassengerName,
    u.Email,
    u.Phone,
    r.Origin,
    r.Destination,
    v.VehicleName,
    v.Type AS VehicleType,
    s.JourneyDate,
    s.DepartureTime,
    b.SeatNumber,
    b.TotalFare,
    b.Status AS BookingStatus,
    p.Method AS PaymentMethod,
    p.Status AS PaymentStatus,
    b.BookedAt
FROM Bookings b
JOIN Users u ON b.UserID = u.UserID
JOIN Schedules s ON b.ScheduleID = s.ScheduleID
JOIN Routes r ON s.RouteID = r.RouteID
JOIN Vehicles v ON s.VehicleID = v.VehicleID
LEFT JOIN Payments p ON b.BookingID = p.BookingID;
GO

-- ============================================
-- SAMPLE DATA
-- ============================================

-- Insert Users (password = bcrypt hash of "pass123")
INSERT INTO Users (FirstName, LastName, Email, Phone, Password, Role, District)
VALUES
('Admin',   'SCTMS',   'admin@sctms.com',     '01700000000', '$2b$10$examplehashadmin',   'admin',     'Dhaka'),
('Staff',   'Member',  'staff@sctms.com',     '01700000001', '$2b$10$examplehashstaff',   'staff',     'Dhaka'),
('Rahim',   'Hossain', 'passenger@sctms.com', '01711111111', '$2b$10$examplehashpass',    'passenger', 'Dhaka'),
('Farida',  'Begum',   'farida@gmail.com',    '01722222222', '$2b$10$examplehashpass',    'passenger', 'Chittagong'),
('Karim',   'Ahmed',   'karim@gmail.com',     '01733333333', '$2b$10$examplehashpass',    'passenger', 'Sylhet');
GO

-- Insert Vehicles
INSERT INTO Vehicles (VehicleName, Type, TotalSeats, Amenities) VALUES
('Subarna Express',       'train', 400, 'AC, Recliner, Charging Port, Meal'),
('Mahanagar Provati',     'train', 350, 'AC, Standard Seat'),
('Padma Express',         'train', 380, 'AC, Recliner'),
('Green Line Paribahan',  'bus',    45, 'AC, Luxury Seat, WiFi'),
('Shyamoli Paribahan',    'bus',    40, 'AC, Standard Seat'),
('Ena Transport',         'bus',    45, 'AC, Recliner, Charging Port');
GO

-- Insert Routes
INSERT INTO Routes (Origin, Destination, DistanceKM) VALUES
('Dhaka', 'Chittagong', 244),
('Chittagong', 'Dhaka', 244),
('Dhaka', 'Sylhet', 243),
('Sylhet', 'Dhaka', 243),
('Dhaka', 'Rajshahi', 262),
('Rajshahi', 'Dhaka', 262),
('Dhaka', 'Khulna', 333),
('Khulna', 'Dhaka', 333);
GO

-- Insert Schedules
INSERT INTO Schedules (RouteID, VehicleID, DepartureTime, ArrivalTime, JourneyDate, Fare, AvailableSeats) VALUES
(1, 1, '06:30', '12:45', '2026-02-28', 480.00, 24),
(1, 4, '08:00', '13:30', '2026-02-28', 650.00, 5),
(1, 2, '07:40', '14:25', '2026-02-28', 320.00, 0),
(3, 5, '09:00', '16:30', '2026-02-28', 650.00, 30),
(5, 3, '07:40', '13:15', '2026-02-28', 350.00, 18),
(7, 6, '06:20', '11:40', '2026-02-28', 420.00, 22);
GO
