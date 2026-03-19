const jwt = require('jsonwebtoken');
require('dotenv').config();

const protect = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: 'Access denied. Token নেই।' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // { userID, email, role }
        next();
    } catch (err) {
        return res.status(403).json({ message: 'Token invalid বা expire।' });
    }
};

const adminOnly = (req, res, next) => {
    if (req.user.role !== 'admin')
        return res.status(403).json({ message: 'শুধু Admin পারবে।' });
    next();
};

const staffOrAdmin = (req, res, next) => {
    if (!['admin', 'staff'].includes(req.user.role))
        return res.status(403).json({ message: 'Access denied।' });
    next();
};

module.exports = { protect, adminOnly, staffOrAdmin };
