const express = require('express');
const router = express.Router();
const multer = require('multer');
const adminController = require('../controllers/adminController');
const { requireRole } = require('../middleware/auth');

const isAdmin = requireRole('admin');
const csvUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (/\.csv$/i.test(file.originalname)) return cb(null, true);
    return cb(new Error('Hanya file .csv yang diizinkan.'), false);
  },
  limits: { fileSize: 2 * 1024 * 1024 },
});
const scheduleCsvUpload = (req, res, next) => {
  csvUpload.single('schedule_csv')(req, res, (err) => {
    if (!err) return next();
    req.flash('error', err.message || 'File CSV gagal diupload.');
    return res.redirect('/admin/schedule-import');
  });
};

router.get('/', isAdmin, adminController.dashboard);
router.get('/support-feedback', isAdmin, adminController.supportFeedback);
router.post('/support-feedback/:id/status', isAdmin, adminController.updateSupportFeedbackStatus);
router.get('/users', isAdmin, adminController.users);
router.get('/users/export.csv', isAdmin, adminController.exportUsersCsv);
router.get('/users/:id', isAdmin, adminController.userDetail);
router.post('/users', isAdmin, adminController.createUser);
router.post('/users/:id', isAdmin, adminController.updateUser);
router.post('/users/:id/registration', isAdmin, adminController.updateRegistration);
router.post('/users/:id/delete', isAdmin, adminController.deleteUser);
router.post('/users/:id/toggle-status', isAdmin, adminController.toggleUserStatus);
router.post('/users/:id/toggle-vip', isAdmin, adminController.toggleVip);
router.post('/users/:id/toggle-luxury', isAdmin, adminController.toggleLuxury);
router.get('/enrollments', isAdmin, adminController.enrollments);
router.post('/enrollments', isAdmin, adminController.createEnrollment);
router.post('/enrollments/renewal-requests/:id', isAdmin, adminController.updateRenewalRequest);
router.post('/enrollments/:id', isAdmin, adminController.updateEnrollment);
router.post('/enrollments/:id/delete', isAdmin, adminController.deleteEnrollment);
router.post('/enrollments/:id/extend', isAdmin, adminController.extendEnrollment);
router.get('/member-presence', isAdmin, adminController.memberPresence);
router.get('/questionnaire', isAdmin, adminController.questionnaire);
router.post('/questionnaire', isAdmin, adminController.createQuestionnaire);
router.get('/questionnaire/:id', isAdmin, adminController.questionnaireDetail);
router.post('/questionnaire/:id/delete', isAdmin, adminController.deleteQuestionnaire);
router.post('/questionnaire/:id/questions', isAdmin, adminController.addQuestion);
router.post('/questionnaire/:id/questions/:questionId/update', isAdmin, adminController.updateQuestion);
router.post('/questionnaire/:id/questions/:questionId/delete', isAdmin, adminController.deleteQuestion);
router.get('/report', isAdmin, adminController.report);
router.get('/report/:id', isAdmin, adminController.reportDetail);
router.get('/certificate', isAdmin, adminController.certificate);
router.get('/certificate/:id/print', isAdmin, adminController.certificatePrint);
router.post('/certificate/:id/sync', isAdmin, adminController.certificateSync);
router.get('/periods', isAdmin, adminController.periods);
router.post('/periods', isAdmin, adminController.createPeriod);
router.post('/periods/:id/toggle', isAdmin, adminController.togglePeriod);
router.post('/periods/:id/delete', isAdmin, adminController.deletePeriod);
router.get('/schedule', isAdmin, adminController.scheduleManage);
router.post('/schedule/:id', isAdmin, adminController.updateSchedule);
router.post('/schedule/:id/delete', isAdmin, adminController.deleteSchedule);
router.get('/schedule-plot', isAdmin, adminController.schedulePlot);
router.post('/schedule-plot', isAdmin, adminController.generateSchedulePlot);
router.get('/schedule-import', isAdmin, adminController.scheduleImport);
router.post('/schedule-sync', isAdmin, adminController.scheduleSyncNow);
router.get('/schedule-import/template.csv', isAdmin, adminController.downloadScheduleTemplate);
router.post('/schedule-import', isAdmin, scheduleCsvUpload, adminController.importScheduleCsv);
router.post('/schedule-import/schedule/:id/delete', isAdmin, adminController.deleteSchedule);
router.get('/schedule-import/:id/errors.csv', isAdmin, adminController.downloadScheduleImportErrors);
router.get('/available-times/export.csv', isAdmin, adminController.exportAvailableTimesCsv);
router.get('/presences/export.csv', isAdmin, adminController.exportPresencesCsv);

module.exports = router;
