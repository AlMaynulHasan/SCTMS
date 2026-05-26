# SCTMS Backend v2.0

## Folder Structure

```text
backend_new/
├── server.js                  ← Main file; eta diye server chalu hoy
├── .env                       ← DB password + JWT secret
├── .env.example               ← Env template
├── package.json               ← Dependencies list
├── config/
│   └── db.js                  ← SQL Server connection
├── middleware/
│   └── auth.js                ← JWT token check + role guard
└── routes/
    ├── authRoutes.js          ← login, register, OTP, reset password
    ├── scheduleRoutes.js      ← schedule search, seats, admin schedule CRUD
    ├── bookingRoutes.js       ← book, cancel, my bookings, review, verify
    ├── exchangeRoutes.js      ← legacy admin-approved exchange
    ├── transferRoutes.js      ← marketplace sell/swap transfer system
    ├── adminRoutes.js         ← admin stats and users
    ├── userRoutes.js          ← profile update and password change
    ├── promoRoutes.js         ← promo validate/use/manage
    ├── vehicleRoutes.js       ← admin vehicle CRUD
    ├── routeRoutes.js         ← admin route CRUD
    ├── holdRoutes.js          ← seat hold/release
    ├── waitlistRoutes.js      ← waitlist join/manage/notify
    ├── notificationRoutes.js  ← user/admin notifications
    └── otpRoutes.js           ← standalone OTP send/verify
```

## Setup Steps

### Step 1 — SQL Server Database Restore

SSMS open kore database create korun:

```sql
CREATE DATABASE SCTMS;
GO
```

Then root folder theke ei file run korun:

```text
SQL/sctms_backup.sql
```

### Step 2 — SA Login Enable korte chaile

Local test-er jonno `sa` use korte chaile:

```sql
ALTER LOGIN sa ENABLE;
GO
ALTER LOGIN sa WITH PASSWORD = '12345';
GO
```

Production ba shared machine-e strong password use korben.

### Step 3 — SQL Server Authentication Mode Change

SSMS → Server → Right Click → Properties → Security  
`SQL Server and Windows Authentication mode` select korun → OK

### Step 4 — SQL Server Restart

SQL Server Configuration Manager → SQL Server Services  
SQL Server / SQL Server (SQLEXPRESS) → Right Click → Restart

### Step 5 — TCP/IP Enable

SQL Server Configuration Manager → SQL Server Network Configuration  
Protocols for SQLEXPRESS → TCP/IP → Enable

Then:

TCP/IP → Double Click → IP Addresses tab → IPAll → TCP Port = `1433` → OK  
SQL Server Services → SQL Server (SQLEXPRESS) → Restart

### Step 6 — Environment File Setup

`backend_new` folder-e:

```bash
copy .env.example .env
```

`.env` file edit korun:

```env
PORT=5000
NODE_ENV=development

DB_SERVER=localhost
DB_PORT=1433
DB_NAME=SCTMS
DB_USER=your_db_user
DB_PASSWORD=your_db_password

JWT_SECRET=your_super_secret_random_string
JWT_EXPIRES_IN=7d
```

SQL Server Express hole `DB_SERVER` er value eta hote pare:

```env
DB_SERVER=localhost\SQLEXPRESS
```

### Step 7 — Backend Chalu Koro

`backend_new` folder-e thakte hobe:

```bash
npm install
node server.js
```

Alternative:

```bash
npm start
```

### Step 8 — Test Koro

Browser-e jao:

```text
http://localhost:5000
```

Response pele backend thik ache.

## API Endpoints

Base URL:

```text
http://localhost:5000/api
```

### Auth

| Method | URL | Description |
| --- | --- | --- |
| POST | `/api/auth/send-register-otp` | Register OTP send |
| POST | `/api/auth/verify-otp` | OTP verify |
| POST | `/api/auth/register` | Notun account |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/send-otp` | Password reset OTP |
| POST | `/api/auth/reset-password` | Password reset |

### Schedules

| Method | URL | Description |
| --- | --- | --- |
| GET | `/api/schedules/search?origin=Dhaka&destination=Chittagong&date=2026-02-28` | Route search |
| GET | `/api/schedules/:id/seats` | Booked seats |
| GET | `/api/schedules` | All schedules, admin |
| GET | `/api/schedules/admin` | Admin schedule list |
| POST | `/api/schedules` | Schedule add, admin |
| PUT | `/api/schedules/:id` | Schedule update, admin |
| DELETE | `/api/schedules/:id` | Schedule cancel/delete, admin |

### Bookings

| Method | URL | Description |
| --- | --- | --- |
| POST | `/api/bookings` | Ticket book; single or multi-seat |
| GET | `/api/bookings/my` | Amar bookings |
| PUT | `/api/bookings/:id/cancel` | Booking cancel |
| GET | `/api/bookings` | All bookings, staff/admin |
| GET | `/api/bookings/:id` | Single booking/ticket |
| POST | `/api/bookings/:id/review` | Booking review |
| PUT | `/api/bookings/:id/mark-used` | QR verify kore used mark, staff/admin |

### Users

| Method | URL | Description |
| --- | --- | --- |
| PUT | `/api/users/profile` | Profile update |
| PUT | `/api/users/change-password` | Password change |

### Ticket Exchange / Marketplace

Current marketplace system uses `/api/transfer`.

| Method | URL | Description |
| --- | --- | --- |
| GET | `/api/transfer/marketplace` | Marketplace listings |
| GET | `/api/transfer/price-suggestion?bookingID=1` | Smart resale price suggestion |
| POST | `/api/transfer/list` | Ticket sell listing |
| POST | `/api/transfer/list-swap` | Ticket swap listing |
| POST | `/api/transfer/request/:listingID` | Buy listed ticket |
| DELETE | `/api/transfer/cancel/:listingID` | Own listing remove |
| GET | `/api/transfer/my-listings` | Amar listings |
| GET | `/api/transfer/my-transfers` | Amar purchases/transfers |
| GET | `/api/transfer/history` | Transfer history, admin/staff |
| POST | `/api/transfer/swap-request/:listingID` | Swap offer send |
| PUT | `/api/transfer/swap-request/:transferID` | Swap accept/decline |
| GET | `/api/transfer/my-swap-requests` | Amar swap requests |

Legacy admin-approved exchange endpoints:

| Method | URL | Description |
| --- | --- | --- |
| POST | `/api/exchange` | Exchange request |
| GET | `/api/exchange/my` | Amar exchange requests |
| GET | `/api/exchange` | All exchange requests, admin |
| PUT | `/api/exchange/:id` | Approve/reject, admin |

### Admin

| Method | URL | Description |
| --- | --- | --- |
| GET | `/api/admin/stats` | Dashboard stats |
| GET | `/api/admin/users` | Sob users |
| POST | `/api/admin/users` | User create, admin |
| PUT | `/api/admin/users/:id/toggle` | User active/inactive |

### Promo

| Method | URL | Description |
| --- | --- | --- |
| POST | `/api/promo/validate` | Promo validate |
| POST | `/api/promo/use` | Promo usage count update |
| POST | `/api/promo` | Promo create |
| GET | `/api/promo` | Promo list |

### Vehicles

| Method | URL | Description |
| --- | --- | --- |
| GET | `/api/vehicles` | Vehicle list, admin |
| POST | `/api/vehicles` | Vehicle add, admin |
| PUT | `/api/vehicles/:id` | Vehicle update, admin |
| DELETE | `/api/vehicles/:id` | Vehicle deactivate/delete, admin |

### Routes

| Method | URL | Description |
| --- | --- | --- |
| GET | `/api/routes` | Route list, admin |
| POST | `/api/routes` | Route add, admin |
| PUT | `/api/routes/:id` | Route update, admin |
| DELETE | `/api/routes/:id` | Route deactivate/delete, admin |

### Seat Holds

| Method | URL | Description |
| --- | --- | --- |
| POST | `/api/holds` | Seat hold for payment |
| GET | `/api/holds/my` | Amar active holds |
| DELETE | `/api/holds/:holdID` | Hold release |

### Waitlist

| Method | URL | Description |
| --- | --- | --- |
| POST | `/api/waitlist` | Waitlist join |
| GET | `/api/waitlist/my` | Amar waitlist |
| DELETE | `/api/waitlist/:id` | Waitlist remove |
| POST | `/api/waitlist/notify/:scheduleID` | Notify waitlist, staff/admin |

### Notifications

| Method | URL | Description |
| --- | --- | --- |
| GET | `/api/notifications/my` | Amar notifications |
| PUT | `/api/notifications/read-all` | Sob read mark |
| PUT | `/api/notifications/:id/read` | Single read mark |
| DELETE | `/api/notifications/clear` | Amar notifications clear |
| GET | `/api/notifications/admin` | Admin/staff notification feed |

## Notes

- Frontend local API URL: `http://localhost:5000/api`
- Frontend Live Server recommended: `http://127.0.0.1:5500`
- `.env` GitHub-e push korben na.
- Multi-seat booking korle prottek seat alada booking ID hoy, jate ekta ticket sell/swap kora jay and baki ticket user-er kache thake.
