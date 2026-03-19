-- =============================================
-- SCTMS Migration v4 — Notifications System
-- =============================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='Notifications')
BEGIN
    CREATE TABLE Notifications (
        NotificationID  INT IDENTITY(1,1) PRIMARY KEY,
        UserID          INT NOT NULL REFERENCES Users(UserID) ON DELETE CASCADE,
        Type            NVARCHAR(50)  NOT NULL,
            -- booking_confirmed | booking_cancelled | transfer_completed
            -- waitlist_notified | trip_status_changed | admin_action
        Message         NVARCHAR(500) NOT NULL,
        Meta            NVARCHAR(1000) NULL,  -- JSON string (bookingID, refCode, etc.)
        IsRead          BIT DEFAULT 0,
        CreatedAt       DATETIME DEFAULT GETDATE()
    );

    CREATE INDEX IX_Notifications_User    ON Notifications(UserID, IsRead, CreatedAt DESC);
    CREATE INDEX IX_Notifications_Created ON Notifications(CreatedAt DESC);

    PRINT 'Notifications table created.';
END
ELSE
BEGIN
    -- Meta column না থাকলে যোগ করো
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('Notifications') AND name='Meta')
        ALTER TABLE Notifications ADD Meta NVARCHAR(1000) NULL;
    PRINT 'Notifications table already exists.';
END

PRINT '✅ Migration v4 complete — Notifications system ready.';
