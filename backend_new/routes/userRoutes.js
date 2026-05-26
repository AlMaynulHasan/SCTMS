const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { sql, poolPromise } = require('../config/db');
const { protect } = require('../middleware/auth');

router.put('/profile', protect, async (req, res) => {
    const {
        firstName,
        lastName,
        phone,
        dob,
        gender,
        nid,
        district,
        address
    } = req.body;

    if (!firstName || !firstName.trim()) {
        return res.status(400).json({ message: 'First name is required.' });
    }

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('UserID', sql.Int, req.user.userID)
            .input('FirstName', sql.NVarChar, firstName.trim())
            .input('LastName', sql.NVarChar, (lastName || '').trim() || null)
            .input('Phone', sql.NVarChar, (phone || '').trim() || null)
            .input('DOB', sql.Date, dob || null)
            .input('Gender', sql.NVarChar, gender || null)
            .input('NID', sql.NVarChar, (nid || '').trim() || null)
            .input('District', sql.NVarChar, district || null)
            .input('Address', sql.NVarChar, (address || '').trim() || null)
            .query(`
                UPDATE Users
                SET FirstName=@FirstName,
                    LastName=@LastName,
                    Phone=@Phone,
                    DOB=@DOB,
                    Gender=@Gender,
                    NID=@NID,
                    District=@District,
                    Address=@Address
                WHERE UserID=@UserID
            `);

        const updated = await pool.request()
            .input('UserID', sql.Int, req.user.userID)
            .query(`
                SELECT UserID, FirstName, LastName, Email, Phone, NID,
                       Gender, DOB, District, Address, Role, IsActive, IsVerified
                FROM Users
                WHERE UserID=@UserID
            `);

        res.json({ message: 'Profile updated.', user: updated.recordset[0] });
    } catch (err) {
        console.error('profile update error:', err.message);
        res.status(500).json({ message: 'Server error.' });
    }
});

router.put('/change-password', protect, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'Current and new password are required.' });
    }
    if (String(newPassword).length < 8) {
        return res.status(400).json({ message: 'New password must be at least 8 characters.' });
    }

    try {
        const pool = await poolPromise;
        const userRes = await pool.request()
            .input('UserID', sql.Int, req.user.userID)
            .query('SELECT Password FROM Users WHERE UserID=@UserID');

        if (!userRes.recordset.length) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const ok = await bcrypt.compare(currentPassword, userRes.recordset[0].Password);
        if (!ok) {
            return res.status(400).json({ message: 'Current password is incorrect.' });
        }

        const hash = await bcrypt.hash(newPassword, 10);
        await pool.request()
            .input('UserID', sql.Int, req.user.userID)
            .input('Password', sql.NVarChar, hash)
            .query('UPDATE Users SET Password=@Password WHERE UserID=@UserID');

        res.json({ message: 'Password changed.' });
    } catch (err) {
        console.error('change password error:', err.message);
        res.status(500).json({ message: 'Server error.' });
    }
});

module.exports = router;
