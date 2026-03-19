const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../config/db');
const { protect } = require('../middleware/auth');

router.post('/validate', async (req, res) => {
    const { code, fare } = req.body;
    if (!code) return res.status(400).json({ message: 'Promo code দিন।' });
 
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('Code', sql.NVarChar, code.toUpperCase().trim())
            .query(`SELECT * FROM PromoCodes
                    WHERE Code=@Code
                      AND IsActive=1
                      AND (ExpiresAt IS NULL OR ExpiresAt > GETDATE())
                      AND (UsageLimit IS NULL OR UsedCount < UsageLimit)`);
 
        if (!result.recordset.length)
            return res.status(404).json({ message: 'Invalid বা expired promo code।' });
 
        const promo = result.recordset[0];
        const discount = promo.DiscountType === 'percent'
            ? Math.round((fare * promo.DiscountValue) / 100)
            : Math.min(promo.DiscountValue, fare);
 
        res.json({
            valid: true,
            code: promo.Code,
            description: promo.Description,
            discountType: promo.DiscountType,
            discountValue: promo.DiscountValue,
            discount,
            finalFare: fare - discount
        });
    } catch (err) {
        res.status(500).json({ message: 'Server error।' });
    }
});
 
// POST /api/promo/use  (call after successful booking)
router.post('/use', protect, async (req, res) => {
    const { code } = req.body;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('Code', sql.NVarChar, code.toUpperCase().trim())
            .query(`UPDATE PromoCodes SET UsedCount=ISNULL(UsedCount,0)+1 WHERE Code=@Code`);
        res.json({ message: 'OK' });
    } catch { res.json({ message: 'OK' }); }
});
 
// Admin: create promo code
// POST /api/promo  (admin only)
router.post('/', protect, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({message:'Admin only.'});
    const { code, description, discountType, discountValue, expiresAt, usageLimit } = req.body;
    if (!code || !discountType || !discountValue)
        return res.status(400).json({ message: 'code, discountType, discountValue required.' });
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('Code',          sql.NVarChar,      code.toUpperCase().trim())
            .input('Description',   sql.NVarChar,      description || null)
            .input('DiscountType',  sql.NVarChar,      discountType)  // 'percent' | 'flat'
            .input('DiscountValue', sql.Decimal(10,2), discountValue)
            .input('ExpiresAt',     sql.DateTime,      expiresAt || null)
            .input('UsageLimit',    sql.Int,            usageLimit || null)
            .query(`INSERT INTO PromoCodes (Code,Description,DiscountType,DiscountValue,ExpiresAt,UsageLimit)
                    VALUES (@Code,@Description,@DiscountType,@DiscountValue,@ExpiresAt,@UsageLimit)`);
        res.status(201).json({ message: `Promo code "${code}" তৈরি হয়েছে!` });
    } catch (err) {
        if (err.message.includes('UNIQUE') || err.message.includes('duplicate'))
            return res.status(409).json({ message: 'এই code আগেই আছে।' });
        res.status(500).json({ message: 'Server error: ' + err.message });
    }
});
 
// GET /api/promo  (admin: list all)
router.get('/', protect, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({message:'Admin only.'});
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .query(`SELECT * FROM PromoCodes ORDER BY CreatedAt DESC`);
        res.json(result.recordset);
    } catch (err) { res.status(500).json({ message: 'Server error.' }); }
});

module.exports = router;