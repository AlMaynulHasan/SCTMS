# SCTMS Backend v2.0

## 📁 Folder Structure
```
sctms_backend/
├── server.js              ← Main file — এটা দিয়ে server চালু হয়
├── .env                   ← DB password + JWT secret
├── package.json           ← Dependencies list
├── config/
│   └── db.js              ← SQL Server connection
├── middleware/
│   └── auth.js            ← JWT token check
└── routes/
    ├── authRoutes.js      ← /api/auth/register, /api/auth/login
    ├── scheduleRoutes.js  ← /api/schedules/search, /api/schedules/:id/seats
    ├── bookingRoutes.js   ← /api/bookings (book, cancel, my bookings)
    ├── exchangeRoutes.js  ← /api/exchange (request, approve, reject)
    └── adminRoutes.js     ← /api/admin/stats, /api/admin/users
```

## 🚀 Setup Steps

### Step 1 — SSMS এ SA Login Enable করো
```sql
ALTER LOGIN sa ENABLE;
GO
ALTER LOGIN sa WITH PASSWORD = '12345';
GO
```

### Step 2 — SQL Server Authentication Mode Change করো
SSMS → Server → Right Click → Properties → Security
→ "SQL Server and Windows Authentication mode" select করো → OK

### Step 3 — SQL Server Restart করো
SQL Server Configuration Manager → SQL Server Services
→ SQL Server (SQLEXPRESS) → Right Click → Restart

### Step 4 — TCP/IP Enable করো
SQL Server Configuration Manager
→ SQL Server Network Configuration → Protocols for SQLEXPRESS
→ TCP/IP → Right Click → Enable
→ TCP/IP → Double Click → IP Addresses tab → IPAll → TCP Port = 1433 → OK
→ SQL Server Services → SQL Server (SQLEXPRESS) → Restart

### Step 5 — Backend চালু করো
```bash
npm install
node server.js
```

### Step 6 — Test করো
Browser এ যাও: http://localhost:5000
✅ দেখালে সব ঠিক আছে!

## 🔗 API Endpoints

| Method | URL | Description |
|--------|-----|-------------|
| POST | /api/auth/register | নতুন account |
| POST | /api/auth/login | Login |
| GET | /api/schedules/search?origin=Dhaka&destination=Chittagong&date=2026-02-28 | Route search |
| GET | /api/schedules/:id/seats | Booked seats |
| POST | /api/bookings | Ticket book |
| GET | /api/bookings/my | আমার bookings |
| PUT | /api/bookings/:id/cancel | Cancel |
| POST | /api/exchange | Exchange request |
| GET | /api/exchange/my | আমার exchanges |
| GET | /api/admin/stats | Dashboard stats |
| GET | /api/admin/users | সব users |
