const express = require('express');
const router = express.Router();
const tutorController = require('../controllers/tutorController');
const { requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');

const isTutor = requireRole('tutor', 'admin');

router.get('/', isTutor, tutorController.dashboard);
router.get('/schedule', isTutor, tutorController.schedule);
router.post('/schedule', isTutor, tutorController.createSchedule);
router.post('/schedule/:id/delete', isTutor, tutorController.deleteSchedule);
router.get('/available-time', isTutor, tutorController.availableTime);
router.post('/available-time', isTutor, tutorController.saveAvailableTime);
router.post('/available-time/:id/delete', isTutor, tutorController.deleteAvailableTime);
router.get('/presence', isTutor, tutorController.presence);
router.post('/presence/:schedule_id', isTutor, tutorController.updatePresence);
router.get('/questionnaire', isTutor, tutorController.questionnaire);
router.post('/questionnaire', isTutor, tutorController.createQuestionnaire);
router.get('/questionnaire/:id', isTutor, tutorController.questionnaireDetail);
router.post('/questionnaire/question/add', isTutor, tutorController.addQuestion);
router.get('/report', isTutor, tutorController.report);
router.get('/certificate', isTutor, tutorController.certificate);
router.post('/certificate', isTutor, tutorController.issueCertificate);
router.get('/profile', isTutor, tutorController.profile);
router.post('/profile', isTutor, upload.single('photo'), tutorController.updateProfile);

module.exports = router;
