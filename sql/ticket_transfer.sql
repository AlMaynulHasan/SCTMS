USE SCTMS;
GO

-- TicketListings: passenger posts ticket as available
CREATE TABLE TicketListings (
    ListingID     INT IDENTITY(1,1) PRIMARY KEY,
    BookingID     INT NOT NULL UNIQUE,          -- one listing per booking
    SellerID      INT NOT NULL,                 -- original ticket owner
    AskingPrice   DECIMAL(10,2) NOT NULL,       -- can be same or lower than original fare
    Status        NVARCHAR(20) DEFAULT 'open'   -- open | reserved | transferred | cancelled
        CHECK (Status IN ('open','reserved','transferred','cancelled')),
    ListedAt      DATETIME DEFAULT GETDATE(),
    ExpiresAt     DATETIME,                     -- auto-expire if no taker
    FOREIGN KEY (BookingID) REFERENCES Bookings(BookingID),
    FOREIGN KEY (SellerID)  REFERENCES Users(UserID)
);
GO

-- TicketTransfers: buyer requests & payment tracked
CREATE TABLE TicketTransfers (
    TransferID      INT IDENTITY(1,1) PRIMARY KEY,
    ListingID       INT NOT NULL,
    BuyerID         INT NOT NULL,
    PaymentRef      NVARCHAR(100),              -- bKash/payment ref
    PaymentStatus   NVARCHAR(20) DEFAULT 'pending'
        CHECK (PaymentStatus IN ('pending','paid','failed')),
    TransferStatus  NVARCHAR(20) DEFAULT 'pending'
        CHECK (TransferStatus IN ('pending','completed','failed','cancelled')),
    RequestedAt     DATETIME DEFAULT GETDATE(),
    CompletedAt     DATETIME,
    FOREIGN KEY (ListingID) REFERENCES TicketListings(ListingID),
    FOREIGN KEY (BuyerID)   REFERENCES Users(UserID)
);
GO

-- Prevent double transfer: only one completed transfer per listing
CREATE UNIQUE INDEX UX_OneTransferPerListing
    ON TicketTransfers(ListingID)
    WHERE TransferStatus = 'completed';
GO

-- Prevent same user buying their own ticket (trigger)
CREATE TRIGGER trg_NoSelfTransfer
ON TicketTransfers
AFTER INSERT
AS
BEGIN
    IF EXISTS (
        SELECT 1 FROM inserted i
        JOIN TicketListings l ON l.ListingID = i.ListingID
        WHERE l.SellerID = i.BuyerID
    )
    BEGIN
        ROLLBACK;
        RAISERROR('নিজের ticket নিজে কিনতে পারবেন না।', 16, 1);
    END
END
GO

-- Prevent listing if booking already transferred or cancelled
CREATE TRIGGER trg_NoListingForInvalidBooking
ON TicketListings
AFTER INSERT
AS
BEGIN
    IF EXISTS (
        SELECT 1 FROM inserted i
        JOIN Bookings b ON b.BookingID = i.BookingID
        WHERE b.BookingStatus NOT IN ('confirmed')
    )
    BEGIN
        ROLLBACK;
        RAISERROR('শুধুমাত্র confirmed booking list করা যাবে।', 16, 1);
    END
END
GO

-- View: marketplace listings with full details
CREATE VIEW vw_TicketMarketplace AS
SELECT
    l.ListingID,
    l.BookingID,
    l.AskingPrice,
    l.Status        AS ListingStatus,
    l.ListedAt,
    l.ExpiresAt,
    b.JourneyDate,
    b.SeatNumber,
    b.TotalFare     AS OriginalFare,
    b.BookingStatus,
    s.Origin,
    s.Destination,
    s.DepartureTime,
    s.ArrivalTime,
    v.VehicleName,
    v.VehicleType,
    v.Amenities,
    u.FirstName + ' ' + u.LastName AS SellerName,
    l.SellerID
FROM TicketListings l
JOIN Bookings  b ON b.BookingID  = l.BookingID
JOIN Schedules s ON s.ScheduleID = b.ScheduleID
JOIN Vehicles  v ON v.VehicleID  = s.VehicleID
JOIN Users     u ON u.UserID     = l.SellerID;
GO

-- View: transfer history
CREATE VIEW vw_TransferHistory AS
SELECT
    t.TransferID,
    t.ListingID,
    t.PaymentRef,
    t.PaymentStatus,
    t.TransferStatus,
    t.RequestedAt,
    t.CompletedAt,
    l.BookingID,
    l.AskingPrice,
    b.SeatNumber,
    b.JourneyDate,
    s.Origin,
    s.Destination,
    v.VehicleName,
    seller.FirstName + ' ' + seller.LastName AS SellerName,
    buyer.FirstName  + ' ' + buyer.LastName  AS BuyerName,
    t.BuyerID,
    l.SellerID
FROM TicketTransfers t
JOIN TicketListings l   ON l.ListingID  = t.ListingID
JOIN Bookings       b   ON b.BookingID  = l.BookingID
JOIN Schedules      s   ON s.ScheduleID = b.ScheduleID
JOIN Vehicles       v   ON v.VehicleID  = s.VehicleID
JOIN Users          seller ON seller.UserID = l.SellerID
JOIN Users          buyer  ON buyer.UserID  = t.BuyerID;
GO

PRINT 'Ticket Transfer tables, triggers, views created successfully!';

SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME IN ('Bookings','Schedules','Vehicles')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'Routes'
ORDER BY ORDINAL_POSITION;

USE SCTMS;
GO

CREATE TABLE TicketListings (
    ListingID     INT IDENTITY(1,1) PRIMARY KEY,
    BookingID     INT NOT NULL UNIQUE,
    SellerID      INT NOT NULL,
    AskingPrice   DECIMAL(10,2) NOT NULL,
    Status        NVARCHAR(20) DEFAULT 'open'
        CHECK (Status IN ('open','reserved','transferred','cancelled')),
    ListedAt      DATETIME DEFAULT GETDATE(),
    ExpiresAt     DATETIME,
    FOREIGN KEY (BookingID) REFERENCES Bookings(BookingID),
    FOREIGN KEY (SellerID)  REFERENCES Users(UserID)
);
GO

CREATE TABLE TicketTransfers (
    TransferID      INT IDENTITY(1,1) PRIMARY KEY,
    ListingID       INT NOT NULL,
    BuyerID         INT NOT NULL,
    PaymentRef      NVARCHAR(100),
    PaymentStatus   NVARCHAR(20) DEFAULT 'pending'
        CHECK (PaymentStatus IN ('pending','paid','failed')),
    TransferStatus  NVARCHAR(20) DEFAULT 'pending'
        CHECK (TransferStatus IN ('pending','completed','failed','cancelled')),
    RequestedAt     DATETIME DEFAULT GETDATE(),
    CompletedAt     DATETIME,
    FOREIGN KEY (ListingID) REFERENCES TicketListings(ListingID),
    FOREIGN KEY (BuyerID)   REFERENCES Users(UserID)
);
GO

CREATE UNIQUE INDEX UX_OneTransferPerListing
    ON TicketTransfers(ListingID)
    WHERE TransferStatus = 'completed';
GO

CREATE TRIGGER trg_NoSelfTransfer
ON TicketTransfers
AFTER INSERT
AS
BEGIN
    IF EXISTS (
        SELECT 1 FROM inserted i
        JOIN TicketListings l ON l.ListingID = i.ListingID
        WHERE l.SellerID = i.BuyerID
    )
    BEGIN
        ROLLBACK;
        RAISERROR('নিজের ticket নিজে কিনতে পারবেন না।', 16, 1);
    END
END
GO

CREATE TRIGGER trg_NoListingForInvalidBooking
ON TicketListings
AFTER INSERT
AS
BEGIN
    IF EXISTS (
        SELECT 1 FROM inserted i
        JOIN Bookings b ON b.BookingID = i.BookingID
        WHERE b.Status != 'confirmed'
    )
    BEGIN
        ROLLBACK;
        RAISERROR('শুধুমাত্র confirmed booking list করা যাবে।', 16, 1);
    END
END
GO

CREATE VIEW vw_TicketMarketplace AS
SELECT
    l.ListingID, l.BookingID, l.AskingPrice,
    l.Status AS ListingStatus, l.ListedAt, l.ExpiresAt,
    s.JourneyDate, b.SeatNumber, b.TotalFare AS OriginalFare,
    b.Status AS BookingStatus,
    r.Origin, r.Destination, s.DepartureTime, s.ArrivalTime,
    v.VehicleName, v.Type AS VehicleType, v.Amenities,
    u.FirstName + ' ' + u.LastName AS SellerName, l.SellerID
FROM TicketListings l
JOIN Bookings  b ON b.BookingID  = l.BookingID
JOIN Schedules s ON s.ScheduleID = b.ScheduleID
JOIN Routes    r ON r.RouteID    = s.RouteID
JOIN Vehicles  v ON v.VehicleID  = s.VehicleID
JOIN Users     u ON u.UserID     = l.SellerID;
GO

CREATE VIEW vw_TransferHistory AS
SELECT
    t.TransferID, t.ListingID, t.PaymentRef,
    t.PaymentStatus, t.TransferStatus, t.RequestedAt, t.CompletedAt,
    l.BookingID, l.AskingPrice, b.SeatNumber, s.JourneyDate,
    r.Origin, r.Destination, v.VehicleName,
    seller.FirstName + ' ' + seller.LastName AS SellerName,
    buyer.FirstName  + ' ' + buyer.LastName  AS BuyerName,
    t.BuyerID, l.SellerID
FROM TicketTransfers t
JOIN TicketListings l  ON l.ListingID  = t.ListingID
JOIN Bookings       b  ON b.BookingID  = l.BookingID
JOIN Schedules      s  ON s.ScheduleID = b.ScheduleID
JOIN Routes         r  ON r.RouteID    = s.RouteID
JOIN Vehicles       v  ON v.VehicleID  = s.VehicleID
JOIN Users seller ON seller.UserID = l.SellerID
JOIN Users buyer  ON buyer.UserID  = t.BuyerID;
GO

PRINT 'Done!';

SELECT * FROM vw_TicketMarketplace;
SELECT * FROM vw_TransferHistory;