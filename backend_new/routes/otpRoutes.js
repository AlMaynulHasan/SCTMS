// OTP Routes
const express = require('express');
const router  = express.Router();
const { sql, poolPromise } = require('../config/db');

// OTP generate helper
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /api/otp/send — OTP পাঠাও
router.post('/send', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email দিন।' });

    try {
        const pool = await poolPromise;

        // Email আছে কিনা check (register এর আগে call হয় তাই নেই থাকাটাই স্বাভাবিক)
        // পুরনো OTP expire করো
        await pool.request()
            .input('Email', sql.NVarChar, email)
            .query(`UPDATE OTPVerifications SET IsUsed=1 WHERE Email=@Email AND IsUsed=0`);

        const otp = generateOTP();

        await pool.request()
            .input('Email',   sql.NVarChar, email)
            .input('OTPCode', sql.NVarChar, otp)
            .query(`INSERT INTO OTPVerifications (Email, OTPCode) VALUES (@Email, @OTPCode)`);

        // Real project এ এখানে email/SMS পাঠানো হতো
        // Lab project এ mock — console এ দেখাবো
        console.log(`\n📧 OTP for ${email}: ${otp}\n`);

        res.json({
            message: 'OTP পাঠানো হয়েছে। (Console এ দেখুন)',
            // Dev mode তে OTP response এ দেখাই
            devOTP: otp
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server error।' });
    }
});

// POST /api/otp/verify — OTP verify করো
router.post('/verify', async (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: 'Email এবং OTP দিন।' });

    try {
        const pool = await poolPromise;

        const result = await pool.request()
            .input('Email',   sql.NVarChar, email)
            .input('OTPCode', sql.NVarChar, otp)
            .query(`
                SELECT OTPID FROM OTPVerifications
                WHERE Email=@Email AND OTPCode=@OTPCode 
                AND IsUsed=0 AND ExpiresAt > GETDATE()
            `);

        if (!result.recordset.length)
            return res.status(400).json({ message: 'OTP ভুল অথবা মেয়াদ শেষ।' });

        // OTP mark as used
        await pool.request()
            .input('OTPID', sql.Int, result.recordset[0].OTPID)
            .query(`UPDATE OTPVerifications SET IsUsed=1 WHERE OTPID=@OTPID`);

        res.json({ message: 'OTP verified!', verified: true });

    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});

module.exports = router;
