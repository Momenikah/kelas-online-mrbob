const express = require('express');
const router = express.Router();
const memberController = require('../controllers/memberController');
const { requireRole, requireLuxury } = require('../middleware/auth');
const upload = require('../middleware/upload');

const isMember = requireRole('member', 'admin');
const profilePhotoUpload = (req, res, next) => {
  upload.single('photo')(req, res, (err) => {
    if (!err) return next();
    req.flash('error', err.message || 'Foto profil gagal diupload.');
    return res.redirect('/member/profile');
  });
};
const screenshotUpload = (req, res, next) => {
  upload.single('class_screenshot')(req, res, (err) => {
    if (!err) return next();
    req.flash('error', err.message || 'Screenshot gagal diupload.');
    return res.redirect('/member/presence');
  });
};
const renewalProofUpload = (req, res, next) => {
  upload.single('transfer_proof')(req, res, (err) => {
    if (!err) return next();
    req.flash('error', err.message || 'Bukti transfer gagal diupload.');
    return res.redirect('/member/renewal#renewal-form');
  });
};
const classPhotoUpload = (req, res, next) => {
  upload.single('class_photo')(req, res, (err) => {
    if (!err) return next();
    req.flash('error', err.message || 'Foto kelas gagal diupload.');
    return res.redirect('/member/presence');
  });
};

router.get('/', isMember, memberController.dashboard);
router.get('/schedule', isMember, memberController.schedule);
router.get('/module', isMember, memberController.module);
router.get('/presence', isMember, memberController.presence);
router.post('/presence', isMember, screenshotUpload, memberController.submitPresence);
router.post('/presence/:schedule_id/check-in', isMember, memberController.checkInPresence);
router.post('/presence/:schedule_id/class-proof', isMember, classPhotoUpload, memberController.uploadClassProof);
router.post('/presence/class-proof/:id/delete', isMember, memberController.deleteClassProof);
router.get('/questionnaire', isMember, memberController.questionnaire);
router.get('/questionnaire/:id', isMember, memberController.questionnaireShow);
router.post('/questionnaire/:id/submit', isMember, memberController.questionnaireSubmit);
router.get('/report', isMember, memberController.report);
router.get('/report/:id', isMember, memberController.reportDetail);
router.get('/certificate', isMember, memberController.certificate);
router.get('/certificate/:id/print', isMember, memberController.certificatePrint);
router.get('/help-support', isMember, memberController.helpSupport);
router.post('/help-support', isMember, memberController.submitHelpSupport);
router.get('/profile', isMember, memberController.profile);
router.post('/profile', isMember, profilePhotoUpload, memberController.updateProfile);
router.get('/renewal', isMember, memberController.renewal);
router.post('/renewal', isMember, renewalProofUpload, memberController.submitRenewal);
router.get('/toefl', isMember, requireLuxury, memberController.toefl);
router.get('/video', isMember, requireLuxury, memberController.video);
router.get('/placement-test', isMember, memberController.placementTestIndex);
router.get('/placement-test/kids', isMember, memberController.placementTestKids);
router.post('/placement-test/kids', isMember, memberController.submitPlacementTestKids);
router.get('/placement-test/adult', isMember, memberController.placementTestAdult);
router.get('/placement-test/result/:id', isMember, memberController.placementTestResult);
router.post('/notifications/read', isMember, memberController.markNotifRead);

module.exports = router;
