const express = require('express');
const router = express.Router();
const memberController = require('../controllers/memberController');
const { requireRole, requireVip } = require('../middleware/auth');
const upload = require('../middleware/upload');

const isMember = requireRole('member', 'admin');

router.get('/', isMember, memberController.dashboard);
router.get('/schedule', isMember, memberController.schedule);
router.get('/module', isMember, memberController.module);
router.get('/presence', isMember, memberController.presence);
router.get('/questionnaire', isMember, memberController.questionnaire);
router.get('/questionnaire/:id', isMember, memberController.questionnaireShow);
router.post('/questionnaire/:id/submit', isMember, memberController.questionnaireSubmit);
router.get('/report', isMember, memberController.report);
router.get('/certificate', isMember, memberController.certificate);
router.get('/profile', isMember, memberController.profile);
router.post('/profile', isMember, upload.single('photo'), memberController.updateProfile);
router.get('/renewal', isMember, memberController.renewal);
router.get('/toefl', isMember, requireVip, memberController.toefl);
router.get('/video', isMember, memberController.video);
router.get('/placement-test', isMember, memberController.placementTestIndex);
router.get('/placement-test/kids', isMember, memberController.placementTestKids);
router.post('/placement-test/kids', isMember, memberController.submitPlacementTestKids);
router.get('/placement-test/adult', isMember, memberController.placementTestAdult);
router.get('/placement-test/result/:id', isMember, memberController.placementTestResult);
router.post('/notifications/read', isMember, memberController.markNotifRead);

module.exports = router;
