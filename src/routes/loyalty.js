const express = require('express');
const router = express.Router();
const loyaltyController = require('../controllers/loyaltyController');

// Halaman publik Alumni Loyalty Program + cek referral untuk form pendaftaran.
router.get('/loyalty-program', loyaltyController.showProgram);
router.get('/referral/check', loyaltyController.checkReferral);

module.exports = router;
