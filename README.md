# SCTMS - Smart City Transport Management System

SCTMS is a transport ticket booking and exchange system. It includes route search, seat selection, multi-seat booking, demo payment, printable tickets, passenger dashboard, admin dashboard, promo codes, waitlist, notifications, and passenger-to-passenger ticket exchange.

## Tech Stack

- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Node.js, Express
- Database: Microsoft SQL Server
- Authentication: JWT

## Project Structure

```text
SCTMS-main/
├── index.html
├── booking.html
├── ticket-print.html
├── dashboard.html
├── dashboard-admin.html
├── marketplace.html
├── login.html
├── register.html
├── SQL/
│   └── sctms_backup.sql
└── backend_new/
    ├── server.js
    ├── package.json
    ├── .env.example
    ├── config/
    ├── middleware/
    └── routes/
```

## Requirements

- Node.js 18 or newer
- npm
- Microsoft SQL Server or SQL Server Express
- SQL Server Management Studio (SSMS), recommended
- VS Code Live Server or any static file server

## Setup

### 1. Clone

```bash
git clone https://github.com/AlMaynulHasan/SCTMS.git
cd SCTMS
```

### 2. Restore Database

Create a database named `SCTMS` in SQL Server:

```sql
CREATE DATABASE SCTMS;
GO
```

Then open and run:

```text
SQL/sctms_backup.sql
```

Run it against the `SCTMS` database.

### 3. Configure Backend

```bash
cd backend_new
copy .env.example .env
```

Edit `backend_new/.env`:

```env
PORT=5000
NODE_ENV=development

DB_SERVER=localhost
DB_PORT=1433
DB_NAME=SCTMS
DB_USER=your_sql_user
DB_PASSWORD=your_sql_password

JWT_SECRET=change_this_to_a_long_random_secret
JWT_EXPIRES_IN=7d
```

For SQL Server Express, `DB_SERVER` may be:

```env
DB_SERVER=localhost\SQLEXPRESS
```

### 4. Install and Run Backend

From `backend_new/`:

```bash
npm install
npm start
```

API health check:

```text
http://localhost:5000
```

### 5. Run Frontend

Open the root project folder in VS Code and start Live Server from `index.html`.

Recommended frontend URL:

```text
http://127.0.0.1:5500/index.html
```

The frontend currently calls:

```text
http://localhost:5000/api
```

So keep the backend on port `5000` for local development.

## Main Features

- Passenger registration and login
- Route and schedule search
- Seat map and multi-seat booking
- Demo OTP payment flow
- Printable ticket/PDF page
- One printable ticket per booked seat
- Passenger dashboard
- Booking cancellation
- Ticket exchange marketplace
- Sell or swap individual tickets
- Admin dashboard
- Promo codes
- Waitlist and notifications

## Multi-Seat Booking and Exchange

When a passenger books multiple seats, SCTMS stores each seat as a separate booking ID.

Example:

```text
Seat 01 -> Booking #27
Seat 02 -> Booking #28
```

This is intentional. It means a passenger can sell/swap only one ticket while keeping the other ticket confirmed.

## API Overview

Base URL:

```text
http://localhost:5000/api
```

| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/auth/register` | Register user |
| POST | `/auth/login` | Login |
| GET | `/schedules/search` | Search routes/schedules |
| GET | `/schedules/:id/seats` | Get booked seats |
| POST | `/bookings` | Book ticket |
| GET | `/bookings/my` | My bookings |
| PUT | `/bookings/:id/cancel` | Cancel booking |
| PUT | `/users/profile` | Update profile |
| PUT | `/users/change-password` | Change password |
| GET | `/transfer/marketplace` | Browse ticket exchange |
| POST | `/transfer/list` | List ticket for sale |
| POST | `/transfer/list-swap` | List ticket for swap |
| POST | `/transfer/request/:listingID` | Buy listed ticket |
| POST | `/transfer/swap-request/:listingID` | Offer swap |
| GET | `/admin/users` | Admin user list |

## Troubleshooting

### Database connection failed

Check:

- SQL Server is running
- SQL Server Authentication is enabled if using username/password
- TCP/IP is enabled
- Port `1433` is open
- `.env` database values are correct

### Frontend loads but API does not work

Check:

- Backend is running on `http://localhost:5000`
- Frontend is opened through Live Server
- Browser console has no CORS error

Supported local frontend origins are configured in `backend_new/server.js`, including:

```text
http://localhost:5500
http://127.0.0.1:5500
http://localhost:5502
http://127.0.0.1:5502
http://localhost:3000
```

## Security Notes

- Do not commit `backend_new/.env`
- Use a strong `JWT_SECRET`
- Use strong SQL Server credentials
- Put real SMTP credentials only in `.env`

## Current Run Checklist

Before running on a new machine:

1. Restore `SQL/sctms_backup.sql`.
2. Copy `backend_new/.env.example` to `backend_new/.env`.
3. Fill database credentials in `.env`.
4. Run `npm install` inside `backend_new`.
5. Run `npm start`.
6. Open `index.html` using Live Server.

