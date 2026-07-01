const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { redirectIfLoggedIn } = require('../middleware/auth');
const upload = require('../middleware/upload');

const transferProofUpload = (req, res, next) => {
  upload.single('transfer_proof')(req, res, (err) => {
    if (!err) return next();
    req.flash('error', err.message || 'Bukti transfer gagal diupload.');
    return res.redirect(`/konfirmasi-transfer/${req.params.code}`);
  });
};

router.get('/login', redirectIfLoggedIn, authController.showLogin);
router.post('/login', redirectIfLoggedIn, authController.login);
router.get('/register', redirectIfLoggedIn, authController.showRegister);
router.post('/register', redirectIfLoggedIn, authController.register);
router.get('/pendaftaran/:code', redirectIfLoggedIn, authController.showRegistrationThanks);
router.get('/konfirmasi-transfer', redirectIfLoggedIn, authController.showTransferLookup);
router.post('/konfirmasi-transfer', redirectIfLoggedIn, authController.lookupTransferRegistration);
router.get('/konfirmasi-transfer/:code', redirectIfLoggedIn, authController.showTransferConfirmation);
router.post('/konfirmasi-transfer/:code', redirectIfLoggedIn, transferProofUpload, authController.confirmTransfer);
router.post('/logout', authController.logout);
router.get('/logout', authController.logout);

module.exports = router;
