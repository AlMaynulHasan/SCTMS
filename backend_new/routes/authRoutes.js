const express    = require('express');
const router     = express.Router();
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { sql, poolPromise } = require('../config/db');
require('dotenv').config();

// ── EMAIL TRANSPORTER ────────────────────────
// EMAIL_USER/PASS না থাকলে dev mode — console এ OTP দেখাবে
const transporter = (process.env.EMAIL_USER && process.env.EMAIL_PASS)
    ? nodemailer.createTransport({
        host: 'smtp-relay.brevo.com',
        port: 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
      })
    : null;

// ── OTP STORE ────────────────────────────────
const otpStore = new Map();

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendEmailOTP(email, otp, purpose = 'verification') {
    if (!transporter) throw new Error('Email not configured');

    const subjects = {
        verification: 'SCTMS — Email Verification OTP',
        reset:        'SCTMS — Password Reset OTP'
    };
    const titles = {
        verification: 'Verify your email address',
        reset:        'Reset your password'
    };

    await transporter.sendMail({
        from:    `"SCTMS Smart Transport" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
        to:      email,
        subject: subjects[purpose] || subjects.verification,
        html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f7f4ef;border-radius:12px">
          <div style="text-align:center;margin-bottom:24px">
            <div style="display:inline-block;background:#0F1729;color:#C49A32;font-size:20px;font-weight:700;padding:8px 18px;border-radius:7px;letter-spacing:2px">SCTMS</div>
          </div>
          <h2 style="color:#0F1729;font-size:20px;margin-bottom:8px">${titles[purpose]}</h2>
          <p style="color:#556070;font-size:14px;line-height:1.6;margin-bottom:24px">
            আপনার One-Time Password (OTP) নিচে দেওয়া হলো। এটি <strong>5 মিনিট</strong> পর্যন্ত valid থাকবে।
          </p>
          <div style="background:#0F1729;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px">
            <div style="font-size:36px;font-weight:700;color:#C49A32;letter-spacing:10px">${otp}</div>
          </div>
          <p style="color:#9AA3B0;font-size:12px;line-height:1.6">
            আপনি যদি এই request না করে থাকেন, এই email টি ignore করুন।<br>
            এই OTP কাউকে share করবেন না।
          </p>
          <hr style="border:none;border-top:1px solid #D8D2C6;margin:20px 0">
          <p style="color:#9AA3B0;font-size:11px;text-align:center">
            Smart City Transport Management System — Bangladesh
          </p>
        </div>`
    });
}

// ── LOGIN ATTEMPT TRACKER ────────────────────
const loginAttempts = new Map();
const MAX_ATTEMPTS  = 5;
const LOCK_MINUTES  = 15;

function getAttemptInfo(email) {
    return loginAttempts.get(email.toLowerCase()) || { count: 0, lockedUntil: null };
}
function recordFailedAttempt(email) {
    const key  = email.toLowerCase();
    const info = getAttemptInfo(email);
    const count = info.count + 1;
    const lockedUntil = count >= MAX_ATTEMPTS
        ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
        : info.lockedUntil;
    loginAttempts.set(key, { count, lockedUntil });
    return { count, lockedUntil };
}
function clearAttempts(email) {
    loginAttempts.delete(email.toLowerCase());
}
function isLocked(email) {
    const info = getAttemptInfo(email);
    if (!info.lockedUntil) return false;
    if (new Date() < new Date(info.lockedUntil)) return true;
    loginAttempts.delete(email.toLowerCase());
    return false;
}

// ─────────────────────────────────────────────
// POST /auth/send-register-otp
// ─────────────────────────────────────────────
router.post('/send-register-otp', async (req, res) => {
    const { email, phone } = req.body;
    if (!email && !phone)
        return res.status(400).json({ message: 'Email অথবা phone number দিন।' });

    const key = (email || phone).toLowerCase().replace(/\s/g, '');

    try {
        const pool = await poolPromise;

        if (email) {
            const ex = await pool.request()
                .input('Email', sql.NVarChar, email)
                .query('SELECT UserID FROM Users WHERE Email = @Email');
            if (ex.recordset.length)
                return res.status(409).json({ message: 'এই email দিয়ে আগেই account আছে।' });
        }
        if (phone) {
            const ex = await pool.request()
                .input('Phone', sql.NVarChar, phone)
                .query('SELECT UserID FROM Users WHERE Phone = @Phone')
                .catch(() => ({ recordset: [] }));
            if (ex.recordset.length)
                return res.status(409).json({ message: 'এই phone number দিয়ে আগেই account আছে।' });
        }

        const otp = generateOTP();
        otpStore.set(key, {
            otp,
            purpose:   'register',
            expiresAt: Date.now() + 5 * 60 * 1000,
            attempts:  0
        });

        if (email) {
            if (transporter) {
                await sendEmailOTP(email, otp, 'verification');
                console.log(`[OTP] Email sent to ${email}`);
                return res.json({ message: `OTP পাঠানো হয়েছে ${email} এ। Inbox চেক করুন।` });
            } else {
                console.log(`[OTP-DEV] ${email} → ${otp}`);
                return res.json({ message: 'OTP sent (dev mode).', otp });
            }
        } else {
            console.log(`[SMS-OTP] ${phone} → ${otp}`);
            return res.json({
                message: `OTP sent to ${phone} — server console এ দেখুন।`,
                otp: process.env.NODE_ENV === 'development' ? otp : undefined
            });
        }

    } catch (err) {
        console.error('send-register-otp error:', err.message);
        res.status(500).json({ message: 'OTP পাঠানো যায়নি। আবার চেষ্টা করুন।' });
    }
});

// ─────────────────────────────────────────────
// POST /auth/verify-otp
// ─────────────────────────────────────────────
router.post('/verify-otp', (req, res) => {
    const { email, phone, otp } = req.body;
    const key = (email || phone || '').toLowerCase().replace(/\s/g, '');
    if (!key || !otp)
        return res.status(400).json({ message: 'Email/phone এবং OTP দিন।' });

    const stored = otpStore.get(key);
    if (!stored)
        return res.status(400).json({ message: 'OTP পাঠানো হয়নি বা মেয়াদ শেষ। আবার চেষ্টা করুন।' });
    if (Date.now() > stored.expiresAt) {
        otpStore.delete(key);
        return res.status(400).json({ message: 'OTP expired। নতুন OTP নিন।' });
    }
    stored.attempts = (stored.attempts || 0) + 1;
    if (stored.attempts > 5) {
        otpStore.delete(key);
        return res.status(429).json({ message: 'অনেক বেশি ভুল OTP। নতুন OTP নিন।' });
    }
    if (stored.otp !== otp.toString())
        return res.status(400).json({ message: `Invalid OTP। (${5 - stored.attempts} attempt বাকি)` });

    stored.verified = true;
    res.json({ message: 'OTP verified! এখন account তৈরি করুন।', verified: true });
});

// ─────────────────────────────────────────────
// POST /auth/register
// ─────────────────────────────────────────────
router.post('/register', async (req, res) => {
    const { firstName, lastName, email, phone, password, nid, gender, dob, district, address } = req.body;

    if (!firstName || !lastName || !password)
        return res.status(400).json({ message: 'Name ও password দিন।' });
    if (!email && !phone)
        return res.status(400).json({ message: 'Email অথবা phone number দিন।' });

    const key    = (email || phone || '').toLowerCase().replace(/\s/g, '');
    const stored = otpStore.get(key);
    const requireOTP = !!(transporter); // email configured থাকলে OTP required

    if (requireOTP && (!stored || !stored.verified))
        return res.status(403).json({ message: 'Email verify করুন আগে।' });

    try {
        const pool = await poolPromise;

        if (email) {
            const exists = await pool.request()
                .input('Email', sql.NVarChar, email)
                .query('SELECT UserID FROM Users WHERE Email = @Email');
            if (exists.recordset.length)
                return res.status(409).json({ message: 'এই email আগেই registered।' });
        }

        const hash   = await bcrypt.hash(password, 10);
        const result = await pool.request()
            .input('FirstName', sql.NVarChar, firstName)
            .input('LastName',  sql.NVarChar, lastName)
            .input('Email',     sql.NVarChar, email    || null)
            .input('Phone',     sql.NVarChar, phone    || null)
            .input('Password',  sql.NVarChar, hash)
            .input('NID',       sql.NVarChar, nid      || null)
            .input('Gender',    sql.NVarChar, gender   || null)
            .input('DOB',       sql.Date,     dob      || null)
            .input('District',  sql.NVarChar, district || null)
            .input('Address',   sql.NVarChar, address  || null)
            .input('Role',      sql.NVarChar, 'passenger')
            .query(`
                INSERT INTO Users (FirstName, LastName, Email, Phone, Password, NID, Gender, DOB, District, Address, Role)
                VALUES (@FirstName, @LastName, @Email, @Phone, @Password, @NID, @Gender, @DOB, @District, @Address, @Role);
                SELECT SCOPE_IDENTITY() AS UserID;
            `);

        otpStore.delete(key);

        // Welcome email (async, non-blocking)
        if (email && transporter) {
            transporter.sendMail({
                from:    `"SCTMS Smart Transport" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
                to:      email,
                subject: 'SCTMS — স্বাগতম! Account তৈরি হয়েছে',
                html: `
                <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f7f4ef;border-radius:12px">
                  <div style="text-align:center;margin-bottom:20px">
                    <div style="display:inline-block;background:#0F1729;color:#C49A32;font-size:20px;font-weight:700;padding:8px 18px;border-radius:7px;letter-spacing:2px">SCTMS</div>
                  </div>
                  <h2 style="color:#0F1729">স্বাগতম, ${firstName}!</h2>
                  <p style="color:#556070;font-size:14px;line-height:1.6">
                    আপনার SCTMS account সফলভাবে তৈরি হয়েছে।<br>
                    এখন বাংলাদেশের যেকোনো রুটের বাস ও ট্রেনের টিকিট বুক করুন।
                  </p>
                  <a href="http://localhost:5502/login.html" style="display:inline-block;margin-top:16px;padding:10px 24px;background:#0F1729;color:#C49A32;border-radius:7px;text-decoration:none;font-weight:700">Login করুন →</a>
                </div>`
            }).catch(() => {});
        }

        res.status(201).json({
            message: 'Account তৈরি হয়েছে! এখন login করুন।',
            userID:  result.recordset[0].UserID
        });

    } catch (err) {
        console.error('Register error:', err.message);
        res.status(500).json({ message: 'Server error।' });
    }
});

// ─────────────────────────────────────────────
// POST /auth/login
// ─────────────────────────────────────────────
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password)
        return res.status(400).json({ message: 'Email ও password দিন।' });

    if (isLocked(email)) {
        const info      = getAttemptInfo(email);
        const remaining = Math.ceil((new Date(info.lockedUntil) - Date.now()) / 60000);
        return res.status(429).json({
            message:     `অনেক বেশি failed login। ${remaining} মিনিট পর আবার চেষ্টা করুন।`,
            lockedUntil: info.lockedUntil
        });
    }

    try {
        const pool   = await poolPromise;
        const result = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query('SELECT * FROM Users WHERE Email = @Email AND IsActive = 1');

        if (!result.recordset.length) {
            recordFailedAttempt(email);
            return res.status(401).json({ message: 'Email বা password ভুল।' });
        }

        const user  = result.recordset[0];
        const match = await bcrypt.compare(password, user.Password);

        if (!match) {
            const { count, lockedUntil } = recordFailedAttempt(email);
            const left = MAX_ATTEMPTS - count;
            if (lockedUntil)
                return res.status(429).json({
                    message:     `${MAX_ATTEMPTS}টি ভুল attempt। Account ${LOCK_MINUTES} মিনিটের জন্য locked।`,
                    lockedUntil
                });
            return res.status(401).json({
                message: `Email বা password ভুল। (${left} attempt বাকি)`
            });
        }

        clearAttempts(email);

        const token = jwt.sign(
            { userID: user.UserID, email: user.Email, role: user.Role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        res.json({
            message: 'Login সফল!',
            token,
            user: {
                userID:    user.UserID,
                firstName: user.FirstName,
                lastName:  user.LastName,
                email:     user.Email,
                role:      user.Role
            }
        });

    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ message: 'Server error।' });
    }
});

// ─────────────────────────────────────────────
// POST /auth/send-otp (password reset)
// ─────────────────────────────────────────────
router.post('/send-otp', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email দিন।' });
    try {
        const pool   = await poolPromise;
        const result = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query('SELECT UserID FROM Users WHERE Email = @Email AND IsActive = 1');
        if (!result.recordset.length)
            return res.status(404).json({ message: 'এই email দিয়ে কোনো account নেই।' });

        const otp = generateOTP();
        const key = email.toLowerCase();
        otpStore.set(key, { otp, purpose: 'reset', expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0 });

        if (transporter) {
            await sendEmailOTP(email, otp, 'reset');
            console.log(`[OTP] Reset email sent to ${email}`);
            return res.json({ message: `OTP পাঠানো হয়েছে ${email} এ।` });
        } else {
            console.log(`[OTP-DEV] Reset ${email} → ${otp}`);
            return res.json({ message: 'OTP sent.', otp });
        }
    } catch (err) {
        console.error('send-otp error:', err.message);
        res.status(500).json({ message: 'Server error।' });
    }
});

// ─────────────────────────────────────────────
// POST /auth/reset-password
// ─────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword)
        return res.status(400).json({ message: 'email, otp, newPassword সব দিন।' });
    if (newPassword.length < 8)
        return res.status(400).json({ message: 'Password কমপক্ষে ৮ character হতে হবে।' });

    const key    = email.toLowerCase();
    const stored = otpStore.get(key);
    if (!stored)
        return res.status(400).json({ message: 'OTP পাঠানো হয়নি। আবার চেষ্টা করুন।' });
    if (Date.now() > stored.expiresAt) {
        otpStore.delete(key);
        return res.status(400).json({ message: 'OTP expired। নতুন OTP নিন।' });
    }
    stored.attempts = (stored.attempts || 0) + 1;
    if (stored.attempts > 5) {
        otpStore.delete(key);
        return res.status(429).json({ message: 'অনেক বেশি attempt। নতুন OTP নিন।' });
    }
    if (stored.otp !== otp.toString())
        return res.status(400).json({ message: 'Invalid OTP।' });

    try {
        const pool = await poolPromise;
        const hash = await bcrypt.hash(newPassword, 10);
        const upd  = await pool.request()
            .input('Email',    sql.NVarChar, email)
            .input('Password', sql.NVarChar, hash)
            .query('UPDATE Users SET Password = @Password WHERE Email = @Email AND IsActive = 1');

        if (!upd.rowsAffected[0])
            return res.status(404).json({ message: 'User পাওয়া যায়নি।' });

        otpStore.delete(key);
        res.json({ message: 'Password reset হয়েছে। এখন login করুন।' });
    } catch (err) {
        console.error('reset-password error:', err.message);
        res.status(500).json({ message: 'Server error।' });
    }
});

module.exports = router;
