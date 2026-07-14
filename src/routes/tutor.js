const express = require('express');
const router = express.Router();
const tutorController = require('../controllers/tutorController');
const { requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');

const isTutor = requireRole('tutor', 'admin');
const isAdmin = requireRole('admin');
const profilePhotoUpload = (req, res, next) => {
  upload.single('photo')(req, res, (err) => {
    if (!err) return next();
    req.flash('error', err.message || 'Foto profil gagal diupload.');
    return res.redirect('/tutor/profile');
  });
};
const classPhotoUpload = (req, res, next) => {
  upload.single('class_photo')(req, res, (err) => {
    if (!err) return next();
    req.flash('error', err.message || 'Foto kelas gagal diupload.');
    return res.redirect(`/tutor/presence?schedule_id=${req.params.schedule_id}#foto-kelas`);
  });
};
const screenshotUpload = (req, res, next) => {
  upload.single('class_screenshot')(req, res, (err) => {
    if (!err) return next();
    req.flash('error', err.message || 'Screenshot gagal diupload.');
    return res.redirect('/tutor/presence#riwayat-presensi');
  });
};

router.get('/', isTutor, tutorController.dashboard);
router.get('/schedule', isTutor, tutorController.schedule);
router.post('/schedule', isAdmin, tutorController.createSchedule);
router.post('/schedule/:id/delete', isTutor, tutorController.deleteSchedule);
router.get('/available-time', isTutor, tutorController.availableTime);
router.get('/available-time/export.csv', isTutor, tutorController.exportAvailableTime);
router.post('/available-time', isTutor, tutorController.saveAvailableTime);
router.post('/available-time/:id/delete', isTutor, tutorController.deleteAvailableTime);
router.post('/available-time/:id/toggle', isTutor, tutorController.toggleAvailableTime);
router.post('/available-time/period/:period/delete', isTutor, tutorController.deleteAvailablePeriod);
router.get('/presence', isTutor, tutorController.presence);
router.post('/presence/submit', isTutor, screenshotUpload, tutorController.submitPresence);
router.post('/presence/:schedule_id', isTutor, tutorController.updatePresence);
router.post('/presence/:schedule_id/class-proof', isTutor, classPhotoUpload, tutorController.uploadClassProof);
router.post('/presence/class-proof/:id/delete', isTutor, tutorController.deleteClassProof);
router.get('/member-presence', isTutor, (req, res) => res.redirect('/tutor/presence#bukti-member'));
router.get('/questionnaire', isTutor, tutorController.questionnaire);
router.post('/questionnaire', isTutor, tutorController.createQuestionnaire);
router.post('/questionnaire/question/add', isTutor, tutorController.addQuestion);
router.get('/questionnaire/answer', requireRole('tutor'), tutorController.questionnaireAnswer);
router.get('/questionnaire/answer/:id', requireRole('tutor'), tutorController.questionnaireAnswerShow);
router.post('/questionnaire/answer/:id/submit', requireRole('tutor'), tutorController.questionnaireAnswerSubmit);
router.get('/questionnaire/:id', isTutor, tutorController.questionnaireDetail);
router.post('/questionnaire/:id/delete', isTutor, tutorController.deleteQuestionnaire);
router.get('/report', isTutor, tutorController.report);
router.get('/report/edit', requireRole('tutor'), tutorController.reportEdit);
router.post('/report', requireRole('tutor'), tutorController.saveReport);
router.get('/report/export.csv', isTutor, tutorController.exportReportCsv);
router.get('/report/:id', isTutor, tutorController.reportDetail);
router.get('/certificate', requireRole('tutor'), tutorController.certificate);
router.post('/certificate', requireRole('tutor'), tutorController.issueCertificate);
router.post('/certificate/:id/update', requireRole('tutor'), tutorController.updateCertificate);
router.get('/certificate/:id/print', requireRole('tutor'), tutorController.certificatePrint);
router.post('/certificate/:id/delete', requireRole('tutor'), tutorController.deleteCertificate);
router.get('/help-support', requireRole('tutor'), tutorController.helpSupport);
router.post('/help-support', requireRole('tutor'), tutorController.submitHelpSupport);
router.get('/profile', isTutor, tutorController.profile);
router.post('/profile', isTutor, profilePhotoUpload, tutorController.updateProfile);

module.exports = router;
